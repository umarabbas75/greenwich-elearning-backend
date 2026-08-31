import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CourseDeliveryMode } from '@prisma/client';
import { CourseVersionService } from '../course-version/course-version.service';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { FeedbackService } from '../feedback/feedback.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { CourseService } from './course.service';
import { IMPORTED_SCORM_TREE_LOCKED_MESSAGE } from '../utils/assert-imported-course-tree-locked';

describe('CourseService — imported SCORM guards', () => {
  let service: CourseService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      course: {
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      module: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      chapter: { findUnique: jest.fn() },
      section: { findUnique: jest.fn(), findMany: jest.fn() },
      scormPackage: { findFirst: jest.fn() },
      userCourse: { findFirst: jest.fn(), delete: jest.fn() },
      userCourseProgress: { count: jest.fn().mockResolvedValue(0) },
      userChapterCompletion: { count: jest.fn().mockResolvedValue(0) },
      userModuleCompletion: { count: jest.fn().mockResolvedValue(0) },
      courseCompletion: { findUnique: jest.fn().mockResolvedValue(null) },
      sectionTimeSpent: { count: jest.fn().mockResolvedValue(0) },
      lastSeenSection: { count: jest.fn().mockResolvedValue(0) },
      quizProgress: { count: jest.fn().mockResolvedValue(0) },
      quizAnswer: { count: jest.fn().mockResolvedValue(0) },
      userFormCompletion: { count: jest.fn().mockResolvedValue(0) },
      userPolicyCompletion: { count: jest.fn().mockResolvedValue(0) },
      userPolicyItemCompletion: { count: jest.fn().mockResolvedValue(0) },
      courseFeedbackSubmission: { count: jest.fn().mockResolvedValue(0) },
      assessmentAttempt: { count: jest.fn().mockResolvedValue(0) },
      assessment: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (ops: any) => {
        if (typeof ops === 'function') return ops(prisma);
        return Promise.all(ops);
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: MailService, useValue: { send: jest.fn() } },
        {
          provide: FeedbackService,
          useValue: { notifyFeedbackRequiredIfNeeded: jest.fn() },
        },
        {
          provide: CourseVersionService,
          useValue: {
            autoPublishAfterStructuralChange: jest.fn(),
            getReferencingVersionsWithEnrollments: jest.fn(),
            writeAudit: jest.fn(),
          },
        },
        {
          provide: CourseCompletionService,
          useValue: { checkContentCompletion: jest.fn() },
        },
        {
          provide: NotificationService,
          useValue: {
            createNotification: jest.fn(),
            createNotificationForMany: jest.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(CourseService);
  });

  it('setCourseActive refuses isActive true on IMPORTED_SCORM with no live SCORM section', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      deliveryMode: CourseDeliveryMode.IMPORTED_SCORM,
    });
    prisma.section.findMany.mockResolvedValue([]);

    await expect(service.setCourseActive('course-1', true)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it('createModule is rejected on IMPORTED_SCORM', async () => {
    prisma.course.findUnique.mockResolvedValue({
      deliveryMode: CourseDeliveryMode.IMPORTED_SCORM,
    });

    await expect(
      service.createModule({ id: 'course-1', title: 'X', description: '' } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: IMPORTED_SCORM_TREE_LOCKED_MESSAGE,
      }),
    });
    expect(prisma.module.create).not.toHaveBeenCalled();
  });

  it('unassign is refused on IMPORTED_SCORM without wiping state', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      deliveryMode: CourseDeliveryMode.IMPORTED_SCORM,
    });

    await expect(
      service.unAssignCourse('user-1', 'course-1'),
    ).rejects.toMatchObject({
      response: { status: 409 },
    });
    expect(prisma.userCourse.delete).not.toHaveBeenCalled();
  });

  it('reset progress is refused on IMPORTED_SCORM', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ role: 'admin' })
      .mockResolvedValueOnce({ id: 'user-1', deletedAt: null });
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      deliveryMode: CourseDeliveryMode.IMPORTED_SCORM,
    });

    await expect(
      service.resetUserCourseProgress('admin-1', 'user-1', 'course-1'),
    ).rejects.toMatchObject({
      response: { status: 409 },
    });
  });
});
