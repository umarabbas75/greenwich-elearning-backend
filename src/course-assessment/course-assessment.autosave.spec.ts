import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { CourseVersionService } from '../course-version/course-version.service';
import { CertificateService } from '../certificate/certificate.service';
import { CourseAssessmentService } from './course-assessment.service';

/**
 * Answers are saved as the learner works (PATCH .../answers), submit grades
 * the saved answers plus anything still unsaved, and an attempt whose time
 * runs out is graded on what was saved rather than thrown away.
 */
describe('CourseAssessmentService — autosave, submit and expiry', () => {
  let service: CourseAssessmentService;
  let prisma: Record<string, any>;
  let notifications: { createNotification: jest.Mock };
  let certificates: { tryIssueCertificate: jest.Mock };

  const MIN = 60_000;

  const snapshot = (id: string, studentAnswer: unknown = null) => ({
    id,
    questionType: 'TRUE_FALSE',
    questionContent: { correctAnswer: true },
    maxMarks: 1,
    studentAnswer,
  });

  const attempt = (overrides: Record<string, unknown> = {}) => ({
    id: 'att-1',
    userId: 'user-1',
    assessmentId: 'asm-1',
    status: 'IN_PROGRESS',
    startedAt: new Date(Date.now() - 5 * MIN),
    snapshotTimeLimitMin: 30,
    snapshotPassingPct: 50,
    snapshotTitle: 'Final exam',
    totalMarks: 2,
    questionSnapshots: [snapshot('s1'), snapshot('s2')],
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      assessmentAttempt: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      attemptQuestionSnapshot: {
        updateMany: jest.fn((args) => ({ op: 'updateMany', args })),
        update: jest.fn((args) => ({ op: 'update', args })),
      },
      assessment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'asm-1',
          title: 'Final exam',
          courseId: 'course-1',
          createdByAdminId: 'admin-1',
        }),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ firstName: 'Sam', lastName: 'Lee' }),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    notifications = { createNotification: jest.fn() };
    certificates = { tryIssueCertificate: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CourseAssessmentService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notifications },
        { provide: CourseVersionService, useValue: {} },
        { provide: CertificateService, useValue: certificates },
      ],
    }).compile();

    service = moduleRef.get(CourseAssessmentService);
    jest
      .spyOn(service as any, '_upsertCourseCompletion')
      .mockResolvedValue(undefined);
  });

  describe('saveAnswers', () => {
    it('writes only while the attempt is still in progress', async () => {
      prisma.assessmentAttempt.findUnique.mockResolvedValue(attempt());

      await service.saveAnswers('user-1', 'att-1', {
        answers: [{ snapshotId: 's1', studentAnswer: { answer: true } }],
      });

      expect(prisma.attemptQuestionSnapshot.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', attempt: { status: 'IN_PROGRESS' } },
        data: { studentAnswer: { answer: true }, isAnswered: true },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("rejects a snapshot from someone else's attempt", async () => {
      prisma.assessmentAttempt.findUnique.mockResolvedValue(attempt());

      await expect(
        service.saveAnswers('user-1', 'att-1', {
          answers: [{ snapshotId: 'other', studentAnswer: { answer: true } }],
        }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects once the time limit and grace have passed', async () => {
      prisma.assessmentAttempt.findUnique.mockResolvedValue(
        attempt({ startedAt: new Date(Date.now() - 40 * MIN) }),
      );

      await expect(
        service.saveAnswers('user-1', 'att-1', {
          answers: [{ snapshotId: 's1', studentAnswer: { answer: true } }],
        }),
      ).rejects.toThrow(HttpException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('submitAttempt', () => {
    it('grades saved answers together with the ones sent on submit', async () => {
      prisma.assessmentAttempt.findUnique
        .mockResolvedValueOnce({ userId: 'user-1', assessmentId: 'asm-1' })
        .mockResolvedValueOnce(
          attempt({
            questionSnapshots: [
              snapshot('s1', { answer: true }), // saved earlier, correct
              snapshot('s2'),
            ],
          }),
        );
      prisma.assessmentAttempt.findUniqueOrThrow.mockResolvedValue({
        id: 'att-1',
        assessmentId: 'asm-1',
        status: 'AUTO_GRADED',
        isPassed: true,
        percentage: 100,
        snapshotTitle: 'Final exam',
      });

      const res = await service.submitAttempt('user-1', 'att-1', {
        answers: [{ snapshotId: 's2', studentAnswer: { answer: true } }],
      });

      expect(prisma.assessmentAttempt.updateMany).toHaveBeenCalledWith({
        where: { id: 'att-1', status: 'IN_PROGRESS' },
        data: expect.objectContaining({
          status: 'AUTO_GRADED',
          marksObtained: 2,
          percentage: 100,
          isPassed: true,
        }),
      });
      expect(res!.message).toBe('Assessment submitted successfully');
      expect(certificates.tryIssueCertificate).toHaveBeenCalledWith(
        'user-1',
        'course-1',
      );
      expect(notifications.createNotification).toHaveBeenCalledTimes(1);
    });

    it('does nothing twice when a second submit loses the race', async () => {
      prisma.assessmentAttempt.findUnique
        .mockResolvedValueOnce({ userId: 'user-1', assessmentId: 'asm-1' })
        .mockResolvedValueOnce(
          attempt({ questionSnapshots: [snapshot('s1', { answer: true })] }),
        )
        .mockResolvedValueOnce({ id: 'att-1', status: 'AUTO_GRADED' });
      prisma.assessmentAttempt.updateMany.mockResolvedValue({ count: 0 });

      const res = await service.submitAttempt('user-1', 'att-1', {});

      expect(res!.message).toBe('This attempt has already been submitted');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('returns the result for an attempt that is already submitted', async () => {
      prisma.assessmentAttempt.findUnique
        .mockResolvedValueOnce({ userId: 'user-1', assessmentId: 'asm-1' })
        .mockResolvedValueOnce(attempt({ status: 'AUTO_GRADED' }))
        .mockResolvedValueOnce({ id: 'att-1', status: 'AUTO_GRADED' });

      const res = await service.submitAttempt('user-1', 'att-1', {});

      expect(res!.statusCode).toBe(200);
      expect(res!.data).toEqual({ id: 'att-1', status: 'AUTO_GRADED' });
    });

    it('refuses to submit with nothing answered', async () => {
      prisma.assessmentAttempt.findUnique
        .mockResolvedValueOnce({ userId: 'user-1', assessmentId: 'asm-1' })
        .mockResolvedValueOnce(attempt());

      await expect(
        service.submitAttempt('user-1', 'att-1', {}),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.assessmentAttempt.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('time running out', () => {
    const startedAt = new Date(Date.now() - 40 * MIN);

    beforeEach(() => {
      prisma.assessmentAttempt.findMany.mockResolvedValue([
        { id: 'att-1', startedAt, snapshotTimeLimitMin: 30 },
      ]);
    });

    it('grades the saved answers as of the deadline', async () => {
      prisma.assessmentAttempt.findUnique.mockResolvedValue(
        attempt({
          startedAt,
          questionSnapshots: [snapshot('s1', { answer: true }), snapshot('s2')],
        }),
      );
      prisma.assessmentAttempt.findUniqueOrThrow.mockResolvedValue({
        id: 'att-1',
        assessmentId: 'asm-1',
        status: 'AUTO_GRADED',
        isPassed: true,
        percentage: 50,
        snapshotTitle: 'Final exam',
      });

      await (service as any)._expireStaleAttempts('user-1', 'asm-1');

      expect(prisma.assessmentAttempt.updateMany).toHaveBeenCalledWith({
        where: { id: 'att-1', status: 'IN_PROGRESS' },
        data: expect.objectContaining({
          status: 'AUTO_GRADED',
          submittedAt: new Date(startedAt.getTime() + 30 * MIN),
          marksObtained: 1,
          percentage: 50,
          isPassed: true,
        }),
      });
    });

    it('marks the attempt EXPIRED when nothing was saved', async () => {
      prisma.assessmentAttempt.findUnique.mockResolvedValue(
        attempt({ startedAt }),
      );

      await (service as any)._expireStaleAttempts('user-1', 'asm-1');

      expect(prisma.assessmentAttempt.updateMany).toHaveBeenCalledWith({
        where: { id: 'att-1', status: 'IN_PROGRESS' },
        data: { status: 'EXPIRED' },
      });
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });
  });
});
