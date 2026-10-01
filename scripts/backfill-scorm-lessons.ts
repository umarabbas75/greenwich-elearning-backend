/**
 * backfill-scorm-lessons.ts
 *
 * Materialises lesson sections for SCORM packages imported before the lesson
 * manifest existed — the ones sitting on a single synthetic section.
 *
 * For each READY package with no `lessons`:
 *   1. re-download `scormcontent/runtime-data.js` from SCORM Cloud
 *      (`riseProbeJson` stores only the probe RESULT, not the raw manifest, so
 *      lessons cannot be recovered from it)
 *   2. parse the lesson list (and the index-space risk check the import runs)
 *   3. under the import's own advisory locks, re-check the package is still
 *      READY / manifest-less / on the same section, then archive the old single
 *      section and create one section per lesson
 *   4. write lessons / lessonCount / chapterId / riseProbeJson back
 *   5. publish a new course version for each touched course via the same
 *      CourseVersionService.publishNewVersion the import uses — after the
 *      same publish gate setCourseActive applies (a course that fails it is
 *      skipped and reported). Default whenever applying, because step 3 has
 *      already cleared learners' decoded sets: an unpublished course is left
 *      with live sections no version references. --no-publish opts out and
 *      prints the courses that still need publishing.
 *
 * A package whose Cloud course is gone (404 — PRUNED, FAILED, or deleted by
 * hand) is left exactly as it is: one section, binary progress. That is the
 * same fallback a non-Rise package gets, so it needs no special handling
 * anywhere downstream.
 *
 * A package whose manifest trips the index-space risk check (deleted lesson,
 * divider, out-of-order position…) is SKIPPED unless --force: decoded lesson
 * indices may not key the sections we would build. With --force it is
 * materialised and gets the same importWarning an import would write, and
 * `riseIndexSpaceRisk` lands in riseProbeJson so the runtime keeps it on
 * binary progress until --verify-index-space is run for it.
 *
 * Learners already pinned to a one-section version keep binary progress until
 * they are re-pinned. That is correct — their curriculum genuinely was one
 * section — and it is why this does not touch enrollments.
 *
 *   yarn script:backfill-scorm-lessons:dry              # default, writes nothing
 *   yarn script:backfill-scorm-lessons                  # = --apply (package.json adds it); publishes
 *   yarn script:backfill-scorm-lessons --package=<id>
 *   yarn script:backfill-scorm-lessons --no-publish     # materialise only (ACTION REQUIRED after)
 *   yarn script:backfill-scorm-lessons --force          # include index-space-risk packages
 *   yarn script:backfill-scorm-lessons --publish-only=<courseId>
 *       gate + publish one course, materialising nothing — the retry for a
 *       publish that failed (or was skipped) on an earlier run
 *   yarn script:backfill-scorm-lessons --reset-cpv=<packageId>
 *       clears ScormPackage.riseCpv so the next agreeing registrations re-seed it
 *       (does nothing else; the dry variant just prints the current value)
 *   yarn script:backfill-scorm-lessons --verify-index-space=<packageId>
 *       sets riseProbeJson.riseIndexSpaceVerified = true once a real learner's
 *       decoded lessons have been checked against the sections by hand — the
 *       runtime then applies per-lesson progress despite riseIndexSpaceRisk
 *   yarn script:backfill-scorm-lessons --unverify-index-space=<packageId>
 *       removes that flag again (back to binary progress)
 *
 * Every write mode prints the target DB host and asks for confirmation; pass
 * --yes to skip the prompt (required when stdin is not a TTY).
 *
 * Flags are parsed strictly: an unknown flag, or a value flag without
 * `=value` (`--reset-cpv <id>`), exits non-zero with usage rather than
 * silently running a full backfill.
 */

import * as dotenv from 'dotenv';
import { createInterface } from 'readline';
import {
  Prisma,
  PrismaClient,
  ScormPackage,
  ScormPackageStatus,
  SectionType,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { CourseVersionService } from '../src/course-version/course-version.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  COURSE_TREE_LOCK_SEED,
  riseIndexSpaceWarning,
  TREE_LOCK_SEED,
} from '../src/scorm/scorm.service';
import { parseRiseRuntimeData } from '../src/utils/rise-probe';
import {
  evaluateScormPublishGate,
  scormGateCandidateSectionsWhere,
  scormPackageSectionIds,
} from '../src/utils/scorm-publish-gate';

