import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, Role } from '@prisma/client';
import { CourseVersionService } from '../course-version/course-version.service';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { FeedbackService } from '../feedback/feedback.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScormCloudClient } from '../scorm-cloud/scorm-cloud.client';
import { COURSE_BOOKING_DOC_REF_V2 } from '../utils/advisor-review-metadata';
import { CourseService } from './course.service';

const COURSE_ID = 'course-1';
const COURSE_FORM_ID = 'cf-1';
const LEARNER_ID = 'user-1';
const FORM_ATTACHED_AT = new Date('2026-06-01T09:26:00.000Z');
const V2_METADATA = { bookingFormVersion: COURSE_BOOKING_DOC_REF_V2 };

describe('CourseService.markFormComplete', () => {
  let service: CourseService;
  let prisma: Record<string, any>;
  let notifications: { createNotificationForMany: jest.Mock };

  beforeEach(async () => {
    prisma = {
      courseForm: {
        findUnique: jest.fn().mockResolvedValue({
          id: COURSE_FORM_ID,
          courseId: COURSE_ID,
          formId: 'registration-form',
          createdAt: FORM_ATTACHED_AT,
          requiredSince: FORM_ATTACHED_AT,
          detachedAt: null,
          detachedWindows: null,
        }),
      },
      userCourse: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'uc-1',
          userId: LEARNER_ID,
          courseId: COURSE_ID,
          isActive: true,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        }),
      },
      courseCompletion: { findUnique: jest.fn().mockResolvedValue(null) },
      course: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ title: 'NEBOSH IGC', validityDays: 365 }),
      },
      userFormCompletion: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'ufc-1',
          courseFormId: COURSE_FORM_ID,
          formId: 'registration-form',
          completedAt: new Date(),
          metadata: V2_METADATA,
        }),
        updateMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: LEARNER_ID,
          email: 'jane@example.com',
          firstName: 'Jane',
          lastName: 'Doe',
        }),
        findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }]),
      },
    };
    notifications = {
      createNotificationForMany: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: MailService,
          useValue: {
            sendRegistrationReceived: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: FeedbackService,
          useValue: { notifyFeedbackRequiredIfNeeded: jest.fn() },
        },
        { provide: CourseVersionService, useValue: {} },
        {
          provide: CourseCompletionService,
          useValue: { checkContentCompletion: jest.fn() },
        },
        { provide: NotificationService, useValue: notifications },
        {
          provide: ScormCloudClient,
          useValue: { deleteRegistration: jest.fn(), deleteCourse: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(CourseService);
  });

  const submit = (role: Role = Role.user) =>
    service.markFormComplete(
      LEARNER_ID,
      role,
      COURSE_ID,
      'registration-form',
      V2_METADATA,
      COURSE_FORM_ID,
    );

  it('records the submission and notifies the admins once', async () => {
    await submit();

    expect(prisma.userFormCompletion.create).toHaveBeenCalledTimes(1);
    expect(notifications.createNotificationForMany).toHaveBeenCalledTimes(1);
  });

  it('resolves a stale course form id from an old link by course and form', async () => {
    const current = await prisma.courseForm.findUnique();
    prisma.courseForm.findUnique.mockReset();
    prisma.courseForm.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...current, id: 'cf-current' });

    await service.markFormComplete(
      LEARNER_ID,
      Role.user,
      COURSE_ID,
      'registration-form',
      V2_METADATA,
      'cf-from-an-old-email',
    );

    expect(prisma.courseForm.findUnique.mock.calls[1][0]).toEqual({
      where: {
        courseId_formId: { courseId: COURSE_ID, formId: 'registration-form' },
      },
    });
    expect(prisma.userFormCompletion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ courseFormId: 'cf-current' }),
      }),
    );
  });

  it('rejects a form the course has never had', async () => {
    prisma.courseForm.findUnique.mockResolvedValue(null);

    await expect(submit()).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userFormCompletion.create).not.toHaveBeenCalled();
  });

  it('accepts a form that only became required after the learner enrolled', async () => {
    prisma.courseForm.findUnique.mockResolvedValue({
      id: COURSE_FORM_ID,
      courseId: COURSE_ID,
      formId: 'registration-form',
      createdAt: FORM_ATTACHED_AT,
      // Optional when they enrolled, required since: not required of them,
      // but still part of their course.
      requiredSince: new Date('2026-10-17T07:21:50.052Z'),
      detachedAt: null,
      detachedWindows: null,
    });

    await submit();

    expect(prisma.userFormCompletion.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a form attached after the learner enrolled', async () => {
    prisma.courseForm.findUnique.mockResolvedValue({
      id: COURSE_FORM_ID,
      courseId: COURSE_ID,
      formId: 'registration-form',
      createdAt: new Date('2026-10-17T07:21:50.052Z'),
      requiredSince: new Date('2026-10-17T07:21:50.052Z'),
      detachedAt: null,
      detachedWindows: null,
    });

    await expect(submit()).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userFormCompletion.create).not.toHaveBeenCalled();
    expect(notifications.createNotificationForMany).not.toHaveBeenCalled();
  });

  it('rejects a form the learner enrolled while it was removed from the course', async () => {
    prisma.courseForm.findUnique.mockResolvedValue({
      id: COURSE_FORM_ID,
      courseId: COURSE_ID,
      formId: 'registration-form',
      createdAt: FORM_ATTACHED_AT,
      requiredSince: FORM_ATTACHED_AT,
      detachedAt: null,
      detachedWindows: [
        { from: '2026-06-15T00:00:00.000Z', until: '2026-07-15T00:00:00.000Z' },
      ],
    });

    await expect(submit()).rejects.toBeInstanceOf(BadRequestException);
    expect(notifications.createNotificationForMany).not.toHaveBeenCalled();
  });

  it('rejects a form that was removed from the course', async () => {
    prisma.courseForm.findUnique.mockResolvedValue({
      id: COURSE_FORM_ID,
      courseId: COURSE_ID,
      formId: 'registration-form',
      createdAt: FORM_ATTACHED_AT,
      requiredSince: FORM_ATTACHED_AT,
      detachedAt: new Date(),
      detachedWindows: null,
    });

    await expect(submit()).rejects.toBeInstanceOf(BadRequestException);
    expect(notifications.createNotificationForMany).not.toHaveBeenCalled();
  });

  it('does not notify again when a concurrent submit already created the row', async () => {
    prisma.userFormCompletion.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    prisma.userFormCompletion.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'ufc-1',
        courseFormId: COURSE_FORM_ID,
        formId: 'registration-form',
        isComplete: true,
        completedAt: new Date(),
        metadata: V2_METADATA,
      });

    const result = await submit();

    expect(result).toMatchObject({ alreadyCompleted: true, id: 'ufc-1' });
    expect(notifications.createNotificationForMany).not.toHaveBeenCalled();
  });

  it('does not notify again when another call already completed an existing row', async () => {
    prisma.userFormCompletion.findUnique.mockResolvedValue({
      id: 'ufc-1',
      courseFormId: COURSE_FORM_ID,
      formId: 'registration-form',
      isComplete: false,
      completedAt: null,
      metadata: null,
    });
    prisma.userFormCompletion.updateMany.mockResolvedValue({ count: 0 });

    const result = await submit();

    expect(result).toMatchObject({ alreadyCompleted: true });
    expect(notifications.createNotificationForMany).not.toHaveBeenCalled();
  });
});
