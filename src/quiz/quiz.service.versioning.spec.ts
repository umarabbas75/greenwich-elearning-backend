import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CourseVersionService } from '../course-version/course-version.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuizService } from './quiz.service';

jest.mock('../utils/chapter-progression', () => ({
  assertChapterAccessible: jest.fn().mockResolvedValue(undefined),
  enrichQuizProgressReport: jest.fn((x) => x),
  gradeChapterQuizFromStoredAnswers: jest.fn(),
  resolvePassingCriteria: jest.fn(),
}));

describe('QuizService — course versioning', () => {
  let service: QuizService;
  let prisma: Record<string, any>;
  let courseVersionService: Record<string, jest.Mock>;

  beforeEach(async () => {
    prisma = {
      chapter: { findUnique: jest.fn(), update: jest.fn() },
      userCourse: { findUnique: jest.fn() },
      quiz: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
      quizAnswer: { findMany: jest.fn().mockResolvedValue([]) },
    };

    courseVersionService = {
      getVersionQuizzesForChapter: jest.fn(),
      resolveEnrolledVersionId: jest.fn(),
      resolveCurriculumTree: jest.fn(),
      findVersionChapterBySourceId: jest.fn(),
      mapVersionQuizzesForLearner: jest.fn(),
      isReferencedByAnyVersion: jest.fn(),
      autoPublishAfterStructuralChange: jest.fn().mockResolvedValue({
        versionNumber: 2,
        versionId: 'version-2',
      }),
      syncQuizToLatestVersion: jest.fn(),
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
      expect(courseVersionService.resolveEnrolledVersionId).toHaveBeenCalledWith(
        'user-1',
        'course-1',
        { id: 'uc-1', enrolledVersionId: 'version-1' },
      );
      expect(
        courseVersionService.getVersionQuizzesForChapter,
      ).toHaveBeenCalledWith(
        'user-1',
        'course-1',
        'ch-1',
        false,
        'version-1',
      );
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
      prisma.quiz.update.mockResolvedValue({ id: 'quiz-1', isArchived: true });

      const result = await service.deleteQuiz('quiz-1');

      expect(prisma.quiz.update).toHaveBeenCalledWith({
        where: { id: 'quiz-1' },
        data: { isArchived: true },
      });
      expect(prisma.quiz.delete).not.toHaveBeenCalled();
      expect(result.message).toContain('archived');
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
      prisma.quiz.update.mockResolvedValue({});

      const result = await service.unAssignQuiz('quiz-1', 'ch-1');

      expect(prisma.quiz.update).toHaveBeenCalledWith({
        where: { id: 'quiz-1' },
        data: { isArchived: true, chapterId: null },
      });
      expect(prisma.chapter.update).not.toHaveBeenCalled();
      expect(result.message).toContain('archived');
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
