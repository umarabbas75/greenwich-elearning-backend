import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CourseVersionService } from '../course-version/course-version.service';
import { makeAbortAwareTransactionMock } from '../test-utils/prisma-transaction-mock';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuizService } from './quiz.service';

jest.mock('../utils/chapter-progression', () => ({
  assertChapterAccessible: jest.fn().mockResolvedValue(undefined),
  enrichQuizProgressReport: jest.fn((x) => x),
  gradeChapterQuizFromStoredAnswers: jest.fn(),
  recordChapterAndModuleCompletionIfNeeded: jest
    .fn()
    .mockResolvedValue(undefined),
  resolveChapterQuizIds: jest.fn(),
  resolvePassingCriteria: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const progression = require('../utils/chapter-progression');

describe('QuizService — course versioning', () => {
  let service: QuizService;
  let prisma: Record<string, any>;
  let courseVersionService: Record<string, jest.Mock>;

  beforeEach(async () => {
    prisma = {
      chapter: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      userCourse: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      quiz: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        aggregate: jest.fn(),
        count: jest.fn(),
      },
      quizAnswer: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: undefined as any,
    };

    courseVersionService = {
      getVersionQuizzesForChapter: jest.fn(),
      resolveEnrolledVersionId: jest.fn(),
      resolveCurriculumTree: jest.fn(),
      findVersionChapterBySourceId: jest.fn(),
      mapVersionQuizzesForLearner: jest.fn(),
      isReferencedByAnyVersion: jest.fn(),
      getReferencingVersionsWithEnrollments: jest
        .fn()
        .mockResolvedValue({ stillServedTo: 0, versions: [] }),
      buildArchiveMessage: jest.fn().mockReturnValue('Archived'),
      // PR 1 additions — restoreQuiz uses these three. Default mocks keep
      // the existing 40+ tests untouched (delete/archive paths do not read
      // them), and restoreQuiz tests below override with focused fixtures.
      writeAudit: jest.fn().mockResolvedValue(undefined),
      getLatestPublishedVersion: jest.fn().mockResolvedValue(null),
      buildRestoreNote: jest.fn().mockReturnValue('RESTORE_NOTE_STUB'),
      autoPublishAfterStructuralChange: jest.fn().mockResolvedValue({
        versionNumber: 2,
        versionId: 'version-2',
      }),
    };

    prisma.$transaction = makeAbortAwareTransactionMock(prisma);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: CourseVersionService, useValue: courseVersionService },
        {
          provide: CourseCompletionService,
          useValue: { checkContentCompletion: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(QuizService);
    jest.clearAllMocks();
  });

  describe('getAllAssignQuizzes', () => {
    it('returns version quizzes for pinned learner', async () => {
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        module: { courseId: 'course-1' },
      });
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-1',
        enrolledVersionId: 'version-1',
      });
      courseVersionService.resolveEnrolledVersionId.mockResolvedValue(
        'version-1',
      );
      courseVersionService.getVersionQuizzesForChapter.mockResolvedValue([
        { id: 'quiz-1', question: 'Version Q?', options: ['A', 'B'] },
      ]);

      const result = await service.getAllAssignQuizzes(
        'ch-1',
        'user',
        'user-1',
      );

      expect(result.statusCode).toBe(200);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('quiz-1');
      expect(
        courseVersionService.resolveEnrolledVersionId,
      ).toHaveBeenCalledWith('user-1', 'course-1', {
        id: 'uc-1',
        enrolledVersionId: 'version-1',
      });
      expect(
        courseVersionService.getVersionQuizzesForChapter,
      ).toHaveBeenCalledWith('user-1', 'course-1', 'ch-1', false, 'version-1');
      expect(courseVersionService.resolveCurriculumTree).not.toHaveBeenCalled();
    });

    it('falls back to live quizzes for admin', async () => {
      prisma.chapter.findUnique
        .mockResolvedValueOnce({
          id: 'ch-1',
          module: { courseId: 'course-1' },
        })
        .mockResolvedValueOnce({
          id: 'ch-1',
          quizzes: [
            {
              id: 'quiz-live',
              question: 'Live Q?',
              options: ['A'],
              answer: 'A',
            },
          ],
        });

      const result = await service.getAllAssignQuizzes(
        'ch-1',
        'admin',
        'admin-1',
      );

      expect(result.data[0].id).toBe('quiz-live');
      expect(courseVersionService.resolveCurriculumTree).not.toHaveBeenCalled();
    });
  });

  describe('getAllQuizzes', () => {
    it('returns every quiz unpaginated when no page/limit is given', async () => {
      prisma.quiz.findMany.mockResolvedValue([{ id: 'quiz-1' }]);
      prisma.quiz.count.mockResolvedValue(1);

      const result = await service.getAllQuizzes('admin');

      expect(prisma.quiz.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ skip: expect.anything() }),
      );
      expect(result.data).toEqual([{ id: 'quiz-1' }]);
      expect(result.total).toBe(1);
    });

    it('applies skip/take once page or limit is passed', async () => {
      prisma.quiz.findMany.mockResolvedValue([{ id: 'quiz-2' }]);
      prisma.quiz.count.mockResolvedValue(25);

      const result = await service.getAllQuizzes('admin', {
        page: 2,
        limit: 10,
      });

      expect(prisma.quiz.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
      expect(result.total).toBe(25);
    });

    it('filters by search text case-insensitively', async () => {
      prisma.quiz.findMany.mockResolvedValue([]);
      prisma.quiz.count.mockResolvedValue(0);

      await service.getAllQuizzes('admin', { search: 'photosynthesis' });

      expect(prisma.quiz.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { question: { contains: 'photosynthesis', mode: 'insensitive' } },
              { isArchived: false },
            ],
          },
        }),
      );
    });

    it('filters to only assigned or only unassigned quizzes', async () => {
      prisma.quiz.findMany.mockResolvedValue([]);
      prisma.quiz.count.mockResolvedValue(0);

      await service.getAllQuizzes('admin', { assigned: false });

      expect(prisma.quiz.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [{ chapterId: null }, { isArchived: false }] },
        }),
      );
    });

    it('filters by courseId via the chapters under that course', async () => {
      prisma.quiz.findMany.mockResolvedValue([]);
      prisma.quiz.count.mockResolvedValue(0);
      prisma.chapter.findMany.mockResolvedValue([
        { id: 'ch-1' },
        { id: 'ch-2' },
      ]);

      await service.getAllQuizzes('admin', { courseId: 'course-1' });

      expect(prisma.chapter.findMany).toHaveBeenCalledWith({
        where: { module: { courseId: 'course-1' } },
        select: { id: true },
      });
      expect(prisma.quiz.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { chapterId: { in: ['ch-1', 'ch-2'] } },
              { isArchived: false },
            ],
          },
        }),
      );
    });

    it('hides archived quizzes by default, paginated or not — only includeArchived shows them', async () => {
      prisma.quiz.findMany.mockResolvedValue([]);
      prisma.quiz.count.mockResolvedValue(0);

      await service.getAllQuizzes('admin', { page: 1 });
      expect(prisma.quiz.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { AND: [{ isArchived: false }] } }),
      );

      // The legacy unpaginated call (e.g. the assign-to-chapter dropdown) must
      // never be able to offer an archived/soft-deleted quiz as an option.
      await service.getAllQuizzes('admin');
      expect(prisma.quiz.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { AND: [{ isArchived: false }] } }),
      );

      await service.getAllQuizzes('admin', { includeArchived: true });
      expect(prisma.quiz.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('defaults the page size to 50', async () => {
      prisma.quiz.findMany.mockResolvedValue([]);
      prisma.quiz.count.mockResolvedValue(0);

      await service.getAllQuizzes('admin', { page: 1 });

      expect(prisma.quiz.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('clamps limit to the [1, 100] range', async () => {
      prisma.quiz.findMany.mockResolvedValue([]);
      prisma.quiz.count.mockResolvedValue(0);

      await service.getAllQuizzes('admin', { limit: 500 });

      expect(prisma.quiz.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe('deleteQuiz', () => {
    it('archives quiz referenced by a version', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        chapter: { module: { courseId: 'course-1' } },
      });
      courseVersionService.isReferencedByAnyVersion.mockResolvedValue(true);
      courseVersionService.getReferencingVersionsWithEnrollments.mockResolvedValue(
        {
          stillServedTo: 2,
          versions: [
            {
              versionId: 'v-1',
              versionNumber: 1,
              status: 'PUBLISHED',
              enrollmentCount: 2,
            },
          ],
        },
      );
      prisma.quiz.update.mockResolvedValue({ id: 'quiz-1', isArchived: true });

      const result = await service.deleteQuiz('quiz-1');

      expect(prisma.quiz.update).toHaveBeenCalledWith({
        where: { id: 'quiz-1' },
        data: { isArchived: true, archivedAt: expect.any(Date) },
      });
      expect(prisma.quiz.delete).not.toHaveBeenCalled();
      expect(result.message).toContain('Archived');
      expect((result as any).outcome).toBe('archived');
      expect((result as any).stillServedTo).toBe(2);
      expect(
        courseVersionService.autoPublishAfterStructuralChange,
      ).toHaveBeenCalled();
    });

    it('hard-deletes quiz not in any version', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        chapter: { module: { courseId: 'course-1' } },
      });
      courseVersionService.isReferencedByAnyVersion.mockResolvedValue(false);
      prisma.quiz.delete.mockResolvedValue({});

      await service.deleteQuiz('quiz-1');

      expect(prisma.quiz.delete).toHaveBeenCalledWith({
        where: { id: 'quiz-1' },
      });
    });

    // Regression: the auto-publish is best-effort. The quiz mutation has already
    // committed by the time it runs, so a publish failure must NOT propagate and
    // 403 the admin — it's logged and the version self-heals via reconcile.
    it('still succeeds when auto-publish throws (best-effort)', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        chapter: { module: { courseId: 'course-1' } },
      });
      courseVersionService.isReferencedByAnyVersion.mockResolvedValue(false);
      prisma.quiz.delete.mockResolvedValue({});
      courseVersionService.autoPublishAfterStructuralChange.mockRejectedValue(
        new Error('publish boom'),
      );

      const result = await service.deleteQuiz('quiz-1');

      // Mutation happened, no throw, no publishedVersion.
      expect(prisma.quiz.delete).toHaveBeenCalled();
      expect(result.statusCode).toBe(200);
      expect(result.publishedVersion).toBeUndefined();
    });
  });

  describe('checkQuiz', () => {
    const body = {
      quizId: 'quiz-1',
      chapterId: 'ch-1',
      answer: 'c',
      isAnswered: true,
    } as any;

    beforeEach(() => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'quiz-1', answer: 'c' });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    });

    // THE regression that matters. A pinned learner is served their version
    // manifest, so after an admin moves/unassigns a quiz the live
    // quiz.chapterId no longer matches the chapter the learner is viewing —
    // yet getAllAssignQuizzes still serves that quiz. Validating against the
    // LIVE chapterId 400s an answer for a quiz we just handed them; measured
    // against production that was 21 pinned pairs / 7 chapter-cases on 4 real
    // accounts, worst case 7-of-12 quizzes (an unpassable chapter).
    it('accepts an answer when the pinned manifest still serves the quiz, even though live quiz.chapterId has moved away', async () => {
      // Live: the quiz has been reassigned to a DIFFERENT chapter.
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        answer: 'c',
        chapterId: 'ch-SOMEWHERE-ELSE',
      });
      // Pinned manifest: still lists it under ch-1, which is what was served.
      progression.resolveChapterQuizIds.mockResolvedValue(['quiz-1', 'quiz-2']);
      prisma.quizAnswer.findFirst.mockResolvedValue(null);
      prisma.quizAnswer.create.mockResolvedValue({ id: 'a-1' });

      const result = await service.checkQuiz('user-1', body);

      expect(result.statusCode).toBe(200);
      expect(prisma.quizAnswer.create).toHaveBeenCalledWith({
        data: {
          quizId: 'quiz-1',
          chapterId: 'ch-1',
          userId: 'user-1',
          answer: 'c',
          isAnswerCorrect: true,
        },
      });
    });

    // Regression: the unique key is (userId, quizId) with no chapter component,
    // so an existing row keeps whatever chapterId it was first created with.
    // Reads filter on { userId, chapterId }, so a stale row is invisible to the
    // chapter it belongs to — the quiz renders as unanswered forever.
    it('re-homes chapterId when updating an answer created under a different chapter', async () => {
      progression.resolveChapterQuizIds.mockResolvedValue(['quiz-1']);
      prisma.quizAnswer.findFirst.mockResolvedValue({
        id: 'a-1',
        chapterId: 'ch-OLD',
      });
      prisma.quizAnswer.update.mockResolvedValue({ id: 'a-1' });

      await service.checkQuiz('user-1', body);

      expect(prisma.quizAnswer.update).toHaveBeenCalledWith({
        where: { userId_quizId: { userId: 'user-1', quizId: 'quiz-1' } },
        data: { chapterId: 'ch-1', answer: 'c', isAnswerCorrect: true },
      });
    });

    it('rejects a quiz that is not in the served set for this chapter', async () => {
      progression.resolveChapterQuizIds.mockResolvedValue(['quiz-OTHER']);
      prisma.quizAnswer.findFirst.mockResolvedValue(null);

      await expect(service.checkQuiz('user-1', body)).rejects.toMatchObject({
        status: 400,
      });
      expect(prisma.quizAnswer.create).not.toHaveBeenCalled();
      expect(prisma.quizAnswer.update).not.toHaveBeenCalled();
    });

    it('grades against the stored quiz answer, not the submitted one', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'quiz-1', answer: 'a' });
      progression.resolveChapterQuizIds.mockResolvedValue(['quiz-1']);
      prisma.quizAnswer.findFirst.mockResolvedValue(null);
      prisma.quizAnswer.create.mockResolvedValue({ id: 'a-1' });

      await service.checkQuiz('user-1', body); // submits 'c', correct is 'a'

      expect(prisma.quizAnswer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isAnswerCorrect: false }),
        }),
      );
    });
  });

  describe('assignQuiz', () => {
    // Regression: unAssignQuiz archives a version-referenced quiz
    // ({ isArchived: true, chapterId: null }) to keep it for version history.
    // Re-assigning used to `connect` only, which set chapterId but left
    // isArchived true — so the quiz was attached yet invisible to every read
    // (getAllChapters._count.quizzes, getAllAssignQuizzes and
    // buildManifestFromLiveTree all filter isArchived: false), and the
    // auto-publish then baked a quiz-less chapter into the new version.
    it('clears isArchived when re-assigning a previously archived quiz', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        isArchived: true,
        chapterId: null,
      });
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        title: 'Element 2',
        module: { courseId: 'course-1' },
      });
      prisma.quiz.aggregate.mockResolvedValue({ _max: { orderIndex: 2 } });
      prisma.quiz.update.mockResolvedValue({});

      await service.assignQuiz('quiz-1', 'ch-1', 'admin-1');

      // Un-archive and re-attach in the SAME write — a bare relation `connect`
      // would leave isArchived: true.
      expect(prisma.quiz.update).toHaveBeenCalledWith({
        where: { id: 'quiz-1' },
        data: { chapterId: 'ch-1', isArchived: false, orderIndex: 3 },
      });
      // The chapter-side relation write is what left the row archived.
      expect(prisma.chapter.update).not.toHaveBeenCalled();
    });

    it('publishes a new version after assigning', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'quiz-1' });
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        title: 'Element 2',
        module: { courseId: 'course-1' },
      });
      prisma.quiz.aggregate.mockResolvedValue({ _max: { orderIndex: null } });
      prisma.quiz.update.mockResolvedValue({});

      const result = await service.assignQuiz('quiz-1', 'ch-1', 'admin-1');

      expect(
        courseVersionService.autoPublishAfterStructuralChange,
      ).toHaveBeenCalledWith(
        'course-1',
        'admin-1',
        'Assigned quiz to chapter "Element 2"',
      );
      expect(result.statusCode).toBe(200);
      expect(result.publishedVersion).toEqual({
        versionNumber: 2,
        versionId: 'version-2',
      });
    });
  });

  describe('bulkAssignQuiz', () => {
    it('assigns every quiz with sequential orderIndex and publishes once', async () => {
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        title: 'Element 2',
        module: { courseId: 'course-1' },
      });
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-a' },
        { id: 'quiz-b' },
        { id: 'quiz-c' },
      ]);
      prisma.quiz.aggregate.mockResolvedValue({ _max: { orderIndex: 4 } });
      prisma.quiz.update.mockResolvedValue({});

      const result = await service.bulkAssignQuiz(
        'ch-1',
        ['quiz-a', 'quiz-b', 'quiz-c'],
        'admin-1',
      );

      expect(prisma.quiz.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'quiz-a' },
        data: { chapterId: 'ch-1', isArchived: false, orderIndex: 5 },
      });
      expect(prisma.quiz.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'quiz-b' },
        data: { chapterId: 'ch-1', isArchived: false, orderIndex: 6 },
      });
      expect(prisma.quiz.update).toHaveBeenNthCalledWith(3, {
        where: { id: 'quiz-c' },
        data: { chapterId: 'ch-1', isArchived: false, orderIndex: 7 },
      });
      // One publish for the whole batch, not one per quiz.
      expect(
        courseVersionService.autoPublishAfterStructuralChange,
      ).toHaveBeenCalledTimes(1);
      expect(
        courseVersionService.autoPublishAfterStructuralChange,
      ).toHaveBeenCalledWith(
        'course-1',
        'admin-1',
        'Assigned 3 quiz(zes) to chapter "Element 2"',
      );
      expect(result.statusCode).toBe(200);
      expect(result.data).toEqual({
        chapterId: 'ch-1',
        quizIds: ['quiz-a', 'quiz-b', 'quiz-c'],
      });
    });

    it('dedupes repeated quiz ids in the payload', async () => {
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        title: 'Element 2',
        module: { courseId: 'course-1' },
      });
      prisma.quiz.findMany.mockResolvedValue([{ id: 'quiz-a' }]);
      prisma.quiz.aggregate.mockResolvedValue({ _max: { orderIndex: null } });
      prisma.quiz.update.mockResolvedValue({});

      await service.bulkAssignQuiz('ch-1', ['quiz-a', 'quiz-a'], 'admin-1');

      expect(prisma.quiz.update).toHaveBeenCalledTimes(1);
    });

    it('throws when the chapter does not exist', async () => {
      prisma.chapter.findUnique.mockResolvedValue(null);

      await expect(
        service.bulkAssignQuiz('missing-ch', ['quiz-a'], 'admin-1'),
      ).rejects.toThrow(HttpException);
      expect(prisma.quiz.update).not.toHaveBeenCalled();
    });

    it('throws naming any quiz id that does not exist, without partially assigning', async () => {
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        title: 'Element 2',
        module: { courseId: 'course-1' },
      });
      // Only quiz-a is real; quiz-ghost is not.
      prisma.quiz.findMany.mockResolvedValue([{ id: 'quiz-a' }]);

      let caught: any;
      try {
        await service.bulkAssignQuiz(
          'ch-1',
          ['quiz-a', 'quiz-ghost'],
          'admin-1',
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HttpException);
      expect(caught.getResponse().error).toMatch(/quiz-ghost/);
      expect(prisma.quiz.update).not.toHaveBeenCalled();
      expect(
        courseVersionService.autoPublishAfterStructuralChange,
      ).not.toHaveBeenCalled();
    });
  });

  describe('reorderChapterQuizzes', () => {
    it('updates orderIndex in a transaction without publishing', async () => {
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-a' },
        { id: 'quiz-b' },
      ]);
      prisma.quiz.update.mockResolvedValue({});
      prisma.$transaction = jest.fn((ops) => Promise.all(ops));

      const result = await service.reorderChapterQuizzes({
        chapterId: 'ch-1',
        quizzes: [
          { id: 'quiz-b', orderIndex: 0 },
          { id: 'quiz-a', orderIndex: 1 },
        ],
      });

      expect(result.statusCode).toBe(200);
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(
        courseVersionService.autoPublishAfterStructuralChange,
      ).not.toHaveBeenCalled();
    });

    it('rejects when payload omits an active chapter quiz', async () => {
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-a' },
        { id: 'quiz-b' },
      ]);

      await expect(
        service.reorderChapterQuizzes({
          chapterId: 'ch-1',
          quizzes: [{ id: 'quiz-a', orderIndex: 0 }],
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('unAssignQuiz', () => {
    it('archives instead of disconnecting when referenced', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'quiz-1' });
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        title: 'C',
        module: { courseId: 'course-1' },
      });
      courseVersionService.isReferencedByAnyVersion.mockResolvedValue(true);
      courseVersionService.getReferencingVersionsWithEnrollments.mockResolvedValue(
        {
          stillServedTo: 4,
          versions: [
            {
              versionId: 'v-2',
              versionNumber: 2,
              status: 'PUBLISHED',
              enrollmentCount: 4,
            },
          ],
        },
      );
      prisma.quiz.update.mockResolvedValue({});

      const result = await service.unAssignQuiz('quiz-1', 'ch-1');

      expect(prisma.quiz.update).toHaveBeenCalledWith({
        where: { id: 'quiz-1' },
        data: {
          isArchived: true,
          chapterId: null,
          archivedAt: expect.any(Date),
        },
      });
      expect(prisma.chapter.update).not.toHaveBeenCalled();
      expect(result.message).toContain('Archived');
      expect((result as any).outcome).toBe('archived');
      expect((result as any).stillServedTo).toBe(4);
    });

    it('disconnects quiz when not referenced', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'quiz-1' });
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        title: 'C',
        module: { courseId: 'course-1' },
      });
      courseVersionService.isReferencedByAnyVersion.mockResolvedValue(false);
      prisma.chapter.update.mockResolvedValue({});

      await service.unAssignQuiz('quiz-1', 'ch-1');

      expect(prisma.chapter.update).toHaveBeenCalledWith({
        where: { id: 'ch-1' },
        data: { quizzes: { disconnect: { id: 'quiz-1' } } },
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // PR 1: restoreQuiz — the un-archive endpoint. Mirrors CourseService's
  // three restore endpoints; kept in this file because it lives on
  // QuizService. The parent-chain guard is the interesting bit because
  // quizzes are two levels deep (chapter → module → course) and can
  // legitimately be chapter-less (unassigned + archived).
  // ────────────────────────────────────────────────────────────────────

  describe('restoreQuiz', () => {
    it('flips isArchived to false, clears archivedAt, and emits RESTORE_ENTITY audit', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        chapterId: 'ch-1',
        isArchived: true,
        question: 'Old Q?',
        chapter: {
          id: 'ch-1',
          isArchived: false,
          title: 'Live Chapter',
          module: {
            id: 'mod-1',
            isArchived: false,
            title: 'Live Module',
            courseId: 'course-1',
          },
        },
      });
      prisma.quiz.update.mockResolvedValue({
        id: 'quiz-1',
        isArchived: false,
      });

      const result = await service.restoreQuiz('quiz-1', 'admin-1');

      expect(prisma.quiz.update).toHaveBeenCalledWith({
        where: { id: 'quiz-1' },
        data: { isArchived: false, archivedAt: null },
      });
      expect(result.statusCode).toBe(200);
      expect(courseVersionService.writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'RESTORE_ENTITY',
          targetType: 'Quiz',
          targetId: 'quiz-1',
          courseId: 'course-1',
          metadata: expect.objectContaining({
            entityType: 'quiz',
            priorIsArchived: true,
          }),
        }),
      );
    });

    it('returns 409 when the parent chapter is archived', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        chapterId: 'ch-1',
        isArchived: true,
        question: 'Q?',
        chapter: {
          id: 'ch-1',
          isArchived: true, // ← archived parent
          title: 'Archived Ch',
          module: {
            id: 'mod-1',
            isArchived: false,
            title: 'Live Module',
            courseId: 'course-1',
          },
        },
      });

      await expect(service.restoreQuiz('quiz-1', 'admin-1')).rejects.toThrow(
        HttpException,
      );
      expect(prisma.quiz.update).not.toHaveBeenCalled();
    });

    it('returns 409 with module first in chain when grandparent module is archived', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        chapterId: 'ch-1',
        isArchived: true,
        question: 'Q?',
        chapter: {
          id: 'ch-1',
          isArchived: false, // chapter live
          title: 'Live Ch',
          module: {
            id: 'mod-1',
            isArchived: true, // grandparent archived
            title: 'Archived Module',
            courseId: 'course-1',
          },
        },
      });

      try {
        await service.restoreQuiz('quiz-1', 'admin-1');
        throw new Error('should have thrown');
      } catch (e) {
        const err = (e as any).getResponse();
        expect(err.details.parentEntityType).toBe('module');
        expect(err.details.chain[0].entityType).toBe('module');
      }
    });

    it('restores a chapter-less quiz (unassigned + archived) without a parent-chain check', async () => {
      // unAssignQuiz nulls the FK on archive. Restoring returns the quiz to
      // the bank; assignQuiz can later put it back in a chapter. No parent
      // to guard against.
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        chapterId: null,
        isArchived: true,
        question: 'Q?',
        chapter: null,
      });
      prisma.quiz.update.mockResolvedValue({
        id: 'quiz-1',
        isArchived: false,
      });

      const result = await service.restoreQuiz('quiz-1', 'admin-1');

      expect(result.statusCode).toBe(200);
      // No latest-version lookup: without a courseId we can't ask which
      // version references what.
      expect(
        courseVersionService.getLatestPublishedVersion,
      ).not.toHaveBeenCalled();
    });

    it('returns 409 when the quiz is already live', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        chapterId: 'ch-1',
        isArchived: false,
        question: 'Q?',
        chapter: {
          id: 'ch-1',
          isArchived: false,
          title: 'Ch',
          module: {
            id: 'mod',
            isArchived: false,
            title: 'M',
            courseId: 'course-1',
          },
        },
      });

      await expect(service.restoreQuiz('quiz-1', 'admin-1')).rejects.toThrow(
        HttpException,
      );
    });

    it('returns 404 when the quiz row is missing', async () => {
      prisma.quiz.findUnique.mockResolvedValue(null);
      await expect(service.restoreQuiz('quiz-gone', 'admin-1')).rejects.toThrow(
        HttpException,
      );
    });
  });
});
