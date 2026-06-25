import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/** Matches frontend CHAPTER_QUIZ_PASS_PERCENTAGE until per-chapter config exists. */
export const DEFAULT_CHAPTER_QUIZ_PASS_PERCENTAGE = 70;

export function resolvePassingCriteria(stored?: number | null): number {
  if (stored != null && stored > 0) {
    return stored;
  }
  return DEFAULT_CHAPTER_QUIZ_PASS_PERCENTAGE;
}

export function isFreeRoamUser(
  email: string | null | undefined,
  config: ConfigService,
): boolean {
  if (!email) return false;
  const raw = config.get<string>('FREE_ROAM_EMAILS') ?? '';
  const allowlist = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.trim().toLowerCase());
}

export async function getCourseIdForChapter(
  prisma: PrismaService,
  chapterId: string,
): Promise<string | null> {
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: { module: { select: { courseId: true } } },
  });
  return chapter?.module?.courseId ?? null;
}

export async function getOrderedChapterIdsInCourse(
  prisma: PrismaService,
  courseId: string,
): Promise<string[]> {
  const modules = await prisma.module.findMany({
    where: { courseId, isArchived: false },
    orderBy: { createdAt: 'asc' },
    select: {
      chapters: {
        where: { isArchived: false },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  return modules.flatMap((m) => m.chapters.map((c) => c.id));
}

/**
 * Version-aware chapter ordering. If the user's enrollment is pinned to a
 * version, return that version's chapter ordering using sourceChapterId so
 * the result aligns with live chapter ids. Falls back to live tree.
 */
export async function getOrderedChapterIdsForUser(
  prisma: PrismaService,
  userId: string,
  courseId: string,
): Promise<string[]> {
  const uc = await prisma.userCourse.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { enrolledVersionId: true },
  });
  if (uc?.enrolledVersionId) {
    const versionModules = await prisma.courseVersionModule.findMany({
      where: { versionId: uc.enrolledVersionId },
      orderBy: { orderIndex: 'asc' },
      select: {
        chapters: {
          orderBy: { orderIndex: 'asc' },
          select: { sourceChapterId: true },
        },
      },
    });
    const ids = versionModules.flatMap((m) =>
      m.chapters
        .map((c) => c.sourceChapterId)
        .filter((id): id is string => Boolean(id)),
    );
    if (ids.length > 0) return ids;
  }
  return getOrderedChapterIdsInCourse(prisma, courseId);
}

export async function getPreviousChapterId(
  prisma: PrismaService,
  courseId: string,
  chapterId: string,
  userId?: string,
): Promise<string | null> {
  const ids = userId
    ? await getOrderedChapterIdsForUser(prisma, userId, courseId)
    : await getOrderedChapterIdsInCourse(prisma, courseId);
  const idx = ids.indexOf(chapterId);
  if (idx <= 0) return null;
  return ids[idx - 1];
}

export type ChapterQuizGrade = {
  score: number;
  isPassed: boolean;
  passingCriteria: number;
  totalQuestions: number;
  answeredQuestions: number;
};

export async function gradeChapterQuizFromStoredAnswers(
  prisma: PrismaService,
  userId: string,
  chapterId: string,
  storedPassingCriteria?: number | null,
): Promise<ChapterQuizGrade> {
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: {
      quizzes: { select: { id: true } },
      QuizProgress: {
        where: { userId },
        select: { passingCriteria: true },
        take: 1,
      },
    },
  });
  if (!chapter) {
    throw new Error('Chapter not found');
  }

  const quizIds = chapter.quizzes.map((q) => q.id);
  if (quizIds.length === 0) {
    throw new Error('This chapter has no quiz questions');
  }

  const answers = await prisma.quizAnswer.findMany({
    where: { userId, chapterId, quizId: { in: quizIds } },
    select: { quizId: true, isAnswerCorrect: true },
  });

  const passingCriteria = resolvePassingCriteria(
    storedPassingCriteria ?? chapter.QuizProgress[0]?.passingCriteria ?? null,
  );

  const answeredQuestions = answers.length;
  const correctCount = answers.filter((a) => a.isAnswerCorrect).length;
  const score =
    quizIds.length > 0
      ? Math.round((correctCount / quizIds.length) * 1000) / 10
      : 0;
  const isPassed = score >= passingCriteria;

  return {
    score,
    isPassed,
    passingCriteria,
    totalQuestions: quizIds.length,
    answeredQuestions,
  };
}

