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
      course: {
        findUnique: jest.fn().mockResolvedValue({ deliveryMode: 'NATIVE' }),
      },
      quiz: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn(),
        count: jest.fn(),
      },
      quizAnswer: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      // Chapter ↔ quiz placements (a quiz can be in several chapters).
      chapterQuiz: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _max: { orderIndex: null } }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn().mockResolvedValue({}),
      },
      // Row locks taken inside interactive transactions (SELECT … FOR UPDATE)
      // and the set-based placement insert.
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(1),
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
      prisma.chapter.findUnique.mockResolvedValueOnce({
        id: 'ch-1',
        module: { courseId: 'course-1' },
      });
      prisma.chapterQuiz.findMany.mockResolvedValue([
        {
          quiz: {
            id: 'quiz-live',
            question: 'Live Q?',
            options: ['A'],
            answer: 'A',
          },
        },
      ]);

      const result = await service.getAllAssignQuizzes(
        'ch-1',
        'admin',
        'admin-1',
      );

      expect(result.data[0].id).toBe('quiz-live');
      expect(result.data[0].answer).toBe('A');
      // Live set = this chapter's placements that are not removed, of quizzes
      // not deleted from the bank, in placement order.
      expect(prisma.chapterQuiz.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            chapterId: 'ch-1',
            isArchived: false,
            quiz: { isArchived: false },
          },
          orderBy: [
            { orderIndex: 'asc' },
            { createdAt: 'asc' },
            { quizId: 'asc' },
          ],
        }),
      );
      expect(courseVersionService.resolveCurriculumTree).not.toHaveBeenCalled();
    });
  });

  it('never sends the legacy answer key to an unpinned learner', async () => {
    prisma.chapter.findUnique.mockResolvedValueOnce({
      id: 'ch-1',
      module: { courseId: 'course-1' },
    });
    prisma.userCourse.findUnique.mockResolvedValue(null);
    courseVersionService.getVersionQuizzesForChapter.mockResolvedValue(null);
    prisma.chapterQuiz.findMany.mockResolvedValue([
      {
        quiz: {
          id: 'quiz-live',
          question: 'Q?',
          options: ['A', 'B'],
          answer: 'A',
        },
      },
    ]);

    const result = await service.getAllAssignQuizzes('ch-1', 'user', 'user-1');

    expect(result.data[0].id).toBe('quiz-live');
    expect(result.data[0]).not.toHaveProperty('answer');
  });

  describe('getAllQuizzes', () => {
    const chapterRow = (id: string, courseId: string) => ({
      id,
      title: `Chapter ${id}`,
      module: {
        id: `mod-${id}`,
        title: 'Unit',
        courseId,
        course: { id: courseId, title: `Course ${courseId}` },
      },
    });

    it('returns every quiz unpaginated when no page/limit is given', async () => {
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-1', placements: [] },
      ]);
      prisma.quiz.count.mockResolvedValue(1);

      const result = await service.getAllQuizzes('admin');

      expect(prisma.quiz.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ skip: expect.anything() }),
      );
      expect(result.data).toEqual([
        { id: 'quiz-1', chapters: [], chapterId: null, chapter: null },
      ]);
      expect(result.total).toBe(1);
    });

    it('lists every chapter a shared quiz is used in, keeping the first as the deprecated single `chapter`', async () => {
      const nebosh = chapterRow('ch-nebosh', 'course-nebosh');
      const test = chapterRow('ch-test', 'course-test');
      prisma.quiz.findMany.mockResolvedValue([
        {
          id: 'quiz-1',
          question: 'Q?',
          placements: [{ chapter: nebosh }, { chapter: test }],
        },
      ]);
      prisma.quiz.count.mockResolvedValue(1);

      const result = await service.getAllQuizzes('admin');

      expect(result.data[0]).toMatchObject({
        id: 'quiz-1',
        chapters: [nebosh, test],
        chapterId: 'ch-nebosh',
        chapter: nebosh,
      });
      expect(result.data[0]).not.toHaveProperty('placements');
      // Only placements in a live chapter are listed (archived chapters and
      // units are gone from the course).
      expect(prisma.quiz.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            placements: expect.objectContaining({
              where: {
                isArchived: false,
                chapter: { isArchived: false, module: { isArchived: false } },
              },
            }),
          },
        }),
      );
    });

    it('does not expose the frozen legacy chapter/order columns', async () => {
      prisma.quiz.findMany.mockResolvedValue([
        {
          id: 'quiz-1',
          legacyChapterId: 'ch-old',
          legacyOrderIndex: 3,
          placements: [],
        },
      ]);
      prisma.quiz.count.mockResolvedValue(1);

      const result = await service.getAllQuizzes('admin');

      expect(result.data[0]).not.toHaveProperty('legacyChapterId');
      expect(result.data[0]).not.toHaveProperty('legacyOrderIndex');
    });

    it('applies skip/take once page or limit is passed', async () => {
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-2', placements: [] },
      ]);
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

      // "Used" = placed in a chapter that is still live (not removed, and
      // the chapter and unit not archived) — the same set the list shows.
      const visible = {
        isArchived: false,
        chapter: { isArchived: false, module: { isArchived: false } },
      };
      await service.getAllQuizzes('admin', { assigned: false });
      expect(prisma.quiz.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            AND: [{ placements: { none: visible } }, { isArchived: false }],
          },
        }),
      );

      await service.getAllQuizzes('admin', { assigned: true });
      expect(prisma.quiz.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            AND: [{ placements: { some: visible } }, { isArchived: false }],
          },
        }),
      );
    });

    it('filters by courseId through placements in that course', async () => {
      prisma.quiz.findMany.mockResolvedValue([]);
      prisma.quiz.count.mockResolvedValue(0);

      await service.getAllQuizzes('admin', { courseId: 'course-1' });

      expect(prisma.quiz.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                placements: {
                  some: {
                    isArchived: false,
                    chapter: {
                      isArchived: false,
                      module: { isArchived: false, courseId: 'course-1' },
                    },
                  },
                },
              },
              { isArchived: false },
            ],
          },
        }),
      );
    });

    it('filters to one chapter, or hides quizzes already in a chapter (the assign picker)', async () => {
      prisma.quiz.findMany.mockResolvedValue([]);
      prisma.quiz.count.mockResolvedValue(0);

      await service.getAllQuizzes('admin', { chapterId: 'ch-1' });
      expect(prisma.quiz.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                placements: {
                  some: { chapterId: 'ch-1', isArchived: false },
                },
              },
              { isArchived: false },
            ],
          },
        }),
      );

      await service.getAllQuizzes('admin', { excludeChapterId: 'ch-2' });
      expect(prisma.quiz.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                placements: {
                  none: { chapterId: 'ch-2', isArchived: false },
                },
              },
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

  /** A placement row as findQuizCourses reads it. */
  const placementIn = (courseId: string, deliveryMode = 'NATIVE') => ({
    chapter: { module: { courseId, course: { deliveryMode } } },
  });

  describe('deleteQuiz', () => {
    it('archives quiz referenced by a version', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'quiz-1' });
      prisma.chapterQuiz.findMany.mockResolvedValue([placementIn('course-1')]);
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
      // Any course's version may pin a (possibly shared) quiz: scan them all.
      expect(
        courseVersionService.getReferencingVersionsWithEnrollments,
      ).toHaveBeenCalledWith('quiz', 'quiz-1');
      expect(result.message).toContain('Archived');
      expect((result as any).outcome).toBe('archived');
      expect((result as any).stillServedTo).toBe(2);
      expect(
        courseVersionService.autoPublishAfterStructuralChange,
      ).toHaveBeenCalledWith('course-1', undefined, 'Archived quiz');
    });

    it('hard-deletes quiz not in any version', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'quiz-1' });
      prisma.chapterQuiz.findMany.mockResolvedValue([placementIn('course-1')]);
      prisma.quiz.delete.mockResolvedValue({});

      await service.deleteQuiz('quiz-1');

      expect(prisma.quiz.delete).toHaveBeenCalledWith({
        where: { id: 'quiz-1' },
      });
    });

    it('publishes a version for every course a shared quiz is used in', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'quiz-1' });
      prisma.chapterQuiz.findMany.mockResolvedValue([
        placementIn('course-nebosh'),
        placementIn('course-test'),
        // Second chapter of the same course: one publish per course.
        placementIn('course-test'),
      ]);
      prisma.quiz.delete.mockResolvedValue({});

      await service.deleteQuiz('quiz-1', 'admin-1');

      expect(
        courseVersionService.autoPublishAfterStructuralChange,
      ).toHaveBeenCalledTimes(2);
      expect(
        courseVersionService.autoPublishAfterStructuralChange,
      ).toHaveBeenCalledWith('course-nebosh', 'admin-1', 'Removed quiz');
      expect(
        courseVersionService.autoPublishAfterStructuralChange,
      ).toHaveBeenCalledWith('course-test', 'admin-1', 'Removed quiz');
    });

    it('rejects delete when any course using the quiz is IMPORTED_SCORM', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'quiz-1' });
      prisma.chapterQuiz.findMany.mockResolvedValue([
        placementIn('course-1'),
        placementIn('course-scorm', 'IMPORTED_SCORM'),
      ]);

      await expect(service.deleteQuiz('quiz-1')).rejects.toBeInstanceOf(
        HttpException,
      );
      expect(prisma.quiz.delete).not.toHaveBeenCalled();
      expect(prisma.quiz.update).not.toHaveBeenCalled();
    });

    // Regression: the auto-publish is best-effort. The quiz mutation has already
    // committed by the time it runs, so a publish failure must NOT propagate and
    // 403 the admin — it's logged and the version self-heals via reconcile.
    it('still succeeds when auto-publish throws (best-effort)', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'quiz-1' });
      prisma.chapterQuiz.findMany.mockResolvedValue([placementIn('course-1')]);
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

  describe('updateQuiz', () => {
    it('is blocked when any course using the shared quiz is IMPORTED_SCORM', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'quiz-1' });
      prisma.chapterQuiz.findMany.mockResolvedValue([
        placementIn('course-1'),
        placementIn('course-scorm', 'IMPORTED_SCORM'),
      ]);

      await expect(
        service.updateQuiz('quiz-1', { question: 'Edited?' }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.quiz.update).not.toHaveBeenCalled();
    });

    it('edits the one shared row, so every chapter using it changes', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'quiz-1' });
      prisma.chapterQuiz.findMany.mockResolvedValue([
        placementIn('course-nebosh'),
        placementIn('course-test'),
      ]);
      prisma.quiz.update.mockResolvedValue({ id: 'quiz-1' });

      await service.updateQuiz('quiz-1', { question: 'Edited?' });

      expect(prisma.quiz.update).toHaveBeenCalledTimes(1);
      expect(prisma.quiz.update).toHaveBeenCalledWith({
        where: { id: 'quiz-1' },
        data: { question: 'Edited?' },
      });
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
    // manifest, so after an admin moves/unassigns a quiz the live chapter
    // membership no longer matches the chapter the learner is viewing — yet
    // getAllAssignQuizzes still serves that quiz. Validating against live
    // membership 400s an answer for a quiz we just handed them; measured
    // against production that was 21 pinned pairs / 7 chapter-cases on 4 real
    // accounts, worst case 7-of-12 quizzes (an unpassable chapter).
    it('accepts an answer when the pinned manifest still serves the quiz, even though it was removed from the chapter live', async () => {
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

    it("updates this chapter's existing answer in place", async () => {
      progression.resolveChapterQuizIds.mockResolvedValue(['quiz-1']);
      prisma.quizAnswer.findFirst.mockResolvedValue({
        id: 'a-1',
        chapterId: 'ch-1',
      });
      prisma.quizAnswer.update.mockResolvedValue({ id: 'a-1' });

      await service.checkQuiz('user-1', body);

      expect(prisma.quizAnswer.update).toHaveBeenCalledWith({
        where: {
          userId_chapterId_quizId: {
            userId: 'user-1',
            chapterId: 'ch-1',
            quizId: 'quiz-1',
          },
        },
        data: { chapterId: 'ch-1', answer: 'c', isAnswerCorrect: true },
      });
    });

    // A quiz shared by NEBOSH and NEBOSH (TEST): a learner on both answers it
    // in each, and neither answer may overwrite or satisfy the other.
    it('keeps a separate answer per chapter for a quiz shared by two chapters', async () => {
      progression.resolveChapterQuizIds.mockResolvedValue(['quiz-1']);
      // No answer in ch-2 yet (the learner's ch-1 answer is not looked at).
      prisma.quizAnswer.findFirst.mockResolvedValue(null);
      prisma.quizAnswer.create.mockResolvedValue({ id: 'a-2' });

      await service.checkQuiz('user-1', { ...body, chapterId: 'ch-2' });

      expect(prisma.quizAnswer.findFirst).toHaveBeenCalledWith({
        where: { quizId: 'quiz-1', userId: 'user-1', chapterId: 'ch-2' },
      });
      expect(prisma.quizAnswer.update).not.toHaveBeenCalled();
      expect(prisma.quizAnswer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ quizId: 'quiz-1', chapterId: 'ch-2' }),
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

  const chapterFixture = (deliveryMode = 'NATIVE') => ({
    id: 'ch-1',
    title: 'Element 2',
    module: { courseId: 'course-1', course: { deliveryMode } },
  });

  /**
   * placeQuizzes reads (1) this chapter's placements of the quizzes, (2) live
   * placements of them in OTHER chapters of the same course (rejected), and
   * (3) for a restored quiz, the courses it is still placed in.
   */
  const placements = (opts: {
    here?: any[];
    otherChaptersOfCourse?: any[];
    elsewhere?: any[];
  }) =>
    prisma.chapterQuiz.findMany.mockImplementation((args: any) => {
      if (args?.where?.chapterId?.not) {
        return Promise.resolve(opts.otherChaptersOfCourse ?? []);
      }
      if (typeof args?.where?.quizId === 'string') {
        return Promise.resolve(opts.elsewhere ?? []);
      }
      return Promise.resolve(opts.here ?? []);
    });

  /** The placements written by placeQuizzes' single INSERT … ON CONFLICT:
   *  (chapterId, quizIds, orderIndexes) are its bound values, in order. */
  const placedRows = () => {
    const call = prisma.$executeRaw.mock.calls.at(-1);
    if (!call) return null;
    const [strings, chapterId, quizIds, orders] = call;
    return { sql: (strings as string[]).join('?'), chapterId, quizIds, orders };
  };

  describe('assignQuiz', () => {
    it('adds the quiz to the chapter without moving it out of the chapters it is already in', async () => {
      prisma.chapter.findUnique.mockResolvedValue(chapterFixture());
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-1', isArchived: false },
      ]);
      // Not in ch-1 yet (it lives in another course's chapter).
      prisma.chapterQuiz.findMany.mockResolvedValue([]);
      prisma.chapterQuiz.aggregate.mockResolvedValue({
        _max: { orderIndex: 2 },
      });

      await service.assignQuiz('quiz-1', 'ch-1', 'admin-1');

      expect(placedRows()).toMatchObject({
        chapterId: 'ch-1',
        quizIds: ['quiz-1'],
        orders: [3],
      });
      // Creates the placement, or revives a removed one in this chapter.
      expect(placedRows()!.sql).toMatch(
        /ON CONFLICT \("chapterId", "quizId"\) DO UPDATE[\s\S]*"isArchived" = false/,
      );
      // Nothing touches its other placements or the quiz row.
      expect(prisma.quiz.update).not.toHaveBeenCalled();
      expect(prisma.chapterQuiz.update).not.toHaveBeenCalled();
      expect(prisma.chapterQuiz.delete).not.toHaveBeenCalled();
    });

    // Regression: unAssignQuiz archives a version-referenced quiz to keep it
    // for version history. Re-assigning must make it live again, or it is
    // attached yet invisible to every read (all filter isArchived: false) and
    // the auto-publish bakes a quiz-less chapter into the new version.
    it('restores an archived quiz and revives its removed placement', async () => {
      prisma.chapter.findUnique.mockResolvedValue(chapterFixture());
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-1', isArchived: true },
      ]);
      placements({ here: [{ quizId: 'quiz-1', isArchived: true }] });
      prisma.chapterQuiz.aggregate.mockResolvedValue({
        _max: { orderIndex: 2 },
      });

      await service.assignQuiz('quiz-1', 'ch-1', 'admin-1');

      expect(prisma.quiz.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['quiz-1'] } },
        data: { isArchived: false, archivedAt: null },
      });
      expect(placedRows()).toMatchObject({ quizIds: ['quiz-1'], orders: [3] });
    });

    it('publishes a new version after assigning', async () => {
      prisma.chapter.findUnique.mockResolvedValue(chapterFixture());
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-1', isArchived: false },
      ]);

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

    it('is a no-op (no reorder, no publish) when the quiz is already in the chapter', async () => {
      prisma.chapter.findUnique.mockResolvedValue(chapterFixture());
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-1', isArchived: false },
      ]);
      placements({ here: [{ quizId: 'quiz-1', isArchived: false }] });

      const result = await service.assignQuiz('quiz-1', 'ch-1', 'admin-1');

      expect(result.message).toBe('Quiz is already in this chapter');
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(
        courseVersionService.autoPublishAfterStructuralChange,
      ).not.toHaveBeenCalled();
    });

    // Within one course a quiz is in at most one chapter: version references
    // and the version diff are per course.
    it('rejects a quiz already live in another chapter of the same course', async () => {
      prisma.chapter.findUnique.mockResolvedValue(chapterFixture());
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-1', isArchived: false, question: 'Q?' },
      ]);
      placements({
        otherChaptersOfCourse: [
          {
            id: 'cq-3',
            quizId: 'quiz-1',
            chapter: {
              title: 'Element 3',
              isArchived: false,
              module: { isArchived: false },
            },
          },
        ],
      });

      let caught: any;
      try {
        await service.assignQuiz('quiz-1', 'ch-1', 'admin-1');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HttpException);
      expect(caught.getResponse().error).toMatch(
        /only one chapter of a course.*Element 3/,
      );
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      // Same-course check is scoped to this course's other chapters.
      expect(prisma.chapterQuiz.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            quizId: { in: ['quiz-1'] },
            chapterId: { not: 'ch-1' },
            isArchived: false,
            chapter: { module: { courseId: 'course-1' } },
          },
        }),
      );
    });

    // The old single-chapter assign MOVED a quiz; one left in an archived
    // chapter (which the admin can no longer open to unassign) still moves.
    it('moves a quiz out of an archived chapter of the same course', async () => {
      prisma.chapter.findUnique.mockResolvedValue(chapterFixture());
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-1', isArchived: false, question: 'Q?' },
      ]);
      placements({
        otherChaptersOfCourse: [
          {
            id: 'cq-old',
            quizId: 'quiz-1',
            chapter: {
              title: 'Deleted element',
              isArchived: true,
              module: { isArchived: false },
            },
          },
        ],
      });

      await service.assignQuiz('quiz-1', 'ch-1', 'admin-1');

      expect(prisma.chapterQuiz.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['cq-old'] } },
        data: { isArchived: true, archivedAt: expect.any(Date) },
      });
      expect(placedRows()).toMatchObject({ quizIds: ['quiz-1'] });
    });

    it('locks the quiz rows before deciding, inside one transaction', async () => {
      prisma.chapter.findUnique.mockResolvedValue(chapterFixture());
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-1', isArchived: false },
      ]);

      await service.assignQuiz('quiz-1', 'ch-1', 'admin-1');

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        maxWait: 5000,
        timeout: 15000,
      });
      const sql = (prisma.$queryRaw.mock.calls[0][0] as string[]).join('?');
      // Fixed lock order: overlapping bulk assigns cannot deadlock.
      expect(sql).toMatch(/ORDER BY id FOR UPDATE/);
    });

    it('restoring an archived quiz also publishes the other courses it reappears in', async () => {
      prisma.chapter.findUnique.mockResolvedValue(chapterFixture());
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-1', isArchived: true },
      ]);
      placements({
        // Still placed (live) in another course, hidden only by the archive.
        elsewhere: [placementIn('course-1'), placementIn('course-other')],
      });

      await service.assignQuiz('quiz-1', 'ch-1', 'admin-1');

      expect(
        courseVersionService.autoPublishAfterStructuralChange,
      ).toHaveBeenCalledWith('course-other', 'admin-1', 'Restored quiz');
      // The target course is published once, for the assign itself.
      expect(
        courseVersionService.autoPublishAfterStructuralChange,
      ).toHaveBeenCalledTimes(2);
    });

    it('throws when the quiz does not exist', async () => {
      prisma.chapter.findUnique.mockResolvedValue(chapterFixture());
      prisma.quiz.findMany.mockResolvedValue([]);

      await expect(
        service.assignQuiz('quiz-ghost', 'ch-1', 'admin-1'),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('rejects assign on an IMPORTED_SCORM course', async () => {
      prisma.chapter.findUnique.mockResolvedValue(
        chapterFixture('IMPORTED_SCORM'),
      );

      await expect(
        service.assignQuiz('quiz-1', 'ch-1', 'admin-1'),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('bulkAssignQuiz', () => {
    it('assigns every quiz with sequential orderIndex and publishes once', async () => {
      prisma.chapter.findUnique.mockResolvedValue(chapterFixture());
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-a', isArchived: false },
        { id: 'quiz-b', isArchived: false },
        { id: 'quiz-c', isArchived: false },
      ]);
      prisma.chapterQuiz.aggregate.mockResolvedValue({
        _max: { orderIndex: 4 },
      });

      const result = await service.bulkAssignQuiz(
        'ch-1',
        ['quiz-a', 'quiz-b', 'quiz-c'],
        'admin-1',
      );

      // One statement for the batch, appended in payload order.
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(placedRows()).toMatchObject({
        chapterId: 'ch-1',
        quizIds: ['quiz-a', 'quiz-b', 'quiz-c'],
        orders: [5, 6, 7],
      });
      // The next slot is computed past the live quizzes only, ignoring the
      // ones being (re)assigned.
      expect(prisma.chapterQuiz.aggregate).toHaveBeenCalledWith({
        where: {
          chapterId: 'ch-1',
          isArchived: false,
          quiz: { isArchived: false },
          quizId: { notIn: ['quiz-a', 'quiz-b', 'quiz-c'] },
        },
        _max: { orderIndex: true },
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
        assignedCount: 3,
        alreadyInChapterCount: 0,
      });
    });

    it('leaves quizzes already in the chapter where they are and appends the rest', async () => {
      prisma.chapter.findUnique.mockResolvedValue(chapterFixture());
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-a', isArchived: false },
        { id: 'quiz-b', isArchived: false },
      ]);
      placements({ here: [{ quizId: 'quiz-a', isArchived: false }] });
      prisma.chapterQuiz.aggregate.mockResolvedValue({
        _max: { orderIndex: 0 },
      });

      const result = await service.bulkAssignQuiz(
        'ch-1',
        ['quiz-a', 'quiz-b'],
        'admin-1',
      );

      expect(placedRows()).toMatchObject({
        quizIds: ['quiz-b'],
        orders: [1],
      });
      expect(result.message).toContain('1 already in this chapter');
      expect(result.data).toMatchObject({
        assignedCount: 1,
        alreadyInChapterCount: 1,
      });
    });

    it('dedupes repeated quiz ids in the payload', async () => {
      prisma.chapter.findUnique.mockResolvedValue(chapterFixture());
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-a', isArchived: false },
      ]);

      await service.bulkAssignQuiz('ch-1', ['quiz-a', 'quiz-a'], 'admin-1');

      expect(placedRows()).toMatchObject({ quizIds: ['quiz-a'] });
    });

    it('throws when the chapter does not exist', async () => {
      prisma.chapter.findUnique.mockResolvedValue(null);

      await expect(
        service.bulkAssignQuiz('missing-ch', ['quiz-a'], 'admin-1'),
      ).rejects.toThrow(HttpException);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('rejects bulk assign on an IMPORTED_SCORM course', async () => {
      prisma.chapter.findUnique.mockResolvedValue(
        chapterFixture('IMPORTED_SCORM'),
      );
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-a', isArchived: false },
      ]);

      await expect(
        service.bulkAssignQuiz('ch-1', ['quiz-a'], 'admin-1'),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('throws naming any quiz id that does not exist, without partially assigning', async () => {
      prisma.chapter.findUnique.mockResolvedValue(chapterFixture());
      // Only quiz-a is real; quiz-ghost is not.
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-a', isArchived: false },
      ]);

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
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(
        courseVersionService.autoPublishAfterStructuralChange,
      ).not.toHaveBeenCalled();
    });
  });

  describe('reorderChapterQuizzes', () => {
    it("updates this chapter's placement order in a transaction without publishing", async () => {
      prisma.chapterQuiz.findMany.mockResolvedValue([
        { quizId: 'quiz-a' },
        { quizId: 'quiz-b' },
      ]);
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
      // Per chapter: a shared quiz keeps its position in other chapters.
      expect(prisma.chapterQuiz.update).toHaveBeenCalledWith({
        where: { chapterId_quizId: { chapterId: 'ch-1', quizId: 'quiz-b' } },
        data: { orderIndex: 0 },
      });
      expect(prisma.quiz.update).not.toHaveBeenCalled();
      expect(
        courseVersionService.autoPublishAfterStructuralChange,
      ).not.toHaveBeenCalled();
    });

    it('rejects when payload omits an active chapter quiz', async () => {
      prisma.chapterQuiz.findMany.mockResolvedValue([
        { quizId: 'quiz-a' },
        { quizId: 'quiz-b' },
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
    const referencedBy4 = {
      stillServedTo: 4,
      versions: [
        {
          versionId: 'v-2',
          versionNumber: 2,
          status: 'PUBLISHED',
          enrollmentCount: 4,
        },
      ],
    };

    beforeEach(() => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'quiz-1' });
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        title: 'C',
        module: { courseId: 'course-1' },
      });
      prisma.chapterQuiz.findUnique.mockResolvedValue({ isArchived: false });
    });

    it('archives the placement and the quiz when referenced and used nowhere else', async () => {
      courseVersionService.getReferencingVersionsWithEnrollments.mockResolvedValue(
        referencedBy4,
      );
      prisma.chapterQuiz.count.mockResolvedValue(0);

      const result = await service.unAssignQuiz('quiz-1', 'ch-1', 'admin-1');

      expect(prisma.chapterQuiz.update).toHaveBeenCalledWith({
        where: { chapterId_quizId: { chapterId: 'ch-1', quizId: 'quiz-1' } },
        data: { isArchived: true, archivedAt: expect.any(Date) },
      });
      expect(prisma.quiz.update).toHaveBeenCalledWith({
        where: { id: 'quiz-1' },
        data: { isArchived: true, archivedAt: expect.any(Date) },
      });
      expect(prisma.chapterQuiz.delete).not.toHaveBeenCalled();
      expect(result.message).toContain('Archived');
      expect((result as any).outcome).toBe('archived');
      expect((result as any).stillServedTo).toBe(4);
      // Decided under a row lock, so a concurrent assign elsewhere can't race
      // the "used nowhere else" count.
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        maxWait: 5000,
        timeout: 15000,
      });
      expect((prisma.$queryRaw.mock.calls[0][0] as string[]).join('?')).toMatch(
        /FOR UPDATE/,
      );
    });

    it('only removes it from this chapter when another chapter still uses it', async () => {
      courseVersionService.getReferencingVersionsWithEnrollments.mockResolvedValue(
        referencedBy4,
      );
      // Still live in NEBOSH (TEST)'s chapter.
      prisma.chapterQuiz.count.mockResolvedValue(1);

      await service.unAssignQuiz('quiz-1', 'ch-1', 'admin-1');

      expect(prisma.chapterQuiz.count).toHaveBeenCalledWith({
        where: {
          quizId: 'quiz-1',
          isArchived: false,
          chapterId: { not: 'ch-1' },
        },
      });
      expect(prisma.chapterQuiz.update).toHaveBeenCalled();
      expect(prisma.quiz.update).not.toHaveBeenCalled();
      expect(courseVersionService.writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ARCHIVE_QUIZ',
          metadata: expect.objectContaining({
            quizArchived: false,
            stillUsedInOtherChapters: 1,
          }),
        }),
      );
    });

    it('marks just the placement removed when not referenced; the quiz stays in the bank', async () => {
      const result = await service.unAssignQuiz('quiz-1', 'ch-1');

      // Kept, never deleted: a version published concurrently may list it.
      expect(prisma.chapterQuiz.update).toHaveBeenCalledWith({
        where: { chapterId_quizId: { chapterId: 'ch-1', quizId: 'quiz-1' } },
        data: { isArchived: true, archivedAt: expect.any(Date) },
      });
      expect(prisma.chapterQuiz.delete).not.toHaveBeenCalled();
      expect(prisma.quiz.update).not.toHaveBeenCalled();
      expect(prisma.quiz.delete).not.toHaveBeenCalled();
      expect((result as any).outcome).toBe('unassigned');
    });

    it('rejects when the quiz is not in this chapter (never touches other chapters)', async () => {
      prisma.chapterQuiz.findUnique.mockResolvedValue(null);

      await expect(
        service.unAssignQuiz('quiz-1', 'ch-1'),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.chapterQuiz.update).not.toHaveBeenCalled();
      expect(prisma.chapterQuiz.delete).not.toHaveBeenCalled();
      expect(prisma.quiz.update).not.toHaveBeenCalled();
    });

    it('rejects unassign on an IMPORTED_SCORM course', async () => {
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        title: 'C',
        module: {
          courseId: 'course-1',
          course: { deliveryMode: 'IMPORTED_SCORM' },
        },
      });

      await expect(
        service.unAssignQuiz('quiz-1', 'ch-1'),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.quiz.update).not.toHaveBeenCalled();
      expect(prisma.chapterQuiz.delete).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // PR 1: restoreQuiz — the un-archive endpoint. Mirrors CourseService's
  // three restore endpoints; kept in this file because it lives on
  // QuizService. The parent-chain guard is the interesting bit because
  // quizzes are two levels deep (chapter → module → course), can
  // legitimately be in no chapter (unassigned + archived), or in several.
  // ────────────────────────────────────────────────────────────────────

  describe('restoreQuiz', () => {
    const placed = (
      chapterArchived: boolean,
      moduleArchived: boolean,
      id = 'ch-1',
    ) => ({
      chapter: {
        id,
        isArchived: chapterArchived,
        title: chapterArchived ? 'Archived Ch' : 'Live Chapter',
        module: {
          id: `mod-${id}`,
          isArchived: moduleArchived,
          title: moduleArchived ? 'Archived Module' : 'Live Module',
          courseId: 'course-1',
        },
      },
    });

    it('flips isArchived to false, clears archivedAt, and emits RESTORE_ENTITY audit', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        isArchived: true,
        question: 'Old Q?',
        placements: [placed(false, false)],
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
        isArchived: true,
        question: 'Q?',
        placements: [placed(true, false)],
      });

      await expect(service.restoreQuiz('quiz-1', 'admin-1')).rejects.toThrow(
        HttpException,
      );
      expect(prisma.quiz.update).not.toHaveBeenCalled();
    });

    it('returns 409 with module first in chain when grandparent module is archived', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        isArchived: true,
        question: 'Q?',
        placements: [placed(false, true)],
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

    it('restores a shared quiz when at least one of its chapters is live', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        isArchived: true,
        question: 'Q?',
        placements: [placed(true, false, 'ch-1'), placed(false, false, 'ch-2')],
      });
      prisma.quiz.update.mockResolvedValue({ id: 'quiz-1', isArchived: false });

      const result = await service.restoreQuiz('quiz-1', 'admin-1');

      expect(result.statusCode).toBe(200);
      expect(prisma.quiz.update).toHaveBeenCalled();
    });

    it('restores a chapter-less quiz (unassigned + archived) without a parent-chain check', async () => {
      // unAssignQuiz removes the placement on archive. Restoring returns the
      // quiz to the bank; assignQuiz can later put it back in a chapter. No
      // parent to guard against.
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        isArchived: true,
        question: 'Q?',
        placements: [],
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
        isArchived: false,
        question: 'Q?',
        placements: [placed(false, false)],
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
