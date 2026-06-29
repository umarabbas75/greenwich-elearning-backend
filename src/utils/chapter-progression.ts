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

/** Optional pre-resolved enrollment context to skip redundant lookups. */
export type ChapterProgressContext = {
  courseId?: string;
  /** null = unpinned; undefined = lookup required */
  enrolledVersionId?: string | null;
};

export type ChapterAccessContext = {
  courseId?: string;
  /** When set (including null), skips userCourse lookup in the gate check. */
  enrolledVersionId?: string | null;
};

/** Chapter order from a pinned version snapshot (live chapter ids). */
export async function getOrderedChapterIdsForVersion(
  prisma: PrismaService,
  versionId: string,
): Promise<string[]> {
  const versionModules = await prisma.courseVersionModule.findMany({
    where: { versionId },
    orderBy: { orderIndex: 'asc' },
    select: {
      chapters: {
        orderBy: { orderIndex: 'asc' },
        select: { sourceChapterId: true },
      },
    },
  });
  return versionModules.flatMap((m) =>
    m.chapters
      .map((c) => c.sourceChapterId)
      .filter((id): id is string => Boolean(id)),
  );
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
    const ids = await getOrderedChapterIdsForVersion(
      prisma,
      uc.enrolledVersionId,
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
  ctx?: ChapterProgressContext,
): Promise<{ sectionCount: number; quizCount: number } | null> {
  let courseId = ctx?.courseId;
  let enrolledVersionId = ctx?.enrolledVersionId;

  if (courseId === undefined) {
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      select: { module: { select: { courseId: true } } },
    });
    if (!chapter) return null;
    courseId = chapter.module.courseId;
  }

  if (enrolledVersionId === undefined) {
    const uc = await prisma.userCourse.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { enrolledVersionId: true },
    });
    enrolledVersionId = uc?.enrolledVersionId ?? null;
  }

  if (enrolledVersionId) {
    const versionChapter = await prisma.courseVersionChapter.findFirst({
      where: {
        versionId: enrolledVersionId,
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
  ctx?: ChapterProgressContext,
): Promise<boolean> {
  const [denom, progressCount, quizProgress] = await Promise.all([
    resolveChapterDenominator(prisma, userId, chapterId, ctx),
    prisma.userCourseProgress.count({
      where: { userId, chapterId },
    }),
    prisma.quizProgress.findFirst({
      where: { userId, chapterId },
      select: { isPassed: true },
    }),
  ]);

  if (!denom) return false;

  const { sectionCount, quizCount } = denom;
  if (sectionCount > 0 && progressCount < sectionCount) {
    return false;
  }

  if (quizCount === 0) {
    return sectionCount === 0 || progressCount >= sectionCount;
  }

  return quizProgress?.isPassed === true;
}

export async function assertChapterAccessible(
  prisma: PrismaService,
  config: ConfigService,
  userId: string,
  chapterId: string,
  userEmail?: string | null,
  accessCtx?: ChapterAccessContext,
): Promise<void> {
  if (isFreeRoamUser(userEmail, config)) {
    return;
  }

  let courseId = accessCtx?.courseId;
  if (!courseId) {
    courseId = (await getCourseIdForChapter(prisma, chapterId)) ?? undefined;
  }
  if (!courseId) {
    throw new ForbiddenException('Chapter not found');
  }

  let enrolledVersionId = accessCtx?.enrolledVersionId;
  if (enrolledVersionId === undefined) {
    const uc = await prisma.userCourse.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { enrolledVersionId: true },
    });
    enrolledVersionId = uc?.enrolledVersionId ?? null;
  }

  const orderedIds = enrolledVersionId
    ? await getOrderedChapterIdsForVersion(prisma, enrolledVersionId)
    : await getOrderedChapterIdsInCourse(prisma, courseId);

  const idx = orderedIds.indexOf(chapterId);
  if (idx <= 0) {
    return;
  }

  const previousChapterId = orderedIds[idx - 1];
  const previousComplete = await isChapterComplete(
    prisma,
    userId,
    previousChapterId,
    { courseId, enrolledVersionId },
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

/** Live or version-pinned chapter ids belonging to a module for this learner. */
export async function getChapterIdsInModuleForUser(
  prisma: PrismaService,
  userId: string,
  moduleId: string,
): Promise<{ courseId: string; chapterIds: string[] } | null> {
  const module = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { courseId: true },
  });
  if (!module) return null;

  const enrollment = await prisma.userCourse.findUnique({
    where: {
      userId_courseId: { userId, courseId: module.courseId },
    },
    select: { enrolledVersionId: true },
  });

  if (enrollment?.enrolledVersionId) {
    const versionModule = await prisma.courseVersionModule.findFirst({
      where: {
        versionId: enrollment.enrolledVersionId,
        sourceModuleId: moduleId,
      },
      select: {
        chapters: {
          orderBy: { orderIndex: 'asc' },
          select: { sourceChapterId: true },
        },
      },
    });
    if (versionModule) {
      return {
        courseId: module.courseId,
        chapterIds: versionModule.chapters
          .map((c) => c.sourceChapterId)
          .filter((id): id is string => Boolean(id)),
      };
    }
  }

  const chapters = await prisma.chapter.findMany({
    where: { moduleId, isArchived: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  return {
    courseId: module.courseId,
    chapterIds: chapters.map((c) => c.id),
  };
}

/**
 * Stamps chapter/module completion timestamps the first time the learner
 * satisfies the completion rules. Idempotent — never overwrites existing rows.
 */
export async function recordChapterAndModuleCompletionIfNeeded(
  prisma: PrismaService,
  userId: string,
  chapterId: string,
  ctx?: ChapterProgressContext,
): Promise<void> {
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: { moduleId: true, module: { select: { courseId: true } } },
  });
  if (!chapter) return;

  const courseId = ctx?.courseId ?? chapter.module.courseId;
  let enrolledVersionId = ctx?.enrolledVersionId;
  if (enrolledVersionId === undefined) {
    const enrollment = await prisma.userCourse.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { enrolledVersionId: true },
    });
    enrolledVersionId = enrollment?.enrolledVersionId ?? null;
  }
  const progressCtx: ChapterProgressContext = { courseId, enrolledVersionId };

  const existingChapter = await prisma.userChapterCompletion.findUnique({
    where: { userId_chapterId: { userId, chapterId } },
  });

  if (!existingChapter) {
    const complete = await isChapterComplete(
      prisma,
      userId,
      chapterId,
      progressCtx,
    );
    if (complete) {
      await prisma.userChapterCompletion.create({
        data: {
          userId,
          courseId,
          moduleId: chapter.moduleId,
          chapterId,
          completedAt: new Date(),
        },
      });
    }
  }

  const existingModule = await prisma.userModuleCompletion.findUnique({
    where: { userId_moduleId: { userId, moduleId: chapter.moduleId } },
  });
  if (existingModule) return;

  const moduleCtx = await getChapterIdsInModuleForUser(
    prisma,
    userId,
    chapter.moduleId,
  );
  if (!moduleCtx || moduleCtx.chapterIds.length === 0) return;

  const completedChapterCount = await prisma.userChapterCompletion.count({
    where: {
      userId,
      moduleId: chapter.moduleId,
      chapterId: { in: moduleCtx.chapterIds },
    },
  });
  if (completedChapterCount < moduleCtx.chapterIds.length) return;

  await prisma.userModuleCompletion.create({
    data: {
      userId,
      courseId: moduleCtx.courseId,
      moduleId: chapter.moduleId,
      completedAt: new Date(),
    },
  });
}