/**
 * Resolve the section/quiz denominator for a chapter respecting the learner's
 * version pin. A pinned learner's denominator is the snapshot count; an
 * unpinned learner sees the live (non-archived) count.
 */
async function resolveChapterDenominator(
  prisma: PrismaService,
  userId: string,
  chapterId: string,
): Promise<{ sectionCount: number; quizCount: number } | null> {
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: { module: { select: { courseId: true } } },
  });
  if (!chapter) return null;

  const uc = await prisma.userCourse.findUnique({
    where: {
      userId_courseId: { userId, courseId: chapter.module.courseId },
    },
    select: { enrolledVersionId: true },
  });

  if (uc?.enrolledVersionId) {
    const versionChapter = await prisma.courseVersionChapter.findFirst({
      where: {
        versionId: uc.enrolledVersionId,
        sourceChapterId: chapterId,
      },
      select: {
        _count: {
          select: {
            sections: { where: { isActive: true } },
            quizzes: true,
          },
        },
      },
    });
    if (versionChapter) {
      return {
        sectionCount: versionChapter._count.sections,
        quizCount: versionChapter._count.quizzes,
      };
    }
  }

  const [sectionCount, quizCount] = await Promise.all([
    prisma.section.count({
      where: { chapterId, isArchived: false, isActive: true },
    }),
    prisma.quiz.count({ where: { chapterId, isArchived: false } }),
  ]);
  return { sectionCount, quizCount };
}

export async function isChapterComplete(
  prisma: PrismaService,
  userId: string,
  chapterId: string,
): Promise<boolean> {
  const denom = await resolveChapterDenominator(prisma, userId, chapterId);
  if (!denom) return false;

  const [progressCount, chapter] = await Promise.all([
    prisma.userCourseProgress.count({
      where: { userId, chapterId },
    }),
    prisma.chapter.findUnique({
      where: { id: chapterId },
      select: {
        QuizProgress: {
          where: { userId },
          select: { isPassed: true },
          take: 1,
        },
      },
    }),
  ]);

  if (!chapter) return false;

  const { sectionCount, quizCount } = denom;
  if (sectionCount > 0 && progressCount < sectionCount) {
    return false;
  }

  if (quizCount === 0) {
    return sectionCount === 0 || progressCount >= sectionCount;
  }

  return chapter.QuizProgress[0]?.isPassed === true;
}

export async function assertChapterAccessible(
  prisma: PrismaService,
  config: ConfigService,
  userId: string,
  chapterId: string,
  userEmail?: string | null,
): Promise<void> {
  if (isFreeRoamUser(userEmail, config)) {
    return;
  }

  const courseId = await getCourseIdForChapter(prisma, chapterId);
  if (!courseId) {
    throw new ForbiddenException('Chapter not found');
  }

  const previousChapterId = await getPreviousChapterId(
    prisma,
    courseId,
    chapterId,
    userId,
  );
  if (!previousChapterId) {
    return;
  }

  const previousComplete = await isChapterComplete(
    prisma,
    userId,
    previousChapterId,
  );
  if (!previousComplete) {
    throw new ForbiddenException(
      'Complete the previous chapter (all sections and the chapter quiz) before continuing',
    );
  }
}

export function enrichQuizProgressReport<
  T extends { passingCriteria?: number },
>(report: T | null): T | null {
  if (!report) return null;
  return {
    ...report,
    passingCriteria: resolvePassingCriteria(report.passingCriteria),
  };
}
