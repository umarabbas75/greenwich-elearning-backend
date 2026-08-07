import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertChapterAccessible,
  gradeChapterQuizFromStoredAnswers,
  getOrderedChapterIdsForVersion,
  isChapterComplete,
  recordChapterAndModuleCompletionIfNeeded,
} from './chapter-progression';
import { resetManifestCache } from '../course-version/course-version.manifest';

const versionManifest = {
  modules: [
    {
      sourceId: 'mod-1',
      order: 0,
      chapters: [
        {
          sourceId: 'ch-1',
          order: 0,
          sectionIds: ['sec-1', 'sec-2'],
          quizIds: ['quiz-1'],
        },
        {
          sourceId: 'ch-2',
          order: 1,
          sectionIds: ['sec-3'],
          quizIds: [],
        },
      ],
    },
  ],
};

describe('chapter-progression', () => {
  let prisma: Record<string, any>;
  let config: ConfigService;

  beforeEach(() => {
    // loadVersionManifest now shares the module-level manifest cache; clear it so
    // one test's cached manifest can't bleed into the next.
    resetManifestCache();
    prisma = {
      chapter: { findUnique: jest.fn() },
      userCourse: { findUnique: jest.fn() },
      module: { findUnique: jest.fn(), findMany: jest.fn() },
      courseVersion: { findUnique: jest.fn() },
      section: { count: jest.fn() },
      quiz: { count: jest.fn(), findMany: jest.fn() },
      quizAnswer: { findMany: jest.fn() },
      userCourseProgress: { count: jest.fn() },
      quizProgress: { findFirst: jest.fn(), findUnique: jest.fn() },
      userChapterCompletion: {
        findUnique: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
      },
      userModuleCompletion: { findUnique: jest.fn(), create: jest.fn() },
    };
    config = { get: jest.fn().mockReturnValue('') } as unknown as ConfigService;
    // Manifest quiz hydration: treat every manifest id as an existing row unless
    // a test overrides this mock.
    prisma.quiz.findMany.mockImplementation(
      (args: { where?: { id?: { in?: string[] } } }) => {
        const ids = args?.where?.id?.in;
        if (ids?.length) {
          return Promise.resolve(ids.map((id) => ({ id })));
        }
        return Promise.resolve([]);
      },
    );
  });

  describe('getOrderedChapterIdsForVersion', () => {
    it('returns source chapter ids from manifest', async () => {
      prisma.courseVersion.findUnique.mockResolvedValue({
        manifest: versionManifest,
      });

      await expect(
        getOrderedChapterIdsForVersion(
          prisma as unknown as PrismaService,
          'v1',
        ),
      ).resolves.toEqual(['ch-1', 'ch-2']);
    });
  });

  describe('gradeChapterQuizFromStoredAnswers', () => {
    // Regression: an archived quiz still carries chapterId, so the old grader
    // (raw chapter.quizzes) counted it in totalQuestions while the learner is
    // only served the non-archived ones — making answeredQuestions < total
    // forever and permanently blocking chapter submission. The grader must use
    // the same non-archived set the learner is served.
    it('unpinned: denominator is the live non-archived quiz set (excludes archived)', async () => {
      // Live query returns only non-archived quizzes (the archived one is gone).
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-1' },
        { id: 'quiz-2' },
      ]);
      prisma.quizAnswer.findMany.mockResolvedValue([
        { quizId: 'quiz-1', isAnswerCorrect: true },
        { quizId: 'quiz-2', isAnswerCorrect: true },
      ]);

      const grade = await gradeChapterQuizFromStoredAnswers(
        prisma as unknown as PrismaService,
        'user-1',
        'ch-1',
        70,
        { courseId: 'course-1', enrolledVersionId: null },
      );

      expect(grade.totalQuestions).toBe(2);
      expect(grade.answeredQuestions).toBe(2);
      expect(grade.score).toBe(100);
      expect(grade.isPassed).toBe(true);
      expect(prisma.quiz.findMany).toHaveBeenCalledWith({
        where: { chapterId: 'ch-1', isArchived: false },
        orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
    });

    // Regression: a quiz added after the learner's pin must NOT inflate the
    // denominator. A pinned learner is graded against their version's manifest
    // quiz set (ch-1 → ['quiz-1']), not the live tree.
    it('pinned: denominator comes from the version manifest, not the live tree', async () => {
      prisma.courseVersion.findUnique.mockResolvedValue({
        manifest: versionManifest,
      });
      prisma.quizAnswer.findMany.mockResolvedValue([
        { quizId: 'quiz-1', isAnswerCorrect: true },
      ]);

      const grade = await gradeChapterQuizFromStoredAnswers(
        prisma as unknown as PrismaService,
        'user-1',
        'ch-1',
        70,
        { courseId: 'course-1', enrolledVersionId: 'version-1' },
      );

      expect(grade.totalQuestions).toBe(1);
      expect(grade.answeredQuestions).toBe(1);
      expect(grade.score).toBe(100);
      // Hydrates manifest ids against DB (same as loadPinnedChapterQuizzes).
      expect(prisma.quiz.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['quiz-1'] } },
        select: { id: true, orderIndex: true, createdAt: true },
      });
    });
  });

  describe('isChapterComplete', () => {
    it('uses manifest denominator when enrollment context is provided', async () => {
      prisma.courseVersion.findUnique.mockResolvedValue({
        manifest: versionManifest,
      });
      prisma.userCourseProgress.count.mockResolvedValue(2);
      prisma.quizProgress.findFirst.mockResolvedValue({ isPassed: true });

      await expect(
        isChapterComplete(
          prisma as unknown as PrismaService,
          'user-1',
          'ch-1',
          {
            courseId: 'course-1',
            enrolledVersionId: 'version-1',
          },
        ),
      ).resolves.toBe(true);

      expect(prisma.chapter.findUnique).not.toHaveBeenCalled();
      expect(prisma.userCourse.findUnique).not.toHaveBeenCalled();
    });

    it('returns false when sections incomplete', async () => {
      prisma.courseVersion.findUnique.mockResolvedValue({
        manifest: versionManifest,
      });
      prisma.userCourseProgress.count.mockResolvedValue(1);
      prisma.quizProgress.findFirst.mockResolvedValue(null);

      await expect(
        isChapterComplete(
          prisma as unknown as PrismaService,
          'user-1',
          'ch-1',
          {
            courseId: 'course-1',
            enrolledVersionId: 'version-1',
          },
        ),
      ).resolves.toBe(false);
    });
  });

  describe('assertChapterAccessible', () => {
    it('skips gate for first chapter in course', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        enrolledVersionId: 'version-1',
      });
      prisma.courseVersion.findUnique.mockResolvedValue({
        manifest: {
          modules: [
            {
              sourceId: 'mod-1',
              order: 0,
              chapters: [
                { sourceId: 'ch-1', order: 0, sectionIds: [], quizIds: [] },
              ],
            },
          ],
        },
      });

      await expect(
        assertChapterAccessible(
          prisma as unknown as PrismaService,
          config,
          'user-1',
          'ch-1',
          'learner@test.com',
          { courseId: 'course-1' },
        ),
      ).resolves.toBeUndefined();

      expect(prisma.userCourseProgress.count).not.toHaveBeenCalled();
    });

    it('throws when previous chapter is incomplete', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        enrolledVersionId: 'version-1',
      });
      prisma.courseVersion.findUnique.mockResolvedValue({
        manifest: versionManifest,
      });
      prisma.userCourseProgress.count.mockResolvedValue(1);
      prisma.quizProgress.findFirst.mockResolvedValue({ isPassed: false });

      await expect(
        assertChapterAccessible(
          prisma as unknown as PrismaService,
          config,
          'user-1',
          'ch-2',
          'learner@test.com',
          { courseId: 'course-1' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('recordChapterAndModuleCompletionIfNeeded', () => {
    it('creates chapter completion when chapter is complete and none exists', async () => {
      prisma.chapter.findUnique.mockResolvedValue({
        moduleId: 'mod-1',
        module: { courseId: 'course-1' },
      });
      prisma.userCourse.findUnique.mockResolvedValue({
        enrolledVersionId: 'version-1',
      });
      prisma.userChapterCompletion.findUnique.mockResolvedValue(null);
      prisma.courseVersion.findUnique.mockResolvedValue({
        manifest: {
          modules: [
            {
              sourceId: 'mod-1',
              order: 0,
              chapters: [
                {
                  sourceId: 'ch-1',
                  order: 0,
                  sectionIds: ['sec-1'],
                  quizIds: [],
                },
              ],
            },
          ],
        },
      });
      prisma.userCourseProgress.count.mockResolvedValue(1);
      prisma.quizProgress.findFirst.mockResolvedValue(null);
      prisma.userModuleCompletion.findUnique.mockResolvedValue(null);
      prisma.module.findUnique.mockResolvedValue({ courseId: 'course-1' });
      prisma.userChapterCompletion.count.mockResolvedValue(1);
      prisma.userChapterCompletion.create.mockResolvedValue({});
      prisma.userModuleCompletion.create.mockResolvedValue({});

      await recordChapterAndModuleCompletionIfNeeded(
        prisma as unknown as PrismaService,
        'user-1',
        'ch-1',
      );

      expect(prisma.userChapterCompletion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            chapterId: 'ch-1',
            moduleId: 'mod-1',
            courseId: 'course-1',
          }),
        }),
      );
      expect(prisma.userModuleCompletion.create).toHaveBeenCalled();
    });
  });
});
