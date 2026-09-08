import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { QuestionType } from '@prisma/client';
import { CourseVersionService } from '../course-version/course-version.service';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuizService } from './quiz.service';

// Multi-type question support for chapter quizzes — see
// docs/quiz-question-types-backend-handoff.md. Legacy MCQ coverage lives in
// quiz.service.versioning.spec.ts; this file covers the additive `type` /
// `content` behavior only.
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

describe('QuizService — multi-type questions', () => {
  let service: QuizService;
  let prisma: Record<string, any>;
  let courseVersionService: Record<string, jest.Mock>;

  beforeEach(async () => {
    prisma = {
      chapter: { findUnique: jest.fn(), findMany: jest.fn() },
      userCourse: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      quiz: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      quizAnswer: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    courseVersionService = {
      getVersionQuizzesForChapter: jest.fn(),
      resolveEnrolledVersionId: jest.fn(),
    };

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
    prisma.quizAnswer.findMany.mockResolvedValue([]);
  });

  describe('createQuiz', () => {
    it('stores a typed quiz with content and an empty legacy options array', async () => {
      prisma.quiz.create.mockResolvedValue({ id: 'quiz-1' });

      await service.createQuiz({
        question: 'Pick the safe option',
        type: QuestionType.MULTIPLE_CHOICE,
        content: {
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
          correctOptionIds: ['a'],
        },
      } as any);

      expect(prisma.quiz.create).toHaveBeenCalledWith({
        data: {
          question: 'Pick the safe option',
          options: [],
          type: QuestionType.MULTIPLE_CHOICE,
          content: {
            options: [
              { id: 'a', text: 'A' },
              { id: 'b', text: 'B' },
            ],
            correctOptionIds: ['a'],
          },
        },
      });
    });

    it('still creates a legacy quiz exactly as before when type is omitted', async () => {
      prisma.quiz.create.mockResolvedValue({ id: 'quiz-1' });

      await service.createQuiz({
        question: 'Capital of France?',
        options: ['Paris', 'London'],
        answer: 'Paris',
      } as any);

      expect(prisma.quiz.create).toHaveBeenCalledWith({
        data: {
          question: 'Capital of France?',
          options: ['Paris', 'London'],
          answer: 'Paris',
        },
      });
    });
  });

  describe('checkQuiz', () => {
    const body = {
      quizId: 'quiz-1',
      chapterId: 'ch-1',
      isAnswered: true,
    } as any;

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      progression.resolveChapterQuizIds.mockResolvedValue(['quiz-1']);
    });

    it('SINGLE_CHOICE: grades full marks and returns systemScore/maxMarks', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        type: QuestionType.SINGLE_CHOICE,
        content: {
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
          correctOptionId: 'b',
        },
      });
      prisma.quizAnswer.findFirst.mockResolvedValue(null);
      prisma.quizAnswer.create.mockResolvedValue({ id: 'ans-1' });

      const result = await service.checkQuiz('user-1', {
        ...body,
        studentAnswer: { selectedOptionId: 'b' },
      });

      expect(prisma.quizAnswer.create).toHaveBeenCalledWith({
        data: {
          quizId: 'quiz-1',
          chapterId: 'ch-1',
          userId: 'user-1',
          studentAnswer: { selectedOptionId: 'b' },
          isAnswerCorrect: true,
          systemScore: 1,
        },
      });
      expect(result.data).toMatchObject({
        isAnswerCorrect: true,
        systemScore: 1,
        maxMarks: 1,
      });
    });

    it('MULTIPLE_CHOICE: partial credit via Jaccard similarity is not "correct"', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        type: QuestionType.MULTIPLE_CHOICE,
        content: {
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
            { id: 'c', text: 'C' },
          ],
          correctOptionIds: ['a', 'c'],
        },
      });
      prisma.quizAnswer.findFirst.mockResolvedValue(null);
      prisma.quizAnswer.create.mockResolvedValue({ id: 'ans-1' });

      const result = await service.checkQuiz('user-1', {
        ...body,
        studentAnswer: { selectedOptionIds: ['a', 'b'] },
      });

      // intersection {a}=1, union {a,b,c}=3 -> 1/3
      expect(result.data).toMatchObject({
        isAnswerCorrect: false,
        systemScore: 1 / 3,
        maxMarks: 1,
      });
    });

    it('re-homes an existing answer via update, writing studentAnswer/systemScore (no legacy `answer` key)', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        type: QuestionType.TRUE_FALSE,
        content: { correctAnswer: true },
      });
      prisma.quizAnswer.findFirst.mockResolvedValue({
        id: 'ans-1',
        chapterId: 'ch-OLD',
      });
      prisma.quizAnswer.update.mockResolvedValue({ id: 'ans-1' });

      await service.checkQuiz('user-1', {
        ...body,
        studentAnswer: { answer: true },
      });

      expect(prisma.quizAnswer.update).toHaveBeenCalledWith({
        where: { userId_quizId: { userId: 'user-1', quizId: 'quiz-1' } },
        data: {
          chapterId: 'ch-1',
          studentAnswer: { answer: true },
          isAnswerCorrect: true,
          systemScore: 1,
        },
      });
    });

    it('rejects a typed quiz submitted with no studentAnswer', async () => {
      prisma.quiz.findUnique.mockResolvedValue({
        id: 'quiz-1',
        type: QuestionType.TRUE_FALSE,
        content: { correctAnswer: true },
      });
      prisma.quizAnswer.findFirst.mockResolvedValue(null);

      await expect(
        service.checkQuiz('user-1', { ...body }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.quizAnswer.create).not.toHaveBeenCalled();
    });
  });

  describe('getAllAssignQuizzes', () => {
    it('strips correct-answer fields from a typed quiz for a student, keeps them for admin', async () => {
      const rawQuiz = {
        id: 'quiz-1',
        question: 'Pick one',
        options: [],
        type: QuestionType.SINGLE_CHOICE,
        content: {
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
          correctOptionId: 'b',
        },
      };

      // Student path (unpinned -> live fallback; null is the documented
      // "no pinned version" signal from getVersionQuizzesForChapter).
      prisma.chapter.findUnique
        .mockResolvedValueOnce({ id: 'ch-1', module: { courseId: 'course-1' } })
        .mockResolvedValueOnce({ id: 'ch-1', quizzes: [rawQuiz] });
      prisma.userCourse.findUnique.mockResolvedValue(null);
      courseVersionService.getVersionQuizzesForChapter.mockResolvedValue(null);

      const studentResult = await service.getAllAssignQuizzes(
        'ch-1',
        'user',
        'user-1',
      );
      expect(studentResult.data[0].content).toEqual({
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
      });

      // Admin path.
      prisma.chapter.findUnique
        .mockResolvedValueOnce({ id: 'ch-1', module: { courseId: 'course-1' } })
        .mockResolvedValueOnce({ id: 'ch-1', quizzes: [rawQuiz] });

      const adminResult = await service.getAllAssignQuizzes(
        'ch-1',
        'admin',
        'admin-1',
      );
      expect(adminResult.data[0].content).toEqual(rawQuiz.content);
    });

    it('derives userAnswered from studentAnswer (not the legacy answer field) for typed quizzes', async () => {
      const rawQuiz = {
        id: 'quiz-1',
        question: 'Pick one',
        options: [],
        type: QuestionType.SINGLE_CHOICE,
        content: { options: [], correctOptionId: 'b' },
      };
      prisma.chapter.findUnique
        .mockResolvedValueOnce({ id: 'ch-1', module: { courseId: 'course-1' } })
        .mockResolvedValueOnce({ id: 'ch-1', quizzes: [rawQuiz] });
      prisma.userCourse.findUnique.mockResolvedValue(null);
      courseVersionService.getVersionQuizzesForChapter.mockResolvedValue(null);
      prisma.quizAnswer.findMany.mockResolvedValue([
        {
          quizId: 'quiz-1',
          answer: null,
          studentAnswer: { selectedOptionId: 'b' },
          isAnswerCorrect: true,
        },
      ]);

      const result = await service.getAllAssignQuizzes(
        'ch-1',
        'user',
        'user-1',
      );

      expect(result.data[0]).toMatchObject({
        userAnswered: true,
        isAnswerCorrect: true,
        studentAnswer: { selectedOptionId: 'b' },
      });
    });
  });
});
