import { Prisma } from '@prisma/client';

/**
 * Chapter ↔ quiz membership (`ChapterQuiz`). A bank quiz can be placed in many
 * chapters; content lives on `Quiz`, order and removal live on the placement.
 *
 * Every read of "the quizzes in a chapter" goes through these definitions so
 * the live filter cannot drift between grading, versioning and the admin UI.
 */

/**
 * A placement served to unpinned learners and captured by new versions: not
 * removed from the chapter, and the quiz itself not deleted from the bank.
 */
export const LIVE_PLACEMENT = {
  isArchived: false,
  quiz: { isArchived: false },
} satisfies Prisma.ChapterQuizWhereInput;

/**
 * A placement the admin UI lists as "used in": not removed, in a chapter and
 * unit that are not archived (archiving a chapter keeps its placements for
 * pinned learners, but the chapter is gone from the live course).
 */
export const VISIBLE_PLACEMENT = {
  isArchived: false,
  chapter: { isArchived: false, module: { isArchived: false } },
} satisfies Prisma.ChapterQuizWhereInput;

/** Chapter filter: the chapter has at least one live quiz. */
export const HAS_LIVE_QUIZ = {
  quizPlacements: { some: LIVE_PLACEMENT },
} satisfies Prisma.ChapterWhereInput;

/**
 * Display order within a chapter: orderIndex (nulls last), then createdAt, then
 * quizId. The migration copied each quiz's createdAt onto its placement, so
 * this orders exactly like the old (orderIndex, createdAt, id) on quizzes.
 */
export const PLACEMENT_ORDER = [
  { orderIndex: 'asc' },
  { createdAt: 'asc' },
  { quizId: 'asc' },
] satisfies Prisma.ChapterQuizOrderByWithRelationInput[];

type Db = Pick<Prisma.TransactionClient, 'chapterQuiz'>;

/** Live quiz ids of a chapter, in display order. */
export async function findLiveChapterQuizIds(
  db: Db,
  chapterId: string,
): Promise<string[]> {
  const rows = await db.chapterQuiz.findMany({
    where: { chapterId, ...LIVE_PLACEMENT },
    orderBy: PLACEMENT_ORDER,
    select: { quizId: true },
  });
  return rows.map((r) => r.quizId);
}

/** Number of live quizzes in a chapter. */
export function countLiveChapterQuizzes(
  db: Db,
  chapterId: string,
): Promise<number> {
  return db.chapterQuiz.count({ where: { chapterId, ...LIVE_PLACEMENT } });
}

/** Next orderIndex for quizzes appended to a chapter: one past the highest
 *  live placement, ignoring the quizzes being (re)assigned themselves. */
export async function nextPlacementOrderIndex(
  db: Db,
  chapterId: string,
  excludeQuizIds: string[] = [],
): Promise<number> {
  const max = await db.chapterQuiz.aggregate({
    where: {
      chapterId,
      ...LIVE_PLACEMENT,
      ...(excludeQuizIds.length ? { quizId: { notIn: excludeQuizIds } } : {}),
    },
    _max: { orderIndex: true },
  });
  return (max._max.orderIndex ?? -1) + 1;
}

/**
 * Chapter API responses predate placements and expose `_count.quizzes`.
 * Queries now count `quizPlacements` (live only); rename it back so clients
 * keep reading the same field. Mutates and returns `row`.
 */
export function exposeQuizCount<T>(row: T): T {
  const count = (row as { _count?: Record<string, unknown> } | null)?._count;
  if (count && 'quizPlacements' in count) {
    count.quizzes = count.quizPlacements;
    delete count.quizPlacements;
  }
  return row;
}

/**
 * Quizzes that deleting the course owning these chapters may delete: placed in
 * these chapters and in no other chapter, AND actually used here — still live
 * in one of them, or archived from the bank. A quiz also placed anywhere else
 * (live, or removed but still pinned — the migration recorded every
 * (chapter, quiz) a version manifest lists) is shared and must survive, and so
 * must a bank quiz that was merely unassigned from this course. Their
 * placements in these chapters cascade with the chapters.
 */
export function quizzesOnlyInChapters(chapterIds: string[]) {
  return {
    placements: {
      some: { chapterId: { in: chapterIds } },
      every: { chapterId: { in: chapterIds } },
    },
    OR: [
      { isArchived: true },
      {
        placements: {
          some: { chapterId: { in: chapterIds }, isArchived: false },
        },
      },
    ],
  } satisfies Prisma.QuizWhereInput;
}

/** A placement (not removed) in any chapter of this course. */
export function quizPlacementInCourse(courseId: string) {
  return {
    isArchived: false,
    chapter: { module: { courseId } },
  } satisfies Prisma.ChapterQuizWhereInput;
}

/**
 * A quiz row as API responses return it: without the frozen pre-placement
 * columns, which no longer say anything true about where the quiz is used.
 */
export function withoutLegacyQuizFields<
  T extends { legacyChapterId?: unknown; legacyOrderIndex?: unknown },
>(quiz: T): Omit<T, 'legacyChapterId' | 'legacyOrderIndex'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { legacyChapterId, legacyOrderIndex, ...rest } = quiz;
  return rest;
}
