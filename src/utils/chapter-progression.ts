import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  CourseVersionManifest,
  getChapterIdsFromManifest,
  loadManifestForVersion,
} from '../course-version/course-version.manifest';

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

/**
 * Chapter order from a pinned version manifest (live chapter ids). Routes through
 * the shared cached loader so the progression gate reuses the same manifest read
 * as resolveEnrolledVersionId and the quiz loader (one courseVersion read per
 * warm instance instead of three per learner GET).
 */
async function loadVersionManifest(
  prisma: PrismaService,
  versionId: string,
): Promise<CourseVersionManifest | null> {
  return loadManifestForVersion(prisma, versionId);
}

export async function getOrderedChapterIdsForVersion(
  prisma: PrismaService,
  versionId: string,
): Promise<string[]> {
  const manifest = await loadVersionManifest(prisma, versionId);
  if (manifest) {
    return getChapterIdsFromManifest(manifest);
  }
  return [];
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

/**
 * Version-aware quiz id set for a chapter, mirroring EXACTLY what the learner is
 * served: for a pinned learner the manifest's quizIds (same source as
 * loadPinnedCurriculum), otherwise the live non-archived quizzes. Grading must
 * use this so the score denominator and the "answered everything" gate match the
 * served set. Using the raw live relation instead desyncs grading whenever a
 * quiz is archived (still carries chapterId) or added after the user's pin,
 * which permanently blocks submission. Mirrors resolveChapterDenominator's
 * branching so grade.totalQuestions equals the completion denominator.
 */
async function resolveChapterQuizIds(
  prisma: PrismaService,
  userId: string,
  chapterId: string,
  ctx?: ChapterProgressContext,
): Promise<string[]> {
  let courseId = ctx?.courseId;
  let enrolledVersionId = ctx?.enrolledVersionId;

  if (courseId === undefined) {
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      select: { module: { select: { courseId: true } } },
    });
    if (!chapter) return [];
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
    const manifest = await loadVersionManifest(prisma, enrolledVersionId);
    if (manifest) {
      for (const mod of manifest.modules) {
        for (const ch of mod.chapters) {
          if (ch.sourceId === chapterId) {
            return [...ch.quizIds];
          }
        }
      }
    }
  }

  const quizzes = await prisma.quiz.findMany({
    where: { chapterId, isArchived: false },
    select: { id: true },
  });
  return quizzes.map((q) => q.id);
}

export async function gradeChapterQuizFromStoredAnswers(
  prisma: PrismaService,
  userId: string,
  chapterId: string,
  storedPassingCriteria?: number | null,
  ctx?: ChapterProgressContext,
): Promise<ChapterQuizGrade> {
  // Grade against the version-aware, non-archived quiz set the learner was
  // actually served — NOT the raw chapter.quizzes relation.
  const quizIds = await resolveChapterQuizIds(prisma, userId, chapterId, ctx);
  if (quizIds.length === 0) {
    throw new Error('This chapter has no quiz questions');
  }

  const [answers, progress] = await Promise.all([
    prisma.quizAnswer.findMany({
      where: { userId, chapterId, quizId: { in: quizIds } },
      select: { quizId: true, isAnswerCorrect: true },
    }),
    // Only look up the stored passing criteria when the caller didn't supply it.
    storedPassingCriteria == null
      ? prisma.quizProgress.findUnique({
          where: { userId_chapterId: { userId, chapterId } },
          select: { passingCriteria: true },
        })
      : Promise.resolve(null),
  ]);

  const passingCriteria = resolvePassingCriteria(
    storedPassingCriteria ?? progress?.passingCriteria ?? null,
  );

  const answeredQuestions = answers.length;
  const correctCount = answers.filter((a) => a.isAnswerCorrect).length;
  const score = Math.round((correctCount / quizIds.length) * 1000) / 10;
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
    const manifest = await loadVersionManifest(prisma, enrolledVersionId);
    if (manifest) {
      for (const mod of manifest.modules) {
        for (const ch of mod.chapters) {
          if (ch.sourceId === chapterId) {
            return {
              sectionCount: ch.sectionIds.length,
              quizCount: ch.quizIds.length,
            };
          }
        }
      }
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
    const manifest = await loadVersionManifest(
      prisma,
      enrollment.enrolledVersionId,
    );
    if (manifest) {
      const mod = manifest.modules.find((m) => m.sourceId === moduleId);
      if (mod) {
        return {
          courseId: module.courseId,
          chapterIds: mod.chapters.map((ch) => ch.sourceId),
        };
      }
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
