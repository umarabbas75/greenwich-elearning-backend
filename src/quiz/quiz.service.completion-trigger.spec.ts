import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CourseVersionService } from '../course-version/course-version.service';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { QuizService } from './quiz.service';

/**
 * Regression tests for the production bug: course completion used to be
 * re-evaluated ONLY when a section-progress row was created. On a course where
 * every chapter carries a quiz — including the last — the learner's final act
 * is passing a quiz, so completion was never re-checked and `courseCompletedAt`
 * would never be stamped.
 *
 * These pin the quiz-pass path as a completion trigger.
 */
describe('QuizService.createChapterQuizzesReport — course-completion trigger', () => {
  let service: QuizService;
  let prisma: Record<string, any>;
  let courseCompletion: { checkContentCompletion: jest.Mock };

  const CHAPTER_ID = 'ch-1';
  const USER_ID = 'user-1';
  const COURSE_ID = 'course-1';

  /** Two questions, both answered correctly => grade passes. */
  const passingAnswers = [
    { quizId: 'q1', isAnswerCorrect: true },
    { quizId: 'q2', isAnswerCorrect: true },
  ];

  beforeEach(async () => {
    prisma = {
      chapter: {
        findUnique: jest.fn().mockResolvedValue({
          moduleId: 'mod-1',
          module: { courseId: COURSE_ID },
        }),
      },
      userCourse: {
        findUnique: jest.fn().mockResolvedValue({ enrolledVersionId: null }),
      },
      // assertChapterAccessible orders chapters to find the previous one.
      // CHAPTER_ID is first, so the gate returns early without a quiz check.
      module: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ chapters: [{ id: CHAPTER_ID }] }]),
      },
      quiz: {
        findMany: jest.fn().mockResolvedValue([{ id: 'q1' }, { id: 'q2' }]),
        count: jest.fn().mockResolvedValue(2),
      },
      quizAnswer: { findMany: jest.fn().mockResolvedValue(passingAnswers) },
      quizProgress: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'qp-1', isPassed: true }),
        update: jest.fn().mockResolvedValue({ id: 'qp-1', isPassed: true }),
      },
      section: { count: jest.fn().mockResolvedValue(0) },
      userCourseProgress: { count: jest.fn().mockResolvedValue(0) },
      userChapterCompletion: {
        findUnique: jest.fn().mockResolvedValue({ id: 'ucc-1' }),
      },
      userModuleCompletion: {
        findUnique: jest.fn().mockResolvedValue({ id: 'umc-1' }),
      },
    };

    courseCompletion = { checkContentCompletion: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: CourseVersionService, useValue: {} },
        { provide: CourseCompletionService, useValue: courseCompletion },
      ],
    }).compile();

    service = module.get<QuizService>(QuizService);
  });

  it('re-checks course completion after a PASSING quiz submission', async () => {
    await service.createChapterQuizzesReport(USER_ID, CHAPTER_ID);

    // The regression guard: without this call, a learner finishing a course on
    // a quiz is never stamped complete.
    expect(courseCompletion.checkContentCompletion).toHaveBeenCalledWith(
      USER_ID,
      COURSE_ID,
    );
  });

  it('does NOT re-check completion when the submission fails', async () => {
    // One wrong answer => not passed => cannot possibly complete the course, so
    // don't pay for the denominator query.
    prisma.quizAnswer.findMany.mockResolvedValue([
      { quizId: 'q1', isAnswerCorrect: false },
      { quizId: 'q2', isAnswerCorrect: false },
    ]);

    await service.createChapterQuizzesReport(USER_ID, CHAPTER_ID);

    expect(courseCompletion.checkContentCompletion).not.toHaveBeenCalled();
  });

  it('still returns 200 when the completion check throws', async () => {
    // checkContentCompletion is best-effort by contract, but guard against a
    // completion failure turning a successful quiz submission into a 403 via
    // createChapterQuizzesReport's outer catch.
    courseCompletion.checkContentCompletion.mockRejectedValue(
      new Error('completion blew up'),
    );

    const res = await service.createChapterQuizzesReport(USER_ID, CHAPTER_ID);

    expect(res.statusCode).toBe(200);
  });

  it('rejects an orphan chapter at the access gate, before any completion work', async () => {
    // A chapter with no resolvable course never reaches the quiz write at all —
    // assertChapterAccessible rejects it upfront. Documented here so the
    // completion trigger is not blamed for this path.
    prisma.chapter.findUnique.mockResolvedValue(null);
    prisma.module.findMany.mockResolvedValue([]);

    await expect(
      service.createChapterQuizzesReport(USER_ID, CHAPTER_ID),
    ).rejects.toThrow();

    expect(prisma.quizProgress.create).not.toHaveBeenCalled();
    expect(courseCompletion.checkContentCompletion).not.toHaveBeenCalled();
  });
});
