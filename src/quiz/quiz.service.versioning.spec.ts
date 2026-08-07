import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CourseVersionService } from '../course-version/course-version.service';
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
      chapter: { findUnique: jest.fn(), update: jest.fn() },
      userCourse: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      quiz: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        aggregate: jest.fn(),
      },
      quizAnswer: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((arg) =>
        Array.isArray(arg) ? Promise.all(arg) : arg({}),
      ),
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
      autoPublishAfterStructuralChange: jest.fn().mockResolvedValue({
        versionNumber: 2,
        versionId: 'version-2',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: CourseVersionService, useValue: courseVersionService },
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
        data: { isArchived: true },
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
        data: { isArchived: true, chapterId: null },
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
});
