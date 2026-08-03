/**
 * reconcile-course-version-drift.ts
 *
 * PERIODIC reconcile (NOT one-time): finds courses whose LIVE curriculum no
 * longer matches their current `isLatest` published version (a past structural
 * edit whose auto-publish failed or was skipped), and publishes ONE catch-up
 * version so `latest` == live again.
 *
 * Drift can RECUR by design: auto-publish is best-effort (a failure is only a log
 * line) and the try-lock drops a contended publish rather than queueing it. So
 * schedule this on a cadence and/or alert on the "Auto-publish failed" and
 * "Another publish is already in progress" log lines so recurrence is visible
 * rather than discovered by the next manual run.
 *
 * Uses the real CourseVersionService.publishNewVersion — the same advisory-locked,
 * single-build, fingerprint-deduped path the app uses — so it can't create a
 * duplicate/no-op version and is safe to re-run (a second run finds no drift and
 * skips).
 *
 * IMPACT — this touches TWO tables. publishNewVersion (a) inserts a course_versions
 * row AND (b) pins every ACTIVE, still-unpinned enrollment on that course to the
 * new version (user_courses write). Visually it is a no-op for those learners: the
 * version we publish IS the live tree at that instant, which is exactly what an
 * unpinned learner was already being served. Already-pinned learners are untouched.
 * The dry-run below reports the active-unpinned count per drifted course — that is
 * the real learner-facing blast radius of --apply.
 *
 * NOTE: this loop is not resumable — if it throws after publishing course k of N,
 * courses 1..k are done and k+1..N are not. Safe to re-run: reconcile is
 * idempotent (a re-run finds the already-reconciled courses no longer drifted).
 *
 * DRY-RUN BY DEFAULT — pass --apply to actually publish + pin.
 *   Preview:  npx ts-node -r tsconfig-paths/register scripts/reconcile-course-version-drift.ts
 *   Apply:    npx ts-node -r tsconfig-paths/register scripts/reconcile-course-version-drift.ts --apply
 */

import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { CourseVersionService } from '../src/course-version/course-version.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  buildManifestFromLiveTree,
  computeStructuralFingerprint,
  parseManifest,
} from '../src/course-version/course-version.manifest';

dotenv.config();

const apply = process.argv.includes('--apply');

// Prefer the DIRECT (non-pooled) connection — the publish runs an interactive
// transaction with a per-course advisory lock, which is safest off the pooler.
const rawDatasourceUrl =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
if (!rawDatasourceUrl) {
  console.error('DIRECT_DATABASE_URL (or DATABASE_URL) is required');
  process.exit(1);
}


/**
 * Neon cold-start regularly exceeds libpq's 5s default and DIRECT_DATABASE_URL
 * usually carries no query string (it exists for `prisma migrate`), so a
 * long-running script can P1001 partway through. Force a generous
 * connect_timeout unless the URL already sets one.
 */
function withConnectTimeout(url: string, seconds = 30): string {
  if (/[?&]connect_timeout=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}connect_timeout=${seconds}`;
}

const datasourceUrl = withConnectTimeout(rawDatasourceUrl);

const prisma = new PrismaClient({ datasources: { db: { url: datasourceUrl } } });
const service = new CourseVersionService(prisma as unknown as PrismaService);

async function main() {
  console.log(
    `\n🔧 Course version drift reconcile — ${apply ? 'APPLY' : 'DRY-RUN'}\n`,
  );

  const courses = await prisma.course.findMany({
    select: { id: true, title: true },
    orderBy: { title: 'asc' },
  });

  const drifted: Array<{
    id: string;
    title: string;
    latestVersion: number;
    activeUnpinned: number;
  }> = [];

  for (const course of courses) {
    const latest = await prisma.courseVersion.findFirst({
      where: { courseId: course.id, isLatest: true },
      select: { versionNumber: true, manifest: true },
    });
    if (!latest) continue;
    const latestManifest = parseManifest(latest.manifest);
    if (!latestManifest) continue;

    const built = await buildManifestFromLiveTree(prisma, course.id);
    const drift =
      computeStructuralFingerprint(latestManifest) !==
      computeStructuralFingerprint(built.manifest);
    if (drift) {
      // The learner-facing blast radius of --apply: publishNewVersion pins these
      // active, still-unpinned enrollments to the catch-up version.
      const activeUnpinned = await prisma.userCourse.count({
        where: { courseId: course.id, isActive: true, enrolledVersionId: null },
      });
      drifted.push({
        id: course.id,
        title: course.title,
        latestVersion: latest.versionNumber,
        activeUnpinned,
      });
    }
  }

  if (drifted.length === 0) {
    console.log('  ✓ No drift — every course\'s latest matches its live tree.\n');
    return;
  }

  const totalPinBlast = drifted.reduce((s, d) => s + d.activeUnpinned, 0);
  console.log(`  Found ${drifted.length} drifted course(s):`);
  for (const d of drifted) {
    console.log(
      `    • "${d.title}" (latest = v${d.latestVersion}) → would publish a new` +
        ` catch-up version and pin ${d.activeUnpinned} active-unpinned enrollment(s)`,
    );
  }
  console.log(
    `\n  Learner-facing blast radius: ${totalPinBlast} enrollment(s) would be pinned` +
      ` (visually a no-op — the published version equals the live tree they already see).`,
  );
  console.log();

  if (!apply) {
    console.log(
      '  DRY-RUN: no changes made. Each course above would get ONE new catch-up\n' +
        '  version (number derived from MAX(versionNumber)+1) AND its\n' +
        '  active-unpinned enrollments pinned to it. Already-pinned learners are\n' +
        '  unaffected. Re-run with --apply.\n',
    );
    return;
  }

  for (const d of drifted) {
    const result = await service.publishNewVersion(
      null,
      d.id,
      'Reconcile: sync latest published version to live tree',
    );
    const data = result.data as {
      skipped?: boolean;
      versionNumber?: number;
    };
    if (data?.skipped) {
      console.log(`    • "${d.title}": no change on re-check (skipped)`);
    } else {
      console.log(`    • "${d.title}": published v${data?.versionNumber}`);
    }
  }
  console.log('\n  ✓ Reconcile complete.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
