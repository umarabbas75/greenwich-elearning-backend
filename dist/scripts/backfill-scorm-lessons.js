"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const readline_1 = require("readline");
const client_1 = require("@prisma/client");
const crypto_1 = require("crypto");
const course_version_service_1 = require("../src/course-version/course-version.service");
const scorm_service_1 = require("../src/scorm/scorm.service");
const rise_probe_1 = require("../src/utils/rise-probe");
const scorm_publish_gate_1 = require("../src/utils/scorm-publish-gate");
dotenv.config();
const BOOLEAN_FLAGS = [
    'apply',
    'force',
    'publish',
    'no-publish',
    'yes',
];
const VALUE_FLAGS = [
    'package',
    'reset-cpv',
    'verify-index-space',
    'unverify-index-space',
    'publish-only',
];
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
function usageError(message) {
    console.error(`${message}\n\n${USAGE}`);
    process.exit(2);
}
function parseArgs(argv) {
    const flags = new Set();
    const values = {};
    for (const arg of argv) {
        const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
        if (!m)
            usageError(`Unexpected argument "${arg}"`);
        const [, name, value] = m;
        if (BOOLEAN_FLAGS.includes(name)) {
            if (value !== undefined)
                usageError(`--${name} takes no value`);
            flags.add(name);
        }
        else if (VALUE_FLAGS.includes(name)) {
            if (value === undefined || value.trim() === '') {
                usageError(`--${name} needs a value: --${name}=<id>`);
            }
            if (name in values)
                usageError(`--${name} given more than once`);
            values[name] = value.trim();
        }
        else {
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
const PUBLISH = APPLY && !NO_PUBLISH;
const YES = ARGS.flags.has('yes');
const ONLY_PACKAGE = ARGS.values['package'];
const RESET_CPV = ARGS.values['reset-cpv'];
const VERIFY_INDEX_SPACE = ARGS.values['verify-index-space'];
const UNVERIFY_INDEX_SPACE = ARGS.values['unverify-index-space'];
const PUBLISH_ONLY = ARGS.values['publish-only'];
const CLOUD_TIMEOUT_MS = 30000;
const rawUrl = process.env.DATABASE_URL ?? '';
if (!rawUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
}
const prisma = new client_1.PrismaClient({ datasources: { db: { url: rawUrl } } });
const APP_ID = process.env.SCORM_CLOUD_APP_ID ?? '';
const SECRET = process.env.SCORM_CLOUD_SECRET_KEY ?? '';
const API_BASE = process.env.SCORM_CLOUD_API_BASE ?? 'https://cloud.scorm.com/api/v2';
function describeDbTarget(url) {
    try {
        const u = new URL(url);
        return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
    }
    catch {
        return '(unparseable DATABASE_URL)';
    }
}
async function confirmWrite(what) {
    console.log(`\nTarget DB: ${describeDbTarget(rawUrl)}`);
    if (YES)
        return true;
    if (!process.stdin.isTTY) {
        console.error('Refusing to write without --yes (stdin is not a TTY).');
        return false;
    }
    const rl = (0, readline_1.createInterface)({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => rl.question(`${what} on this database? Type "yes" to continue: `, resolve));
    rl.close();
    return answer.trim().toLowerCase() === 'yes';
}
async function fetchRuntimeData(cloudCourseId) {
    const auth = Buffer.from(`${APP_ID}:${SECRET}`).toString('base64');
    const qs = new URLSearchParams({
        relativePath: 'scormcontent/runtime-data.js',
    });
    try {
        const res = await fetch(`${API_BASE}/courses/${encodeURIComponent(cloudCourseId)}/asset?${qs}`, {
            headers: { Authorization: `Basic ${auth}` },
            signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
        });
        if (res.status === 404)
            return null;
        if (!res.ok) {
            throw new Error(`Cloud ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }
        return await res.text();
    }
    catch (err) {
        if (err?.name === 'TimeoutError') {
            throw new Error(`Cloud did not respond within ${CLOUD_TIMEOUT_MS}ms`);
        }
        throw err;
    }
}
async function resetCpv(packageId) {
    const pkg = await prisma.scormPackage.findUnique({
        where: { id: packageId },
        select: { id: true, title: true, riseCpv: true },
    });
    if (!pkg) {
        console.error(`Package ${packageId} not found`);
        process.exitCode = 1;
        return;
    }
    console.log(`\n${pkg.title} [${pkg.id}]\n  riseCpv = ${pkg.riseCpv ?? '(null)'}`);
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
    console.log('  Cleared — it re-seeds from the next registrations that agree.');
}
async function setIndexSpaceVerified(packageId, verified) {
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
        console.error(`Package ${pkg.id} has no riseProbeJson object — nothing to ${verified ? 'verify' : 'unverify'}`);
        process.exitCode = 1;
        return;
    }
    const record = probe;
    const current = record.riseIndexSpaceVerified === true;
    console.log(`\n${pkg.title} [${pkg.id}]\n  riseIndexSpaceRisk     = ${typeof record.riseIndexSpaceRisk === 'string'
        ? record.riseIndexSpaceRisk
        : '(none)'}\n  riseIndexSpaceVerified = ${current}`);
    if (current === verified) {
        console.log('  Already set — nothing to do.');
        return;
    }
    if (verified && typeof record.riseIndexSpaceRisk !== 'string') {
        console.log('  NOTE: no riseIndexSpaceRisk on this package — the flag has no effect.');
    }
    if (!APPLY) {
        console.log(`  DRY RUN — re-run with --apply to ${verified ? 'set' : 'remove'} it.`);
        return;
    }
    if (!(await confirmWrite(`${verified ? 'Set' : 'Remove'} riseIndexSpaceVerified for package ${pkg.id}`))) {
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
                : rest),
        },
    });
    console.log(verified
        ? '  Set — per-lesson progress applies from the next postback or reconcile pass.'
        : '  Removed — the package is back on binary progress.');
}
async function publishGateProblems(courseId) {
    const ready = await prisma.scormPackage.findFirst({
        where: { courseId, status: client_1.ScormPackageStatus.READY },
        orderBy: { versionNumber: 'desc' },
        select: { id: true, sectionId: true, lessons: true },
    });
    const expected = (0, scorm_publish_gate_1.scormPackageSectionIds)(ready);
    if (expected.size === 0) {
        return ['no READY package with sections — import the package first'];
    }
    const candidates = await prisma.section.findMany({
        where: (0, scorm_publish_gate_1.scormGateCandidateSectionsWhere)(courseId),
        select: { id: true, isActive: true },
    });
    return (0, scorm_publish_gate_1.evaluateScormPublishGate)(expected, candidates).problems;
}
async function publishCourse(versions, courseId) {
    try {
        const problems = await publishGateProblems(courseId);
        if (problems.length > 0) {
            console.log(`SKIP  publish course ${courseId} — fails the publish gate:\n` +
                problems.map((p) => `      ${p}`).join('\n'));
            return { kind: 'gated', problems };
        }
        const v = await versions.publishNewVersion(null, courseId, 'SCORM lesson backfill');
        const versionNumber = v && typeof v === 'object' && 'versionNumber' in v
            ? v.versionNumber
            : undefined;
        console.log(`PUBLISHED course ${courseId}${versionNumber ? ` → v${versionNumber}` : ''}`);
        return { kind: 'published', versionNumber };
    }
    catch (err) {
        const message = err?.message ?? String(err);
        console.log(`FAIL  publish course ${courseId}\n      ${message}`);
        return { kind: 'failed', message };
    }
}
async function publishOnly(courseId) {
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
        console.log(problems.length > 0
            ? `  Fails the publish gate:\n${problems
                .map((p) => `    ${p}`)
                .join('\n')}`
            : '  Passes the publish gate. DRY RUN — re-run with --apply to publish.');
        if (problems.length > 0)
            process.exitCode = 1;
        return;
    }
    if (!(await confirmWrite(`Publish a new version of course ${courseId}`))) {
        process.exitCode = 1;
        return;
    }
    const result = await publishCourse(new course_version_service_1.CourseVersionService(prisma), courseId);
    if (result.kind !== 'published')
        process.exitCode = 1;
}
async function explainUnselectedPackage(packageId) {
    const pkg = await prisma.scormPackage.findUnique({
        where: { id: packageId },
        select: { id: true, status: true, lessonCount: true, courseId: true },
    });
    if (!pkg) {
        console.error(`Package ${packageId} not found.`);
        process.exitCode = 1;
    }
    else if (pkg.status !== client_1.ScormPackageStatus.READY) {
        console.error(`Package ${packageId} is ${pkg.status}, not READY — only the live package of a course is backfilled.`);
        process.exitCode = 1;
    }
    else {
        console.log(`Package ${packageId} already has a lesson manifest (${pkg.lessonCount ?? '?'} lessons) — nothing to backfill. If its course was never published ` +
            `after an earlier backfill, run --publish-only=${pkg.courseId}.`);
    }
}
async function main() {
    const modes = [
        RESET_CPV,
        VERIFY_INDEX_SPACE,
        UNVERIFY_INDEX_SPACE,
        PUBLISH_ONLY,
    ].filter(Boolean).length;
    if (modes > 1 || (modes === 1 && (ONLY_PACKAGE || FORCE || NO_PUBLISH))) {
        usageError('Pass at most one of --reset-cpv / --verify-index-space / --unverify-index-space / --publish-only, without backfill options');
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
        await setIndexSpaceVerified((VERIFY_INDEX_SPACE ?? UNVERIFY_INDEX_SPACE), !!VERIFY_INDEX_SPACE);
        return;
    }
    if (!APP_ID || !SECRET) {
        console.error('SCORM_CLOUD_APP_ID / SCORM_CLOUD_SECRET_KEY are required');
        process.exit(1);
    }
    console.log(`\nSCORM lesson backfill — ${APPLY ? 'APPLY' : 'DRY RUN (writes nothing)'}${FORCE ? '  --force' : ''}${APPLY ? (PUBLISH ? '  (publishing)' : '  --no-publish') : ''}\n`);
    if (!APPLY)
        console.log(`Target DB: ${describeDbTarget(rawUrl)}\n`);
    const packages = await prisma.scormPackage.findMany({
        where: {
            status: client_1.ScormPackageStatus.READY,
            lessons: { equals: client_1.Prisma.DbNull },
            ...(ONLY_PACKAGE ? { id: ONLY_PACKAGE } : {}),
        },
        orderBy: { createdAt: 'asc' },
    });
    if (packages.length === 0) {
        if (ONLY_PACKAGE) {
            await explainUnselectedPackage(ONLY_PACKAGE);
        }
        else {
            console.log('Nothing to backfill — every READY package has a lesson manifest.');
        }
        return;
    }
    if (APPLY &&
        !(await confirmWrite(`Backfill ${packages.length} package(s)`))) {
        process.exitCode = 1;
        return;
    }
    let materialised = 0;
    let skipped = 0;
    const failures = [];
    const touchedCourses = new Set();
    for (const pkg of packages) {
        const label = `${pkg.title} [${pkg.id}]`;
        try {
            const outcome = await backfillOne(pkg, label);
            if (outcome === 'materialised') {
                materialised += 1;
                if (APPLY)
                    touchedCourses.add(pkg.courseId);
            }
            else {
                skipped += 1;
            }
        }
        catch (err) {
            const message = err?.message ?? String(err);
            console.log(`FAIL  ${label}\n      ${message}`);
            failures.push({ label, message });
        }
    }
    const published = [];
    if (PUBLISH) {
        const versions = new course_version_service_1.CourseVersionService(prisma);
        for (const courseId of touchedCourses) {
            const result = await publishCourse(versions, courseId);
            if (result.kind === 'published') {
                published.push(courseId);
            }
            else {
                failures.push({
                    label: `publish ${courseId}`,
                    message: result.kind === 'gated'
                        ? `publish gate: ${result.problems.join('; ')}`
                        : result.message,
                });
            }
        }
    }
    console.log(`\n${APPLY ? 'Materialised' : 'Would materialise'}: ${materialised}   Skipped: ${skipped}   Failed: ${failures.length}`);
    if (failures.length > 0) {
        console.log('\nFAILURES:');
        for (const f of failures)
            console.log(`  ${f.label}\n    ${f.message}`);
        process.exitCode = 1;
    }
    if (!APPLY && materialised > 0) {
        console.log('\nRe-run with --apply to write.');
    }
    const unpublished = [...touchedCourses].filter((c) => !published.includes(c));
    if (unpublished.length > 0) {
        console.log('\n' +
            '================================================================\n' +
            ' ACTION REQUIRED — these courses have new lesson sections that NO\n' +
            ' published version references yet. Publish a new version for each\n' +
            ' (fix any publish-gate problem above first):\n' +
            unpublished
                .map((c) => `   ${c}\n     yarn script:backfill-scorm-lessons --publish-only=${c}`)
                .join('\n') +
            '\n================================================================');
    }
    if (APPLY && materialised > 0) {
        console.log('\nNOTE:\n' +
            '  Learners already pinned keep their one-section curriculum (and their\n' +
            '  binary progress) until re-pinned — that is correct, it is the\n' +
            '  curriculum they enrolled on. UNPINNED learners mid-course read 0%\n' +
            '  until their next postback or reconcile pass re-decodes suspendData\n' +
            '  against the new sections. Certified learners are unaffected\n' +
            '  (completion freezes them at 100%).');
    }
}
async function backfillOne(pkg, label) {
    if (!pkg.sectionId) {
        console.log(`SKIP  ${label}\n      READY but no sectionId — data invariant violation, leaving alone`);
        return 'skipped';
    }
    let asset;
    try {
        asset = await fetchRuntimeData(pkg.scormCloudCourseId);
    }
    catch (err) {
        console.log(`SKIP  ${label}\n      Cloud error: ${err.message}`);
        return 'skipped';
    }
    if (asset === null) {
        console.log(`SKIP  ${label}\n      Cloud course is gone (404) — stays on one section, binary progress`);
        return 'skipped';
    }
    const probe = (0, rise_probe_1.parseRiseRuntimeData)(asset);
    const lessons = probe.lessons;
    if (lessons.length === 0) {
        console.log(`SKIP  ${label}\n      No lesson manifest (non-Rise or unreadable) — correct as one section`);
        return 'skipped';
    }
    const indexWarning = (0, scorm_service_1.riseIndexSpaceWarning)(probe.riseIndexSpaceRisk);
    if (indexWarning) {
        console.log(`RISK  ${label}\n      ${probe.riseIndexSpaceRisk}`);
        if (!FORCE) {
            console.log('      SKIPPED — decoded lesson indices may not key these sections; --force to backfill anyway');
            return 'skipped';
        }
    }
    const oldSection = await prisma.section.findUnique({
        where: { id: pkg.sectionId },
        select: { chapterId: true, moduleId: true, config: true },
    });
    if (!oldSection?.chapterId || !oldSection.moduleId) {
        console.log(`SKIP  ${label}\n      Existing section is missing chapter/module`);
        return 'skipped';
    }
    console.log(`${APPLY ? 'APPLY' : 'WOULD'} ${label}\n      ${lessons.length} lessons → ${lessons.length} sections in chapter ${oldSection.chapterId}`);
    for (const lesson of lessons.slice(0, 3)) {
        console.log(`        [${lesson.index}] ${lesson.type.padEnd(6)} ${lesson.title.slice(0, 60)}`);
    }
    if (lessons.length > 3)
        console.log(`        … ${lessons.length - 3} more`);
    if (!APPLY)
        return 'materialised';
    const skipReason = await prisma.$transaction(async (tx) => {
        const [{ locked }] = await tx.$queryRaw(client_1.Prisma.sql `SELECT pg_try_advisory_xact_lock(hashtextextended(${pkg.id}, ${scorm_service_1.TREE_LOCK_SEED}))
                     AND pg_try_advisory_xact_lock(hashtextextended(${pkg.courseId}, ${scorm_service_1.COURSE_TREE_LOCK_SEED})) AS locked`);
        if (!locked)
            return 'an import holds the tree lock for this package/course';
        const fresh = await tx.scormPackage.findUnique({
            where: { id: pkg.id },
            select: { status: true, lessons: true, sectionId: true },
        });
        if (!fresh)
            return 'package no longer exists';
        if (fresh.status !== client_1.ScormPackageStatus.READY) {
            return `status is now ${fresh.status}`;
        }
        if (fresh.lessons !== null)
            return 'already has a lesson manifest';
        if (fresh.sectionId !== pkg.sectionId)
            return 'sectionId changed';
        const live = await tx.section.findUnique({
            where: { id: pkg.sectionId },
            select: { isArchived: true, chapterId: true },
        });
        if (!live || live.isArchived || live.chapterId !== oldSection.chapterId) {
            return 'its section was archived or moved';
        }
        await tx.section.update({
            where: { id: pkg.sectionId },
            data: { isArchived: true, archivedAt: new Date() },
        });
        const baseConfig = (oldSection.config ?? {});
        const manifest = lessons.map((lesson) => ({
            index: lesson.index,
            id: lesson.id,
            title: lesson.title,
            type: lesson.type,
            sectionId: (0, crypto_1.randomUUID)(),
        }));
        await tx.section.createMany({
            data: manifest.map((lesson) => ({
                id: lesson.sectionId,
                title: lesson.title,
                description: '',
                chapterId: oldSection.chapterId,
                moduleId: oldSection.moduleId,
                type: client_1.SectionType.SCORM,
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
                lessons: manifest,
                lessonCount: manifest.length,
                riseProbeJson: probe,
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
        const repointed = await tx.scormRegistration.updateMany({
            where: { packageId: pkg.id, completedAt: null },
            data: {
                lessonsCompleted: null,
                lessonsCompletedIndices: [],
                progressSource: null,
                lastRuntimePullAt: null,
                lastRuntimeAppliedAt: null,
            },
        });
        if (repointed.count > 0) {
            console.log(`      re-pointed ${repointed.count} registration(s) — their lesson progress re-decodes on the next postback or reconcile pass`);
        }
        return null;
    }, { timeout: 30000, maxWait: 10000 });
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
//# sourceMappingURL=backfill-scorm-lessons.js.map