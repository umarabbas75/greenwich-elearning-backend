/**
 * Shared "has this (user,course) started?" detector for the Phase 4 scripts.
 *
 * The audit's whole value is predicting what the backfill will do, so BOTH must
 * use the same definition of "started" — otherwise that guarantee holds only by
 * luck. Single source of truth, imported by both.
 */

import { PrismaClient } from '@prisma/client';

export const startedKey = (userId: string, courseId: string): string =>
  `${userId}|${courseId}`;

/** (userId,courseId) pairs showing ANY sign of having started the course. */
export async function buildStartedSet(
  prisma: PrismaClient,
): Promise<Set<string>> {
  const started = new Set<string>();

  // chapterId -> courseId and assessmentId -> courseId (for signals not keyed
  // directly by course).
  const [chapters, assessments] = await Promise.all([
    prisma.chapter.findMany({
      select: { id: true, module: { select: { courseId: true } } },
    }),
    prisma.assessment.findMany({ select: { id: true, courseId: true } }),
  ]);
  const chapterToCourse = new Map(
    chapters.map((c) => [c.id, c.module?.courseId]),
  );
  const assessmentToCourse = new Map(
    assessments.map((a) => [a.id, a.courseId]),
  );

  // Signals keyed directly by (userId, courseId).
  const directLoaders: Array<
    () => Promise<Array<{ userId: string; courseId: string }>>
  > = [
    () =>
      prisma.userCourseProgress.findMany({
        select: { userId: true, courseId: true },
        distinct: ['userId', 'courseId'],
      }),
    () =>
      prisma.lastSeenSection.findMany({
        select: { userId: true, courseId: true },
        distinct: ['userId', 'courseId'],
      }),
    () =>
      prisma.userChapterCompletion.findMany({
        select: { userId: true, courseId: true },
        distinct: ['userId', 'courseId'],
      }),
    () =>
      prisma.userModuleCompletion.findMany({
        select: { userId: true, courseId: true },
        distinct: ['userId', 'courseId'],
      }),
    () =>
      prisma.userFormCompletion.findMany({
        select: { userId: true, courseId: true },
        distinct: ['userId', 'courseId'],
      }),
    () =>
      prisma.courseCompletion.findMany({
        select: { userId: true, courseId: true },
        distinct: ['userId', 'courseId'],
      }),
  ];
  for (const load of directLoaders) {
    for (const r of await load()) {
      if (r.userId && r.courseId) started.add(startedKey(r.userId, r.courseId));
    }
  }

  // Signals keyed by chapterId -> resolve courseId.
  const chapterSignals = await Promise.all([
    prisma.quizProgress.findMany({
      select: { userId: true, chapterId: true },
      distinct: ['userId', 'chapterId'],
    }),
    prisma.quizAnswer.findMany({
      select: { userId: true, chapterId: true },
      distinct: ['userId', 'chapterId'],
    }),
  ]);
  for (const rows of chapterSignals) {
    for (const r of rows) {
      const courseId = chapterToCourse.get(r.chapterId);
      if (r.userId && courseId) started.add(startedKey(r.userId, courseId));
    }
  }

  // Assessment attempts -> resolve courseId.
  const attempts = await prisma.assessmentAttempt.findMany({
    select: { userId: true, assessmentId: true },
    distinct: ['userId', 'assessmentId'],
  });
  for (const a of attempts) {
    const courseId = assessmentToCourse.get(a.assessmentId);
    if (a.userId && courseId) started.add(startedKey(a.userId, courseId));
  }

  return started;
}