dotenv.config();

const BOOLEAN_FLAGS = [
  'apply',
  'force',
  'publish',
  'no-publish',
  'yes',
] as const;
const VALUE_FLAGS = [
  'package',
  'reset-cpv',
  'verify-index-space',
  'unverify-index-space',
  'publish-only',
] as const;

const USAGE = `Usage: backfill-scorm-lessons.ts [--apply] [--yes] [options]

  --package=<packageId>               backfill only this package
  --force                             include index-space-risk packages
  --no-publish                        with --apply: materialise without publishing
  --publish                           accepted for compatibility (publishing is the default)
  --publish-only=<courseId>           gate + publish one course; materialises nothing
  --reset-cpv=<packageId>             clear ScormPackage.riseCpv
  --verify-index-space=<packageId>    set riseProbeJson.riseIndexSpaceVerified
  --unverify-index-space=<packageId>  remove it again

Value flags need the = form (--package=<id>, not --package <id>).`;

function usageError(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

/**
 * Strict on purpose: the old lenient parse matched only `--name=value`, so
 * `--reset-cpv <id>` fell through to a full backfill of every package.
 */
function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const values: Record<string, string> = {};
  for (const arg of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!m) usageError(`Unexpected argument "${arg}"`);
    const [, name, value] = m;
    if ((BOOLEAN_FLAGS as readonly string[]).includes(name)) {
      if (value !== undefined) usageError(`--${name} takes no value`);
      flags.add(name);
    } else if ((VALUE_FLAGS as readonly string[]).includes(name)) {
      if (value === undefined || value.trim() === '') {
        usageError(`--${name} needs a value: --${name}=<id>`);
      }
      if (name in values) usageError(`--${name} given more than once`);
      values[name] = value.trim();
    } else {
      usageError(`Unknown flag --${name}`);
    }
  }
  if (flags.has('publish') && flags.has('no-publish')) {
    usageError('Pass only one of --publish / --no-publish');
  }
  return { flags, values };
}

const ARGS = parseArgs(process.argv.slice(2));
const APPLY = ARGS.flags.has('apply');
const FORCE = ARGS.flags.has('force');
const NO_PUBLISH = ARGS.flags.has('no-publish');
// Default-on when applying — see step 5 in the header.
const PUBLISH = APPLY && !NO_PUBLISH;
const YES = ARGS.flags.has('yes');
const ONLY_PACKAGE = ARGS.values['package'];
const RESET_CPV = ARGS.values['reset-cpv'];
const VERIFY_INDEX_SPACE = ARGS.values['verify-index-space'];
const UNVERIFY_INDEX_SPACE = ARGS.values['unverify-index-space'];
const PUBLISH_ONLY = ARGS.values['publish-only'];

/** Script, not serverless — generous, but a hung socket must still end. */
const CLOUD_TIMEOUT_MS = 30_000;

const rawUrl = process.env.DATABASE_URL ?? '';
if (!rawUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url: rawUrl } } });

const APP_ID = process.env.SCORM_CLOUD_APP_ID ?? '';
const SECRET = process.env.SCORM_CLOUD_SECRET_KEY ?? '';
const API_BASE =
  process.env.SCORM_CLOUD_API_BASE ?? 'https://cloud.scorm.com/api/v2';

/** host:port/db only — never print credentials. */
function describeDbTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

async function confirmWrite(what: string): Promise<boolean> {
  console.log(`\nTarget DB: ${describeDbTarget(rawUrl)}`);
  if (YES) return true;
  if (!process.stdin.isTTY) {
    console.error('Refusing to write without --yes (stdin is not a TTY).');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) =>
    rl.question(`${what} on this database? Type "yes" to continue: `, resolve),
  );
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

/**
 * Minimal Cloud fetch rather than booting the Nest client — this script runs
 * outside the app container and only needs one read-only endpoint.
 */
