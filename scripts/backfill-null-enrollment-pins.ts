/**
 * backfill-null-enrollment-pins.ts
 *
 * One-time backfill that matches the APP rule ("freeze at activation"): pins every
 * ACTIVE, still-unpinned enrollment (isActive = true, enrolledVersionId = NULL) to
 * its course's current `isLatest` published version.
 *
 * This deliberately mirrors publishNewVersion, which now pins all active unpinned
 * enrollments on every publish. Under "freeze at activation" an active enrollment
 * should ALWAYS be pinned; a NULL one is the anomaly from activation happening
 * before a version existed. Started-ness does NOT gate the pin (an earlier version
 * of this script claimed never-started NULLs should stay NULL — that was the
 * declined "freeze at first interaction" policy and contradicted the app). We
 * still REPORT the started/never-started split, purely as a visual-impact
 * overlay. INACTIVE unpinned enrollments are left NULL — they pin at activation.
 *
 * ORDER: run reconcile FIRST. This pins to the current latest; after reconcile,
 * latest == live, so an active learner sees the SAME content immediately after.
 * Pinning to a stale latest (a still-drifted course) could change what a STARTED
 * learner sees — the audit reports how many active-null enrollments sit on drifted
 * courses (the order-sensitive set). Note reconcile itself already pins the active
 * unpinned enrollments on any course it publishes, so after it runs this script
 * mostly mops up active-null enrollments on courses that did NOT drift/republish.
 *
 * The write is a conditional updateMany guarded by enrolledVersionId: null, so it
 * never overwrites an existing pin and is safe to re-run.
 *
 * DRY-RUN BY DEFAULT — pass --apply to actually pin.
 *   Preview:  npx ts-node -r tsconfig-paths/register scripts/backfill-null-enrollment-pins.ts
 *   Apply:    npx ts-node -r tsconfig-paths/register scripts/backfill-null-enrollment-pins.ts --apply
 *
 * NOTE: this loop is not resumable — if it throws mid-apply, some enrollments are
 * pinned and some are not. The write is idempotent (conditional on NULL), so
 * simply re-run it; already-pinned rows are skipped.
 */

import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { buildStartedSet, startedKey } from './lib/started-set';

dotenv.config();

const apply = process.argv.includes('--apply');

const datasourceUrl =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
if (!datasourceUrl) {
  console.error('DIRECT_DATABASE_URL (or DATABASE_URL) is required');
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: datasourceUrl } } });


async function main() {
  console.log(
    `\n🔧 Null-enrollment pin backfill — ${apply ? 'APPLY' : 'DRY-RUN'}\n`,
  );

  // Only ACTIVE unpinned enrollments (matches the app's pin-on-publish rule).
  // Inactive unpinned enrollments are intentionally left NULL — they pin at
  // activation.
  const [activeNull, started] = await Promise.all([
    prisma.userCourse.findMany({
      where: { enrolledVersionId: null, isActive: true },
      select: { id: true, userId: true, courseId: true },
    }),
    buildStartedSet(prisma),
  ]);

  // Resolve each course's current latest published version once.
  const courseIds = [...new Set(activeNull.map((e) => e.courseId))];
  const latestByCourse = new Map<string, { id: string; versionNumber: number }>();
  for (const courseId of courseIds) {
    const latest = await prisma.courseVersion.findFirst({
      where: { courseId, isLatest: true },
      select: { id: true, versionNumber: true },
    });
    if (latest) latestByCourse.set(courseId, latest);
  }

  const targets = activeNull.filter((e) => latestByCourse.has(e.courseId));
  const noVersion = activeNull.filter((e) => !latestByCourse.has(e.courseId));
  // Impact overlay only — does NOT gate the pin. Started learners are the ones
  // who could notice if pinned to a stale (pre-reconcile) latest.
  const targetsStarted = targets.filter((e) =>
    started.has(startedKey(e.userId, e.courseId)),
  );

  console.log(`  Active unpinned (NULL) enrollments:            ${activeNull.length}`);
  console.log(`  …course has a published latest (TARGETS):      ${targets.length}`);
  console.log(`      of which started (visual-impact overlay):  ${targetsStarted.length}`);
  console.log(`      of which never started (pinned anyway):    ${targets.length - targetsStarted.length}`);
  console.log(`  …course has NO published version (leave NULL): ${noVersion.length}\n`);

  if (targets.length === 0) {
    console.log('  ✓ Nothing to backfill.\n');
    return;
  }

  for (const t of targets) {
    const latest = latestByCourse.get(t.courseId)!;
    console.log(
      `    • user ${t.userId} / course ${t.courseId} → pin to v${latest.versionNumber}`,
    );
  }
  console.log();

  if (!apply) {
    console.log('  DRY-RUN: no changes made. Re-run with --apply to pin.\n');
    return;
  }

  let pinned = 0;
  for (const t of targets) {
    const latest = latestByCourse.get(t.courseId)!;
    // Conditional: only pins while still NULL — never overwrites an existing pin.
    const res = await prisma.userCourse.updateMany({
      where: { id: t.id, enrolledVersionId: null },
      data: { enrolledVersionId: latest.id },
    });
    pinned += res.count;
  }
  console.log(`  ✓ Pinned ${pinned} enrollment(s).\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
