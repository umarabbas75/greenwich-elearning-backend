/**
 * audit-phase4-impact.ts   (READ-ONLY — issues no writes)
 *
 * Measures the real blast radius of the two Phase 4 jobs BEFORE running them:
 *
 *   1. Version-drift reconcile — courses whose LIVE tree no longer matches their
 *      current `isLatest` published version (a failed/skipped past auto-publish).
 *      The reconcile publishes a catch-up version so `latest` == live AND pins
 *      that course's active-unpinned enrollments to it.
 *
 *   2. Null-enrollment backfill — pins ACTIVE, still-unpinned enrollments
 *      (enrolledVersionId = NULL) to their course's current latest, matching the
 *      app's freeze-at-activation rule. Started-ness does NOT gate the pin; it is
 *      reported here only as a visual-impact overlay (started learners are the
 *      ones who could notice if pinned to a stale, pre-reconcile latest).
 *
 * It uses the SAME buildManifestFromLiveTree + computeStructuralFingerprint the
 * production publish path uses, so "drift" here means exactly what the reconcile
 * would act on. Nothing is mutated.
 *
 *   yarn ts-node -r tsconfig-paths/register scripts/audit-phase4-impact.ts
 */

import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import {
  buildManifestFromLiveTree,
  computeStructuralFingerprint,
  parseManifest,
} from '../src/course-version/course-version.manifest';
import { buildStartedSet, startedKey } from './lib/started-set';

dotenv.config();

const datasourceUrl =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
if (!datasourceUrl) {
  console.error('DIRECT_DATABASE_URL (or DATABASE_URL) is required');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: { db: { url: datasourceUrl } },
});


async function main() {
  console.log('\n=== PHASE 4 IMPACT AUDIT (READ-ONLY) ===\n');

  const courses = await prisma.course.findMany({
    select: { id: true, title: true },
    orderBy: { title: 'asc' },
  });

  // ── A. Version drift ────────────────────────────────────────────────────
  let withPublished = 0;
  const driftCourses: Array<{
    id: string;
    title: string;
    latestVersion: number;
    liveSections: number;
    latestSections: number;
    enrollTotal: number;
    enrollPinned: number;
    enrollLive: number;
  }> = [];
  const driftCourseIds = new Set<string>();

  for (const course of courses) {
    const latest = await prisma.courseVersion.findFirst({
      where: { courseId: course.id, isLatest: true },
      select: { versionNumber: true, manifest: true },
    });
    if (!latest) continue; // no published version → not a reconcile target
    withPublished++;

    const latestManifest = parseManifest(latest.manifest);
    if (!latestManifest) continue;

    const built = await buildManifestFromLiveTree(prisma, course.id);
    const drift =
      computeStructuralFingerprint(latestManifest) !==
      computeStructuralFingerprint(built.manifest);
    if (!drift) continue;

    driftCourseIds.add(course.id);
    const [enrollTotal, enrollLive] = await Promise.all([
      prisma.userCourse.count({ where: { courseId: course.id } }),
      prisma.userCourse.count({
        where: { courseId: course.id, enrolledVersionId: null },
      }),
    ]);
    const latestSections = latestManifest.modules.reduce(
      (s, m) => s + m.chapters.reduce((c, ch) => c + ch.sectionIds.length, 0),
      0,
    );
    driftCourses.push({
      id: course.id,
      title: course.title,
      latestVersion: latest.versionNumber,
      liveSections: built.sectionCount,
      latestSections,
      enrollTotal,
      enrollPinned: enrollTotal - enrollLive,
      enrollLive,
    });
  }

  console.log('── A. Version drift (reconcile target) ──');
  console.log(`  Courses total:                 ${courses.length}`);
  console.log(`  Courses with a published ver:  ${withPublished}`);
  console.log(`  Courses DRIFTED (live≠latest): ${driftCourses.length}`);
  for (const d of driftCourses) {
    console.log(
      `    • "${d.title}"  latest=v${d.latestVersion}  sections live=${d.liveSections}/latest=${d.latestSections}  enrollments: ${d.enrollTotal} (pinned ${d.enrollPinned}, live ${d.enrollLive})`,
    );
  }

  // ── B. Enrollment pinning ───────────────────────────────────────────────
  const [enrollTotal, enrollNull] = await Promise.all([
    prisma.userCourse.count(),
    prisma.userCourse.count({ where: { enrolledVersionId: null } }),
  ]);

  // Null enrollments split by isActive — the backfill (and the app's
  // pin-on-publish) only pin ACTIVE ones; inactive-null stay NULL (pin at
  // activation).
  const nullEnrollments = await prisma.userCourse.findMany({
    where: { enrolledVersionId: null },
    select: { userId: true, courseId: true, isActive: true },
  });

  const started = await buildStartedSet(prisma);

  // Courses that have a published latest (backfill/pin can target) vs not.
  const publishedCourseIds = new Set<string>();
  for (const c of courses) {
    const has = await prisma.courseVersion.count({
      where: { courseId: c.id, isLatest: true },
    });
    if (has > 0) publishedCourseIds.add(c.id);
  }

  const activeNull = nullEnrollments.filter((e) => e.isActive);
  const inactiveNull = nullEnrollments.filter((e) => !e.isActive);
  const targets = activeNull.filter((e) => publishedCourseIds.has(e.courseId));
  const targetsNoVersion = activeNull.filter(
    (e) => !publishedCourseIds.has(e.courseId),
  );
  const targetsStarted = targets.filter((e) =>
    started.has(startedKey(e.userId, e.courseId)),
  );
  const targetsOnDrift = targets.filter((e) => driftCourseIds.has(e.courseId));
  const targetsOnDriftStarted = targetsOnDrift.filter((e) =>
    started.has(startedKey(e.userId, e.courseId)),
  );

  console.log('\n── B. Enrollment pinning ──');
  console.log(`  Enrollments total:                 ${enrollTotal}`);
  console.log(`    Pinned (enrolledVersionId set):  ${enrollTotal - enrollNull}`);
  console.log(`    Unpinned (NULL → served live):   ${enrollNull}`);
  console.log(`      active   (backfill/pin target): ${activeNull.length}`);
  console.log(`      inactive (stay NULL, pin at activation): ${inactiveNull.length}`);
  console.log(
    `  Backfill/pin targets (active + course has a published version): ${targets.length}`,
  );
  console.log(`      of which started (visual-impact overlay): ${targetsStarted.length}`);
  console.log(`      of which on a DRIFTED course: ${targetsOnDrift.length} (started: ${targetsOnDriftStarted.length})`);
  console.log(
    `      active but course has NO published version (stay NULL): ${targetsNoVersion.length}`,
  );

  console.log('\n── Impact summary ──');
  console.log(
    `  • Reconcile touches ${driftCourses.length} course(s): publishes a catch-up version AND pins that course's active-unpinned enrollments to it (visually a no-op — the published version equals the live tree they already see).`,
  );
  console.log(
    `  • Backfill pins ${targets.length} active-unpinned enrollment(s) (matching the app's freeze-at-activation rule). ${targetsNoVersion.length} active-unpinned on unpublished courses stay NULL; ${inactiveNull.length} inactive-unpinned stay NULL.`,
  );
  console.log(
    `  • ORDER-SENSITIVE set: ${targetsOnDriftStarted.length} started enrollment(s) sit on a still-drifted course — run reconcile BEFORE backfill so they pin to live, not a stale latest.`,
  );
  console.log(
    `  • ${enrollTotal - enrollNull} already-pinned learners are untouched by both jobs.\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
