import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { FeedbackService } from '../feedback/feedback.service';
import { CourseVersionService } from '../course-version/course-version.service';
import { CourseCompletionService } from './course-completion.service';

/**
 * Completion stamping had ZERO test coverage before this file — which is how
 * the sections-only predicate survived. These tests pin the rule that a course
 * is complete only when every section is done AND every quiz-bearing chapter
 * has a passing QuizProgress.
 */
describe('CourseCompletionService.checkContentCompletion', () => {
  let service: CourseCompletionService;
  let prisma: Record<string, any>;
  let mail: Record<string, any>;
  let feedbackService: Record<string, any>;
  let courseVersionService: Record<string, any>;

  /** Denominator helper: N sections, and the given quiz-bearing chapters. */
  const denominator = (
    sectionIds: string[],
    quizChapterIds: string[] = [],
  ) => ({
    total: sectionIds.length,
    liveSectionIds: sectionIds,
    quizBearingChapterIds: quizChapterIds,
  });

  /** All sections progressed. */
  const allProgressed = (sectionIds: string[]) =>
    sectionIds.map((id) => ({ sectionId: id }));

  beforeEach(async () => {
    prisma = {
      userCourseProgress: { findMany: jest.fn().mockResolvedValue([]) },
      quizProgress: { count: jest.fn().mockResolvedValue(0) },
      courseCompletion: {
        findUnique: jest.fn().mockResolvedValue(null),
        // Conditional-write path: no row yet -> create; row exists with a null
        // courseCompletedAt -> updateMany claims it (count 1 = this caller won).
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          email: 'jane@example.com',
          firstName: 'Jane',
          deletedAt: null,
        }),
      },
      course: {
        findUnique: jest.fn().mockResolvedValue({ title: 'NEBOSH IGC' }),
      },
      courseFeedbackForm: { findFirst: jest.fn().mockResolvedValue(null) },
      courseFeedbackSubmission: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    mail = {
      sendCourseCompleted: jest.fn().mockResolvedValue(undefined),
      sendFeedbackRequest: jest.fn().mockResolvedValue(undefined),
    };
    feedbackService = {
      notifyFeedbackRequiredIfNeeded: jest.fn().mockResolvedValue(undefined),
    };
    courseVersionService = {
      countCompletionDenominator: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseCompletionService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        { provide: FeedbackService, useValue: feedbackService },
        { provide: CourseVersionService, useValue: courseVersionService },
      ],
    }).compile();

    service = module.get<CourseCompletionService>(CourseCompletionService);
  });

  it('stamps completion when all sections done and all quizzes passed', async () => {
    courseVersionService.countCompletionDenominator.mockResolvedValue(
      denominator(['s1', 's2'], ['ch-1']),
    );
    prisma.userCourseProgress.findMany.mockResolvedValue(
      allProgressed(['s1', 's2']),
    );
    prisma.quizProgress.count.mockResolvedValue(1);

    await service.checkContentCompletion('user-1', 'course-1');

    expect(prisma.courseCompletion.create).toHaveBeenCalled();
    expect(mail.sendCourseCompleted).toHaveBeenCalled();
    expect(feedbackService.notifyFeedbackRequiredIfNeeded).toHaveBeenCalledWith(
      'user-1',
      'course-1',
    );
  });

  it('does NOT stamp when a quiz-bearing chapter is unpassed', async () => {
    // THE core new rule. Two quiz chapters, only one passed. This is the
    // OTHM-shaped case: sections all done, final chapter quiz outstanding.
    courseVersionService.countCompletionDenominator.mockResolvedValue(
      denominator(['s1', 's2'], ['ch-1', 'ch-last']),
    );
    prisma.userCourseProgress.findMany.mockResolvedValue(
      allProgressed(['s1', 's2']),
    );
    prisma.quizProgress.count.mockResolvedValue(1);

    await service.checkContentCompletion('user-1', 'course-1');

    expect(prisma.courseCompletion.create).not.toHaveBeenCalled();
    expect(prisma.courseCompletion.updateMany).not.toHaveBeenCalled();
    expect(mail.sendCourseCompleted).not.toHaveBeenCalled();
    expect(
      feedbackService.notifyFeedbackRequiredIfNeeded,
    ).not.toHaveBeenCalled();
  });

  it('stamps for a course with no quizzes at all (zero-quiz course)', async () => {
    // IOSH shape. Must behave exactly as before this change: the quiz query is
    // never even issued.
    courseVersionService.countCompletionDenominator.mockResolvedValue(
      denominator(['s1', 's2'], []),
    );
    prisma.userCourseProgress.findMany.mockResolvedValue(
      allProgressed(['s1', 's2']),
    );

    await service.checkContentCompletion('user-1', 'course-1');

    expect(prisma.quizProgress.count).not.toHaveBeenCalled();
    expect(prisma.courseCompletion.create).toHaveBeenCalled();
  });

  it('stamps when the last chapter has no quiz but all quiz chapters passed', async () => {
    // NEBOSH IGC shape: quizzes on earlier chapters only. The quizless final
    // chapter contributes no requirement.
    courseVersionService.countCompletionDenominator.mockResolvedValue(
      denominator(['s1', 's2', 's3'], ['ch-1', 'ch-2']),
    );
    prisma.userCourseProgress.findMany.mockResolvedValue(
      allProgressed(['s1', 's2', 's3']),
    );
    prisma.quizProgress.count.mockResolvedValue(2);

    await service.checkContentCompletion('user-1', 'course-1');

    expect(prisma.courseCompletion.create).toHaveBeenCalled();
  });

  it('short-circuits on incomplete sections before querying quizzes', async () => {
    // Ordering matters: the cheap section check must still gate the quiz query
    // so the common "not done yet" call costs no extra round trip.
    courseVersionService.countCompletionDenominator.mockResolvedValue(
      denominator(['s1', 's2'], ['ch-1']),
    );
    prisma.userCourseProgress.findMany.mockResolvedValue(allProgressed(['s1']));

    await service.checkContentCompletion('user-1', 'course-1');

    expect(prisma.quizProgress.count).not.toHaveBeenCalled();
    expect(prisma.courseCompletion.create).not.toHaveBeenCalled();
    expect(prisma.courseCompletion.updateMany).not.toHaveBeenCalled();
  });

  it('only counts PASSING quiz progress rows', async () => {
    courseVersionService.countCompletionDenominator.mockResolvedValue(
      denominator(['s1'], ['ch-1']),
    );
    prisma.userCourseProgress.findMany.mockResolvedValue(allProgressed(['s1']));
    prisma.quizProgress.count.mockResolvedValue(1);

    await service.checkContentCompletion('user-1', 'course-1');

    expect(prisma.quizProgress.count).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        chapterId: { in: ['ch-1'] },
        isPassed: true,
      },
    });
  });

  it('is idempotent: already-completed learners are never re-stamped or re-emailed', async () => {
    // Guards requirement 5 — nobody certified under the old rule is revoked or
    // spammed by the new one.
    courseVersionService.countCompletionDenominator.mockResolvedValue(
      denominator(['s1'], []),
    );
    prisma.userCourseProgress.findMany.mockResolvedValue(allProgressed(['s1']));
    prisma.courseCompletion.findUnique.mockResolvedValue({
      courseCompletedAt: new Date('2026-01-01'),
    });

    await service.checkContentCompletion('user-1', 'course-1');

    expect(prisma.courseCompletion.create).not.toHaveBeenCalled();
    expect(prisma.courseCompletion.updateMany).not.toHaveBeenCalled();
    expect(mail.sendCourseCompleted).not.toHaveBeenCalled();
  });

  it('does not double-send when a concurrent caller already claimed completion', async () => {
    // REGRESSION: A0 added a SECOND concurrent caller (the quiz-pass path), so
    // a learner's final section-complete and final quiz submission can race.
    // Read-then-write let both pass the guard and both email. The conditional
    // updateMany means only the racer whose write matched (count 1) proceeds.
    courseVersionService.countCompletionDenominator.mockResolvedValue(
      denominator(['s1'], []),
    );
    prisma.userCourseProgress.findMany.mockResolvedValue(allProgressed(['s1']));
    // Row exists with courseCompletedAt still null (the other racer has not
    // committed yet at read time)...
    prisma.courseCompletion.findUnique.mockResolvedValue({
      id: 'cc-1',
      courseCompletedAt: null,
    });
    // ...but by write time the other racer won, so nothing matches.
    prisma.courseCompletion.updateMany.mockResolvedValue({ count: 0 });

    await service.checkContentCompletion('user-1', 'course-1');

    expect(prisma.courseCompletion.updateMany).toHaveBeenCalled();
    expect(mail.sendCourseCompleted).not.toHaveBeenCalled();
    expect(
      feedbackService.notifyFeedbackRequiredIfNeeded,
    ).not.toHaveBeenCalled();
  });

  it('sends emails when it wins the conditional write', async () => {
    courseVersionService.countCompletionDenominator.mockResolvedValue(
      denominator(['s1'], []),
    );
    prisma.userCourseProgress.findMany.mockResolvedValue(allProgressed(['s1']));
    prisma.courseCompletion.findUnique.mockResolvedValue({
      id: 'cc-1',
      courseCompletedAt: null,
    });
    prisma.courseCompletion.updateMany.mockResolvedValue({ count: 1 });

    await service.checkContentCompletion('user-1', 'course-1');

    expect(mail.sendCourseCompleted).toHaveBeenCalled();
  });

  it('does not double-send when losing a create race on the unique key', async () => {
    // Neither racer sees a row; both attempt create. The (userId, courseId)
    // unique constraint rejects the loser, which must not email.
    courseVersionService.countCompletionDenominator.mockResolvedValue(
      denominator(['s1'], []),
    );
    prisma.userCourseProgress.findMany.mockResolvedValue(allProgressed(['s1']));
    prisma.courseCompletion.findUnique.mockResolvedValue(null);
    prisma.courseCompletion.create.mockRejectedValue(
      new Error(
        'Unique constraint failed on the fields: (`userId`,`courseId`)',
      ),
    );

    await service.checkContentCompletion('user-1', 'course-1');

    expect(mail.sendCourseCompleted).not.toHaveBeenCalled();
  });

  it('returns early when the course has no sections', async () => {
    courseVersionService.countCompletionDenominator.mockResolvedValue(
      denominator([], ['ch-1']),
    );

    await service.checkContentCompletion('user-1', 'course-1');

    expect(prisma.userCourseProgress.findMany).not.toHaveBeenCalled();
    expect(prisma.quizProgress.count).not.toHaveBeenCalled();
    expect(prisma.courseCompletion.create).not.toHaveBeenCalled();
    expect(prisma.courseCompletion.updateMany).not.toHaveBeenCalled();
  });

  it('preserves assessment fields — upsert touches only courseCompletedAt', async () => {
    courseVersionService.countCompletionDenominator.mockResolvedValue(
      denominator(['s1'], []),
    );
    prisma.userCourseProgress.findMany.mockResolvedValue(allProgressed(['s1']));

    await service.checkContentCompletion('user-1', 'course-1');

    const arg = prisma.courseCompletion.create.mock.calls[0][0];
    expect(Object.keys(arg.data).sort()).toEqual(
      ['courseCompletedAt', 'courseId', 'userId'].sort(),
    );
  });

  it('stamps but sends no email for a soft-deleted user', async () => {
    courseVersionService.countCompletionDenominator.mockResolvedValue(
      denominator(['s1'], []),
    );
    prisma.userCourseProgress.findMany.mockResolvedValue(allProgressed(['s1']));
    prisma.user.findUnique.mockResolvedValue({
      email: 'gone@example.com',
      firstName: 'Gone',
      deletedAt: new Date(),
    });

    await service.checkContentCompletion('user-1', 'course-1');

    expect(prisma.courseCompletion.create).toHaveBeenCalled();
    expect(mail.sendCourseCompleted).not.toHaveBeenCalled();
  });

  it('is best-effort: a quiz-count failure never throws into the caller', async () => {
    // The caller is a learner's progress write or quiz submission — completion
    // bookkeeping must not fail either.
    courseVersionService.countCompletionDenominator.mockResolvedValue(
      denominator(['s1'], ['ch-1']),
    );
    prisma.userCourseProgress.findMany.mockResolvedValue(allProgressed(['s1']));
    prisma.quizProgress.count.mockRejectedValue(new Error('db down'));

    await expect(
      service.checkContentCompletion('user-1', 'course-1'),
    ).resolves.toBeUndefined();
    expect(prisma.courseCompletion.create).not.toHaveBeenCalled();
    expect(prisma.courseCompletion.updateMany).not.toHaveBeenCalled();
  });

  it('sends the feedback request only when a form exists and none submitted', async () => {
    courseVersionService.countCompletionDenominator.mockResolvedValue(
      denominator(['s1'], []),
    );
    prisma.userCourseProgress.findMany.mockResolvedValue(allProgressed(['s1']));
    prisma.courseFeedbackForm.findFirst.mockResolvedValue({ id: 'form-1' });

    await service.checkContentCompletion('user-1', 'course-1');

    expect(mail.sendFeedbackRequest).toHaveBeenCalled();
  });
});
