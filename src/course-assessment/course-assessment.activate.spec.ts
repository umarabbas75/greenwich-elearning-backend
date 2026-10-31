import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { CourseVersionService } from '../course-version/course-version.service';
import { CertificateService } from '../certificate/certificate.service';
import { CourseAssessmentService } from './course-assessment.service';

/**
 * A course has one active assessment. Activating one replaces whichever was
 * live, so learners can no longer complete the course by passing the easier of
 * two active assessments.
 */
describe('CourseAssessmentService — one active assessment per course', () => {
  let service: CourseAssessmentService;
  let prisma: Record<string, any>;
  let writeAudit: jest.Mock;

  const draft = {
    id: 'a-new',
    courseId: 'course-1',
    title: 'New exam',
    mode: 'MANUAL',
    isActive: false,
    autoConfig: null,
    assessmentQuestions: [{ id: 'aq-1' }],
    course: { deliveryMode: 'NATIVE' },
  };

  beforeEach(async () => {
    prisma = {
      assessment: {
        findUnique: jest.fn().mockResolvedValue(draft),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockReturnValue('updateMany-op'),
        update: jest.fn().mockReturnValue('update-op'),
      },
      $transaction: jest.fn(),
    };
    writeAudit = jest.fn();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CourseAssessmentService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: {} },
        { provide: CourseVersionService, useValue: { writeAudit } },
        { provide: CertificateService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(CourseAssessmentService);
  });

  it('deactivates the other active assessment in the same batch', async () => {
    prisma.assessment.findMany.mockResolvedValue([
      { id: 'a-old', title: 'Old exam' },
    ]);
    prisma.$transaction.mockResolvedValue([
      { count: 1 },
      { ...draft, isActive: true },
    ]);

    const res = await service.activateAssessment('a-new', 'admin-1');

    const othersActive = {
      courseId: 'course-1',
      isActive: true,
      id: { not: 'a-new' },
    };
    expect(prisma.assessment.updateMany).toHaveBeenCalledWith({
      where: othersActive,
      data: { isActive: false },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith([
      'updateMany-op',
      'update-op',
    ]);
    expect(res!.data.replaced).toEqual([{ id: 'a-old', title: 'Old exam' }]);
    expect(res!.message).toContain('"Old exam" is no longer active');
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DEACTIVATE_ASSESSMENT',
        targetId: 'a-old',
        metadata: { title: 'Old exam', replacedBy: 'a-new' },
      }),
    );
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ACTIVATE_ASSESSMENT',
        targetId: 'a-new',
      }),
    );
  });

  it('activates normally when nothing else is live', async () => {
    prisma.$transaction.mockResolvedValue([
      { count: 0 },
      { ...draft, isActive: true },
    ]);

    const res = await service.activateAssessment('a-new', 'admin-1');

    expect(res!.message).toBe('Assessment activated successfully');
    expect(res!.data.replaced).toEqual([]);
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when a concurrent activation wins the unique index', async () => {
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const err = await service
      .activateAssessment('a-new', 'admin-1')
      .catch((e) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
  });
});
