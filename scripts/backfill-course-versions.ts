/**
 * backfill-course-versions.ts
 *
 * One-time (idempotent) data migration:
 *   1. For every Course, create CourseVersion v1 (PUBLISHED, isLatest=true) if none exists.
 *   2. Snapshot the live tree into CourseVersion* rows.
 *   3. Pin every started enrollment (active, has progress, or has completion) to v1.
 *
 * Uses DIRECT_DATABASE_URL when set — required for long interactive transactions
 * (PgBouncer pooler URLs will hit "Transaction already closed").
 *
 *   yarn ts-node -r tsconfig-paths/register scripts/backfill-course-versions.ts
 *   yarn ts-node -r tsconfig-paths/register scripts/backfill-course-versions.ts --dry-run
 */

import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import {
  SNAPSHOT_TRANSACTION_OPTIONS,
  snapshotLiveTree,
} from '../src/course-version/course-version.snapshot';

dotenv.config();

const dryRun = process.argv.includes('--dry-run');

// Prefer direct connection for migration scripts — avoids PgBouncer tx timeout.
const datasourceUrl =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';

if (!datasourceUrl) {
  console.error('DATABASE_URL (or DIRECT_DATABASE_URL) is required');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: { db: { url: datasourceUrl } },
});

async function countLiveSections(courseId: string): Promise<number> {
  return prisma.section.count({
    where: {
      isArchived: false,
      chapter: {
        isArchived: false,
        module: { courseId, isArchived: false },
      },
    },
  });
}

/** Remove v1 rows left behind by a failed/partial snapshot so we can retry. */
async function resolveV1(courseId: string) {
  const v1 = await prisma.courseVersion.findFirst({
    where: { courseId, versionNumber: 1 },
    include: { _count: { select: { sections: true } } },
  });
  if (!v1) return null;

  const liveSections = await countLiveSections(courseId);
  if (liveSections > 0 && v1._count.sections === 0) {
    console.log(
      `    ⚠ Removing incomplete v1 (0 snapshotted sections, ${liveSections} live)`,
    );
    await prisma.courseVersion.delete({ where: { id: v1.id } });
    return null;
  }

  return v1;
}

async function main() {
  console.log(`\n📦 Course version backfill${dryRun ? ' (DRY RUN)' : ''}\n`);
  console.log(
    `Using ${process.env.DIRECT_DATABASE_URL ? 'DIRECT_DATABASE_URL' : 'DATABASE_URL'}\n`,
  );

  const courses = await prisma.course.findMany({
    select: { id: true, title: true },
    orderBy: { title: 'asc' },
  });

  console.log(`Found ${courses.length} course(s)\n`);

  let versionsCreated = 0;
  let enrollmentsPinned = 0;

  for (const course of courses) {
    let version = dryRun
      ? await prisma.courseVersion.findFirst({
          where: { courseId: course.id, versionNumber: 1 },
        })
      : await resolveV1(course.id);

    if (!version) {
      console.log(`  + Creating v1 for "${course.title}" (${course.id})`);

      if (!dryRun) {
        const snapshot = await prisma.$transaction(async (tx) => {
          await tx.courseVersion.updateMany({
            where: { courseId: course.id, isLatest: true },
            data: { isLatest: false },
          });

          return snapshotLiveTree(tx, course.id, {
            versionNumber: 1,
            status: 'PUBLISHED',
            isLatest: true,
            publishedAt: new Date(),
            changeNotes: 'Initial backfill from live tree',
          });
        }, SNAPSHOT_TRANSACTION_OPTIONS);

        version = await prisma.courseVersion.findUnique({
          where: { id: snapshot.versionId },
        });
        versionsCreated++;
        console.log(
          `    → ${snapshot.sectionCount} sections, ${snapshot.chapterCount} chapters, ${snapshot.quizCount} quizzes`,
        );
      } else {
        versionsCreated++;
      }
    } else {
      console.log(`  ✓ v1 already exists for "${course.title}"`);
    }

    if (!version && dryRun) continue;

    const versionId = version!.id;

    const [progressRows, completionRows, activeEnrollments] = await Promise.all([
      prisma.userCourseProgress.findMany({
        where: { courseId: course.id },
        select: { userId: true },
        distinct: ['userId'],
      }),
      prisma.courseCompletion.findMany({
        where: { courseId: course.id },
        select: { userId: true },
      }),
      prisma.userCourse.findMany({
        where: { courseId: course.id, isActive: true },
        select: { id: true, userId: true },
      }),
    ]);

    const userIdsToPin = new Set<string>([
      ...progressRows.map((r) => r.userId),
      ...completionRows.map((r) => r.userId),
      ...activeEnrollments.map((e) => e.userId),
    ]);

    const enrollments = await prisma.userCourse.findMany({
      where: {
        courseId: course.id,
        enrolledVersionId: null,
        userId: { in: [...userIdsToPin] },
      },
      select: { id: true, userId: true },
    });

    if (enrollments.length === 0) continue;

    console.log(
      `    Pinning ${enrollments.length} enrollment(s) to v1 for "${course.title}"`,
    );

    if (!dryRun) {
      await prisma.userCourse.updateMany({
        where: { id: { in: enrollments.map((e) => e.id) } },
        data: { enrolledVersionId: versionId },
      });
    }
    enrollmentsPinned += enrollments.length;
  }

  console.log('\n── Summary ──');
  console.log(`  Versions created:     ${versionsCreated}`);
  console.log(`  Enrollments pinned: ${enrollmentsPinned}`);
  console.log(dryRun ? '\n(dry run — no writes)\n' : '\nDone.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
