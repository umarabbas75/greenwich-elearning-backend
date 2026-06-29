/**
 * backfill-chapter-module-completions.ts
 *
 * Seeds user_chapter_completions / user_module_completions for learners who
 * already finished chapters/modules before timestamp tracking existed.
 *
 *   yarn ts-node -r tsconfig-paths/register scripts/backfill-chapter-module-completions.ts --dry-run
 *   yarn ts-node -r tsconfig-paths/register scripts/backfill-chapter-module-completions.ts
 *   yarn ts-node -r tsconfig-paths/register scripts/backfill-chapter-module-completions.ts --courseId=<uuid>
 *   yarn ts-node -r tsconfig-paths/register scripts/backfill-chapter-module-completions.ts --email=learner@example.com
 */

import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import {
  getChapterIdsInModuleForUser,
  isChapterComplete,
} from '../src/utils/chapter-progression';

dotenv.config();

const dryRun = process.argv.includes('--dry-run');
const courseIdArg = process.argv.find((a) => a.startsWith('--courseId='));
const emailArg = process.argv.find((a) => a.startsWith('--email='));
const courseIdFilter = courseIdArg?.split('=')[1]?.trim();
const emailFilter = emailArg?.split('=')[1]?.trim().toLowerCase();

const datasourceUrl =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';

if (!datasourceUrl) {
  console.error('DATABASE_URL (or DIRECT_DATABASE_URL) is required');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: { db: { url: datasourceUrl } },
});

async function inferChapterCompletedAt(
  userId: string,
  chapterId: string,
): Promise<Date> {
  const [lastSection, quiz] = await Promise.all([
    prisma.userCourseProgress.findFirst({
      where: { userId, chapterId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.quizProgress.findFirst({
      where: { userId, chapterId, isPassed: true },
      select: { updatedAt: true },
    }),
  ]);

  const candidates = [lastSection?.createdAt, quiz?.updatedAt].filter(
    Boolean,
  ) as Date[];

  return candidates.length > 0
    ? new Date(Math.max(...candidates.map((d) => d.getTime())))
    : new Date();
}

async function main() {
  console.log(
    `\n📚 Backfill chapter/module completion timestamps${dryRun ? ' (DRY RUN)' : ''}\n`,
  );

  const enrollments = await prisma.userCourse.findMany({
    where: {
      ...(courseIdFilter ? { courseId: courseIdFilter } : {}),
      ...(emailFilter
        ? { user: { email: { equals: emailFilter, mode: 'insensitive' } } }
        : {}),
      user: { deletedAt: null },
    },
    select: {
      userId: true,
      courseId: true,
      enrolledVersionId: true,
      user: { select: { email: true } },
      course: { select: { title: true } },
    },
  });

  let chapterCreated = 0;
  let moduleCreated = 0;

  for (const enrollment of enrollments) {
    const { userId, courseId, enrolledVersionId, user, course } = enrollment;
    console.log(`→ ${user.email} | ${course.title}`);

    const modules = await prisma.module.findMany({
      where: { courseId, isArchived: false },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    for (const mod of modules) {
      const moduleCtx = await getChapterIdsInModuleForUser(
        prisma as any,
        userId,
        mod.id,
      );
      if (!moduleCtx) continue;

      for (const chapterId of moduleCtx.chapterIds) {
        const existing = await prisma.userChapterCompletion.findUnique({
          where: { userId_chapterId: { userId, chapterId } },
        });
        if (existing) continue;

        const complete = await isChapterComplete(
          prisma as any,
          userId,
          chapterId,
          { courseId, enrolledVersionId },
        );
        if (!complete) continue;

        const chapter = await prisma.chapter.findUnique({
          where: { id: chapterId },
          select: { moduleId: true },
        });
        if (!chapter) continue;

        const completedAt = await inferChapterCompletedAt(userId, chapterId);
        console.log(
          `  chapter ${chapterId.slice(0, 8)}… completedAt=${completedAt.toISOString()}`,
        );

        if (!dryRun) {
          await prisma.userChapterCompletion.create({
            data: {
              userId,
              courseId,
              moduleId: chapter.moduleId,
              chapterId,
              completedAt,
            },
          });
        }
        chapterCreated++;
      }

      const existingModule = await prisma.userModuleCompletion.findUnique({
        where: { userId_moduleId: { userId, moduleId: mod.id } },
      });
      if (existingModule) continue;

      const completedChapterCount = await prisma.userChapterCompletion.count({
        where: {
          userId,
          moduleId: mod.id,
          chapterId: { in: moduleCtx.chapterIds },
        },
      });
      if (completedChapterCount < moduleCtx.chapterIds.length) continue;

      const latestChapter = await prisma.userChapterCompletion.findFirst({
        where: { userId, moduleId: mod.id },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      });
      const completedAt = latestChapter?.completedAt ?? new Date();

      console.log(
        `  module ${mod.id.slice(0, 8)}… completedAt=${completedAt.toISOString()}`,
      );

      if (!dryRun) {
        await prisma.userModuleCompletion.create({
          data: {
            userId,
            courseId,
            moduleId: mod.id,
            completedAt,
          },
        });
      }
      moduleCreated++;
    }
  }

  console.log(
    `\nDone. chapter rows: ${chapterCreated}, module rows: ${moduleCreated}\n`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
