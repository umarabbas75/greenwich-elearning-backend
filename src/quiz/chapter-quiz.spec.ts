import {
  loadQuizOrderKeys,
  resetManifestCache,
  sortQuizIdsByLiveOrder,
} from '../course-version/course-version.manifest';
import {
  exposeQuizCount,
  quizzesOnlyInChapters,
  withoutLegacyQuizFields,
} from './chapter-quiz';

describe('chapter-quiz helpers', () => {
  it('exposeQuizCount renames the placement count back to _count.quizzes', () => {
    const row = { id: 'ch-1', _count: { sections: 3, quizPlacements: 2 } };
    expect(exposeQuizCount(row)).toEqual({
      id: 'ch-1',
      _count: { sections: 3, quizzes: 2 },
    });
    // Rows without a placement count are left alone.
    expect(exposeQuizCount({ id: 'ch-2' })).toEqual({ id: 'ch-2' });
    expect(exposeQuizCount(null)).toBeNull();
  });

  it('withoutLegacyQuizFields drops only the frozen columns', () => {
    expect(
      withoutLegacyQuizFields({
        id: 'q',
        question: 'Q?',
        legacyChapterId: 'ch-old',
        legacyOrderIndex: 2,
      }),
    ).toEqual({ id: 'q', question: 'Q?' });
  });

  it('quizzesOnlyInChapters keeps any quiz placed outside the given chapters', () => {
    expect(quizzesOnlyInChapters(['a', 'b'])).toEqual({
      placements: {
        some: { chapterId: { in: ['a', 'b'] } },
        every: { chapterId: { in: ['a', 'b'] } },
      },
      // …and used here (live) or deleted from the bank: a bank quiz merely
      // unassigned from these chapters survives.
      OR: [
        { isArchived: true },
        {
          placements: {
            some: { chapterId: { in: ['a', 'b'] }, isArchived: false },
          },
        },
      ],
    });
  });
});

describe('per-chapter quiz order', () => {
  const t = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));
  // q1..q3 are shared by NEBOSH chapter A and TEST chapter B, in opposite
  // orders; q4 was unassigned before placements existed (no placement).
  const quizzes = [
    { id: 'q1', legacyOrderIndex: 0, createdAt: t(1) },
    { id: 'q2', legacyOrderIndex: 1, createdAt: t(2) },
    { id: 'q3', legacyOrderIndex: 2, createdAt: t(3) },
    { id: 'q4', legacyOrderIndex: 1, createdAt: t(0) },
  ];
  const placementRows = [
    { chapterId: 'A', quizId: 'q1', orderIndex: 0, createdAt: t(1) },
    { chapterId: 'A', quizId: 'q2', orderIndex: 1, createdAt: t(2) },
    { chapterId: 'A', quizId: 'q3', orderIndex: 2, createdAt: t(3) },
    { chapterId: 'B', quizId: 'q3', orderIndex: 0, createdAt: t(9) },
    { chapterId: 'B', quizId: 'q2', orderIndex: 1, createdAt: t(9) },
    { chapterId: 'B', quizId: 'q1', orderIndex: 2, createdAt: t(9) },
  ];
  const prisma: any = {
    quiz: {
      findMany: jest.fn(async ({ where }: any) =>
        quizzes.filter((q) => where.id.in.includes(q.id)),
      ),
    },
    chapterQuiz: {
      findMany: jest.fn(async ({ where }: any) =>
        placementRows.filter(
          (p) =>
            where.chapterId.in.includes(p.chapterId) &&
            where.quizId.in.includes(p.quizId),
        ),
      ),
    },
  };

  beforeEach(() => resetManifestCache());

  it("orders a shared quiz by each chapter's own placement", async () => {
    await expect(
      sortQuizIdsByLiveOrder(prisma, 'A', ['q3', 'q1', 'q2']),
    ).resolves.toEqual(['q1', 'q2', 'q3']);
    await expect(
      sortQuizIdsByLiveOrder(prisma, 'B', ['q1', 'q2', 'q3']),
    ).resolves.toEqual(['q3', 'q2', 'q1']);
  });

  it('falls back to the frozen quiz order when the chapter has no placement for it', async () => {
    // q4 sits by its legacy orderIndex (1) among A's placements; it ties with
    // q2 and the earlier createdAt wins, exactly as the old single-chapter
    // order did.
    await expect(
      sortQuizIdsByLiveOrder(prisma, 'A', ['q1', 'q2', 'q3', 'q4']),
    ).resolves.toEqual(['q1', 'q4', 'q2', 'q3']);
  });

  it('drops ids with no quiz row and de-duplicates', async () => {
    await expect(
      sortQuizIdsByLiveOrder(prisma, 'A', ['q2', 'gone', 'q2']),
    ).resolves.toEqual(['q2']);
  });

  it('loadQuizOrderKeys reads placements for all chapters in one query', async () => {
    prisma.chapterQuiz.findMany.mockClear();
    const keys = await loadQuizOrderKeys(prisma, ['A', 'B'], quizzes);
    expect(prisma.chapterQuiz.findMany).toHaveBeenCalledTimes(1);
    expect(keys.keyFor('B', 'q3').orderIndex).toBe(0);
    expect(keys.keyFor('A', 'q3').orderIndex).toBe(2);
    expect(keys.keyFor('A', 'q4').orderIndex).toBe(1);
  });
});