async function fetchRuntimeData(cloudCourseId: string): Promise<string | null> {
  const auth = Buffer.from(`${APP_ID}:${SECRET}`).toString('base64');
  const qs = new URLSearchParams({
    relativePath: 'scormcontent/runtime-data.js',
  });
  try {
    const res = await fetch(
      `${API_BASE}/courses/${encodeURIComponent(cloudCourseId)}/asset?${qs}`,
      {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
      },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(
        `Cloud ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    }
    return await res.text();
  } catch (err) {
    if ((err as Error)?.name === 'TimeoutError') {
      throw new Error(`Cloud did not respond within ${CLOUD_TIMEOUT_MS}ms`);
    }
    throw err;
  }
}

/** Admin escape hatch for a riseCpv seeded from the wrong registration(s). */
async function resetCpv(packageId: string): Promise<void> {
  const pkg = await prisma.scormPackage.findUnique({
    where: { id: packageId },
    select: { id: true, title: true, riseCpv: true },
  });
  if (!pkg) {
    console.error(`Package ${packageId} not found`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `\n${pkg.title} [${pkg.id}]\n  riseCpv = ${pkg.riseCpv ?? '(null)'}`,
  );
  if (pkg.riseCpv === null) {
    console.log('  Already null — nothing to do.');
    return;
  }
  if (!APPLY) {
    console.log('  DRY RUN — re-run with --apply to clear it.');
    return;
  }
  if (!(await confirmWrite(`Clear riseCpv for package ${pkg.id}`))) {
    process.exitCode = 1;
    return;
  }
  await prisma.scormPackage.update({
    where: { id: pkg.id },
    data: { riseCpv: null },
  });
  console.log(
    '  Cleared — it re-seeds from the next registrations that agree.',
  );
}

/**
 * Admin escape hatch for a package held on binary progress by
 * riseIndexSpaceRisk. The key and `=== true` check must match
 * unverifiedIndexSpaceRisk in scorm-runtime.service.ts, which reads it.
 * Merged into the existing probe — the runtime and the import both read other
 * keys off it (lessons, riseIndexSpaceRisk), so replacing it would lose them.
 */
async function setIndexSpaceVerified(
  packageId: string,
  verified: boolean,
): Promise<void> {
  const pkg = await prisma.scormPackage.findUnique({
    where: { id: packageId },
    select: { id: true, title: true, riseProbeJson: true },
  });
  if (!pkg) {
    console.error(`Package ${packageId} not found`);
    process.exitCode = 1;
    return;
  }
  const probe = pkg.riseProbeJson;
  if (!probe || typeof probe !== 'object' || Array.isArray(probe)) {
    console.error(
      `Package ${pkg.id} has no riseProbeJson object — nothing to ${
        verified ? 'verify' : 'unverify'
      }`,
    );
    process.exitCode = 1;
    return;
  }
  const record = probe as Record<string, unknown>;
  const current = record.riseIndexSpaceVerified === true;
  console.log(
    `\n${pkg.title} [${pkg.id}]\n  riseIndexSpaceRisk     = ${
      typeof record.riseIndexSpaceRisk === 'string'
        ? record.riseIndexSpaceRisk
        : '(none)'
    }\n  riseIndexSpaceVerified = ${current}`,
  );
  if (current === verified) {
    console.log('  Already set — nothing to do.');
    return;
  }
  if (verified && typeof record.riseIndexSpaceRisk !== 'string') {
    // Harmless (the runtime ignores the flag without a risk), but almost
    // certainly the wrong package id.
    console.log(
      '  NOTE: no riseIndexSpaceRisk on this package — the flag has no effect.',
    );
  }
  if (!APPLY) {
    console.log(
      `  DRY RUN — re-run with --apply to ${verified ? 'set' : 'remove'} it.`,
    );
    return;
  }
  if (
    !(await confirmWrite(
      `${verified ? 'Set' : 'Remove'} riseIndexSpaceVerified for package ${
        pkg.id
      }`,
    ))
  ) {
    process.exitCode = 1;
    return;
  }
  const rest = { ...record };
  delete rest.riseIndexSpaceVerified;
  await prisma.scormPackage.update({
    where: { id: pkg.id },
    data: {
      riseProbeJson: (verified
        ? { ...rest, riseIndexSpaceVerified: true }
        : rest) as Prisma.InputJsonValue,
    },
  });
  console.log(
    verified
      ? '  Set — per-lesson progress applies from the next postback or reconcile pass.'
      : '  Removed — the package is back on binary progress.',
  );
}

/**
 * The same inputs CourseService.assertScormCoursePublishable feeds the gate:
 * the newest READY package's section set vs the live SCORM candidates.
 * Empty ⇔ publishable.
 */
async function publishGateProblems(courseId: string): Promise<string[]> {
  const ready = await prisma.scormPackage.findFirst({
    where: { courseId, status: ScormPackageStatus.READY },
    orderBy: { versionNumber: 'desc' },
    select: { id: true, sectionId: true, lessons: true },
  });
  const expected = scormPackageSectionIds(ready);
  if (expected.size === 0) {
    return ['no READY package with sections — import the package first'];
  }
  const candidates = await prisma.section.findMany({
    where: scormGateCandidateSectionsWhere(courseId),
    select: { id: true, isActive: true },
  });
  return evaluateScormPublishGate(expected, candidates).problems;
}

type PublishResult =
  | { kind: 'published'; versionNumber?: number }
  | { kind: 'gated'; problems: string[] }
  | { kind: 'failed'; message: string };

async function publishCourse(
  versions: CourseVersionService,
  courseId: string,
): Promise<PublishResult> {
  try {
    const problems = await publishGateProblems(courseId);
    if (problems.length > 0) {
      console.log(
        `SKIP  publish course ${courseId} — fails the publish gate:\n` +
          problems.map((p) => `      ${p}`).join('\n'),
      );
      return { kind: 'gated', problems };
    }
    const v = await versions.publishNewVersion(
      null,
      courseId,
      'SCORM lesson backfill',
    );
    const versionNumber =
      v && typeof v === 'object' && 'versionNumber' in v
        ? (v as { versionNumber: number }).versionNumber
        : undefined;
    console.log(
      `PUBLISHED course ${courseId}${
        versionNumber ? ` → v${versionNumber}` : ''
      }`,
    );
    return { kind: 'published', versionNumber };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    console.log(`FAIL  publish course ${courseId}\n      ${message}`);
    return { kind: 'failed', message };
  }
}

/** Retry path for a publish that failed or was gated on an earlier run. */
async function publishOnly(courseId: string): Promise<void> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, title: true, deliveryMode: true },
  });
  if (!course) {
    console.error(`Course ${courseId} not found`);
    process.exitCode = 1;
    return;
  }
  if (course.deliveryMode !== 'IMPORTED_SCORM') {
    console.error(`Course ${courseId} is not an imported SCORM course`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n${course.title} [${course.id}]`);
  if (!APPLY) {
    const problems = await publishGateProblems(courseId);
    console.log(
      problems.length > 0
        ? `  Fails the publish gate:\n${problems
            .map((p) => `    ${p}`)
            .join('\n')}`
        : '  Passes the publish gate. DRY RUN — re-run with --apply to publish.',
    );
    if (problems.length > 0) process.exitCode = 1;
    return;
  }
  if (!(await confirmWrite(`Publish a new version of course ${courseId}`))) {
    process.exitCode = 1;
    return;
  }
  const result = await publishCourse(
    new CourseVersionService(prisma as unknown as PrismaService),
    courseId,
  );
  if (result.kind !== 'published') process.exitCode = 1;
}

/** Why a --package=<id> run selected nothing, in the admin's terms. */
async function explainUnselectedPackage(packageId: string): Promise<void> {
  const pkg = await prisma.scormPackage.findUnique({
    where: { id: packageId },
    select: { id: true, status: true, lessonCount: true, courseId: true },
  });
  if (!pkg) {
    console.error(`Package ${packageId} not found.`);
    process.exitCode = 1;
  } else if (pkg.status !== ScormPackageStatus.READY) {
    console.error(
      `Package ${packageId} is ${pkg.status}, not READY — only the live package of a course is backfilled.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Package ${packageId} already has a lesson manifest (${
        pkg.lessonCount ?? '?'
      } lessons) — nothing to backfill. If its course was never published ` +
        `after an earlier backfill, run --publish-only=${pkg.courseId}.`,
    );
  }
}

type Outcome = 'materialised' | 'skipped';

async function main() {
  const modes = [
    RESET_CPV,
    VERIFY_INDEX_SPACE,
    UNVERIFY_INDEX_SPACE,
    PUBLISH_ONLY,
  ].filter(Boolean).length;
  if (modes > 1 || (modes === 1 && (ONLY_PACKAGE || FORCE || NO_PUBLISH))) {
    usageError(
      'Pass at most one of --reset-cpv / --verify-index-space / --unverify-index-space / --publish-only, without backfill options',
    );
  }
  if (PUBLISH_ONLY) {
    await publishOnly(PUBLISH_ONLY);
    return;
  }
  if (RESET_CPV) {
    await resetCpv(RESET_CPV);
    return;
  }
  if (VERIFY_INDEX_SPACE || UNVERIFY_INDEX_SPACE) {
    await setIndexSpaceVerified(
      (VERIFY_INDEX_SPACE ?? UNVERIFY_INDEX_SPACE)!,
      !!VERIFY_INDEX_SPACE,
    );
    return;
  }

  if (!APP_ID || !SECRET) {
    console.error('SCORM_CLOUD_APP_ID / SCORM_CLOUD_SECRET_KEY are required');
    process.exit(1);
  }

  console.log(
    `\nSCORM lesson backfill — ${APPLY ? 'APPLY' : 'DRY RUN (writes nothing)'}${
      FORCE ? '  --force' : ''
    }${APPLY ? (PUBLISH ? '  (publishing)' : '  --no-publish') : ''}\n`,
  );
  // A dry run reads too: printed so its report can't be mistaken for another
  // environment's (write modes print it again in confirmWrite).
  if (!APPLY) console.log(`Target DB: ${describeDbTarget(rawUrl)}\n`);

  const packages = await prisma.scormPackage.findMany({
    where: {
      status: ScormPackageStatus.READY,
      // Prisma distinguishes SQL NULL from JSON `null` on a Json column, and
      // `equals: null` is neither — it is a type error under strictNullChecks
      // and matches nothing at runtime. DbNull is the SQL NULL these rows have.
      lessons: { equals: Prisma.DbNull },
      ...(ONLY_PACKAGE ? { id: ONLY_PACKAGE } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });

  if (packages.length === 0) {
    if (ONLY_PACKAGE) {
      await explainUnselectedPackage(ONLY_PACKAGE);
    } else {
      console.log(
        'Nothing to backfill — every READY package has a lesson manifest.',
      );
    }
    return;
  }

  if (
    APPLY &&
    !(await confirmWrite(`Backfill ${packages.length} package(s)`))
  ) {
    process.exitCode = 1;
    return;
  }

  let materialised = 0;
  let skipped = 0;
  const failures: Array<{ label: string; message: string }> = [];
  const touchedCourses = new Set<string>();

  for (const pkg of packages) {
    const label = `${pkg.title} [${pkg.id}]`;
    // One bad package (Cloud hiccup, lock held, constraint) must not abort the
    // rest of the run — it is reported in the summary and fails the exit code.
    try {
      const outcome = await backfillOne(pkg, label);
      if (outcome === 'materialised') {
        materialised += 1;
        if (APPLY) touchedCourses.add(pkg.courseId);
      } else {
        skipped += 1;
      }
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      console.log(`FAIL  ${label}\n      ${message}`);
      failures.push({ label, message });
    }
  }

  const published: string[] = [];
  if (PUBLISH) {
    const versions = new CourseVersionService(
      prisma as unknown as PrismaService,
    );
    for (const courseId of touchedCourses) {
      const result = await publishCourse(versions, courseId);
      if (result.kind === 'published') {
        published.push(courseId);
      } else {
        failures.push({
          label: `publish ${courseId}`,
          message:
            result.kind === 'gated'
              ? `publish gate: ${result.problems.join('; ')}`
              : result.message,
        });
      }
    }
  }

  console.log(
    `\n${
      APPLY ? 'Materialised' : 'Would materialise'
    }: ${materialised}   Skipped: ${skipped}   Failed: ${failures.length}`,
  );
  if (failures.length > 0) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log(`  ${f.label}\n    ${f.message}`);
    process.exitCode = 1;
  }
  if (!APPLY && materialised > 0) {
    console.log('\nRe-run with --apply to write.');
  }
  const unpublished = [...touchedCourses].filter((c) => !published.includes(c));
  if (unpublished.length > 0) {
    console.log(
      '\n' +
        '================================================================\n' +
        ' ACTION REQUIRED — these courses have new lesson sections that NO\n' +
        ' published version references yet. Publish a new version for each\n' +
        ' (fix any publish-gate problem above first):\n' +
        unpublished
          .map(
            (c) =>
              `   ${c}\n     yarn script:backfill-scorm-lessons --publish-only=${c}`,
          )
          .join('\n') +
        '\n================================================================',
    );
  }
  if (APPLY && materialised > 0) {
    console.log(
      '\nNOTE:\n' +
        '  Learners already pinned keep their one-section curriculum (and their\n' +
        '  binary progress) until re-pinned — that is correct, it is the\n' +
        '  curriculum they enrolled on. UNPINNED learners mid-course read 0%\n' +
        '  until their next postback or reconcile pass re-decodes suspendData\n' +
        '  against the new sections. Certified learners are unaffected\n' +
        '  (completion freezes them at 100%).',
    );
  }
}

async function backfillOne(pkg: ScormPackage, label: string): Promise<Outcome> {
  if (!pkg.sectionId) {
    console.log(
      `SKIP  ${label}\n      READY but no sectionId — data invariant violation, leaving alone`,
    );
    return 'skipped';
  }

  let asset: string | null;
  try {
    asset = await fetchRuntimeData(pkg.scormCloudCourseId);
  } catch (err) {
    console.log(`SKIP  ${label}\n      Cloud error: ${(err as Error).message}`);
    return 'skipped';
  }
  if (asset === null) {
    console.log(
      `SKIP  ${label}\n      Cloud course is gone (404) — stays on one section, binary progress`,
    );
    return 'skipped';
  }

  const probe = parseRiseRuntimeData(asset);
  const lessons = probe.lessons;
  if (lessons.length === 0) {
    console.log(
      `SKIP  ${label}\n      No lesson manifest (non-Rise or unreadable) — correct as one section`,
    );
    return 'skipped';
  }

  // Same check, same message as completeImportIfReady.
  const indexWarning = riseIndexSpaceWarning(probe.riseIndexSpaceRisk);
  if (indexWarning) {
    console.log(`RISK  ${label}\n      ${probe.riseIndexSpaceRisk}`);
    if (!FORCE) {
      console.log(
        '      SKIPPED — decoded lesson indices may not key these sections; --force to backfill anyway',
      );
      return 'skipped';
    }
  }

  const oldSection = await prisma.section.findUnique({
    where: { id: pkg.sectionId },
    select: { chapterId: true, moduleId: true, config: true },
  });
  if (!oldSection?.chapterId || !oldSection.moduleId) {
    console.log(
      `SKIP  ${label}\n      Existing section is missing chapter/module`,
    );
    return 'skipped';
  }

  console.log(
    `${APPLY ? 'APPLY' : 'WOULD'} ${label}\n      ${lessons.length} lessons → ${
      lessons.length
    } sections in chapter ${oldSection.chapterId}`,
  );
  for (const lesson of lessons.slice(0, 3)) {
    console.log(
      `        [${lesson.index}] ${lesson.type.padEnd(6)} ${lesson.title.slice(
        0,
        60,
      )}`,
    );
  }
  if (lessons.length > 3) console.log(`        … ${lessons.length - 3} more`);

  if (!APPLY) return 'materialised';

  const skipReason = await prisma.$transaction(
    async (tx): Promise<string | null> => {
      // The import's own keys (see scorm.service.ts): the package lock stops a
      // concurrent complete-import of this package, the course lock stops a
      // NEW package's replace from archiving this chapter mid-write. Try-lock,
      // so a busy course is skipped rather than waited on.
      const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>(
        Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${pkg.id}, ${TREE_LOCK_SEED}))
                     AND pg_try_advisory_xact_lock(hashtextextended(${pkg.courseId}, ${COURSE_TREE_LOCK_SEED})) AS locked`,
      );
      // `a AND b` short-circuits only on a false `a`: when the package lock
      // is won and the course lock is not, the package lock IS held here. No
      // explicit unlock needed — returning ends the tx, which releases it.
      if (!locked)
        return 'an import holds the tree lock for this package/course';

      // Selected before the Cloud round-trip — re-check under the lock.
      const fresh = await tx.scormPackage.findUnique({
        where: { id: pkg.id },
        select: { status: true, lessons: true, sectionId: true },
      });
      if (!fresh) return 'package no longer exists';
      if (fresh.status !== ScormPackageStatus.READY) {
        return `status is now ${fresh.status}`;
      }
      if (fresh.lessons !== null) return 'already has a lesson manifest';
      if (fresh.sectionId !== pkg.sectionId) return 'sectionId changed';
      const live = await tx.section.findUnique({
        where: { id: pkg.sectionId! },
        select: { isArchived: true, chapterId: true },
      });
      if (!live || live.isArchived || live.chapterId !== oldSection.chapterId) {
        return 'its section was archived or moved';
      }

      // Archive the synthetic section rather than deleting it: learners
      // pinned to a version that contains it must keep resolving it, and
      // UserCourseProgress rows FK to it with onDelete: Cascade.
      await tx.section.update({
        where: { id: pkg.sectionId! },
        data: { isArchived: true, archivedAt: new Date() },
      });

      const baseConfig = (oldSection.config ?? {}) as Record<string, unknown>;
      // Ids pre-generated so one createMany does the lot (see buildOrReplaceTree).
      const manifest = lessons.map((lesson) => ({
        index: lesson.index,
        id: lesson.id,
        title: lesson.title,
        type: lesson.type,
        sectionId: randomUUID(),
      }));
      await tx.section.createMany({
        data: manifest.map((lesson) => ({
          id: lesson.sectionId,
          title: lesson.title,
          description: '',
          chapterId: oldSection.chapterId!,
          moduleId: oldSection.moduleId!,
          type: SectionType.SCORM,
          orderIndex: lesson.index + 1,
          config: {
            ...baseConfig,
            scormLessonId: lesson.id,
            scormLessonIndex: lesson.index,
            scormLessonType: lesson.type,
          },
        })),
      });

      await tx.scormPackage.update({
        where: { id: pkg.id },
        data: {
          sectionId: manifest[0].sectionId,
          chapterId: oldSection.chapterId,
          lessons: manifest as unknown as Prisma.InputJsonValue,
          lessonCount: manifest.length,
          // The progress path reads riseIndexSpaceRisk back off riseProbeJson
          // (top-level key, as the import writes it); these rows predate that
          // field, so the fresh probe must replace it. Replacing also drops
          // any riseIndexSpaceVerified — correct, it vouched for no lessons.
          riseProbeJson: probe as unknown as Prisma.InputJsonValue,
          ...(indexWarning
            ? {
                importWarning: pkg.importWarning?.includes(indexWarning)
                  ? pkg.importWarning
                  : [pkg.importWarning, indexWarning]
                      .filter(Boolean)
                      .join(' | '),
              }
            : {}),
        },
      });

      // Re-point every learner on this package at the new sections.
      //
      // Their decoded set (`lessonsCompletedIndices`) was applied against the
      // OLD single section. Left alone, the sync's "set unchanged → skip"
      // guard would treat it as already applied and never write rows against
      // the sections that now exist — the learner would sit at 0% forever
      // while the column claimed otherwise. Clearing it forces exactly one
      // re-apply on their next postback or reconcile pass.
      //
      // The progress rows themselves are deliberately NOT migrated: one row
      // against a synthetic whole-package section does not tell us which of
      // the N lessons were read, and inventing that would over-credit. The
      // re-apply decodes the truth from suspendData instead.
      const repointed = await tx.scormRegistration.updateMany({
        // Only learners still in progress. A finished learner sends no more
        // postbacks and `reconcileCron` stops selecting them once completion
        // is stamped and passed, so clearing their decoded set would destroy
        // it with nothing left to rebuild it from. Their percentage is frozen
        // at 100 by CourseCompletion regardless, so there is nothing to gain.
        where: { packageId: pkg.id, completedAt: null },
        data: {
          lessonsCompleted: null,
          lessonsCompletedIndices: [],
          // Cleared with the rest: it described a decode against the OLD
          // single section, and leaving it reading 'suspend-data' beside a
          // null count would claim lesson data this learner no longer has.
          progressSource: null,
          lastRuntimePullAt: null,
          // Null marks the row "dirty" (see lastRuntimeAppliedAt in the
          // schema), so an IDLE learner — one who sends no further postback —
          // is still re-decoded against the new manifest by the progress
          // read's pull-on-read and reconcile's dirty-first pass. Without it a
          // stamp newer than their last postback says "already applied" and
          // they sit at 0% until their next postback.
          lastRuntimeAppliedAt: null,
        },
      });
      if (repointed.count > 0) {
        console.log(
          `      re-pointed ${repointed.count} registration(s) — their lesson progress re-decodes on the next postback or reconcile pass`,
        );
      }
      return null;
    },
    { timeout: 30000, maxWait: 10000 },
  );

  if (skipReason) {
    console.log(`SKIP  ${label}\n      changed since selection: ${skipReason}`);
    return 'skipped';
  }
  console.log(`      done (course ${pkg.courseId})`);
  return 'materialised';
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
