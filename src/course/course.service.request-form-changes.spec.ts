import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { CourseVersionService } from '../course-version/course-version.service';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { FeedbackService } from '../feedback/feedback.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScormCloudClient } from '../scorm-cloud/scorm-cloud.client';
import { COURSE_BOOKING_DOC_REF_V2 } from '../utils/advisor-review-metadata';
import { CourseService } from './course.service';

const COURSE_FORM_ID = 'cf-1';
const COURSE_ID = 'course-1';
const LEARNER_ID = 'user-1';
const COMPLETED_AT = new Date('2026-10-28T10:43:58.410Z');
const UPDATED_AT = new Date('2026-10-28T12:17:44.324Z');
const FORM_ATTACHED_AT = new Date('2026-06-01T09:26:00.000Z');

const REVIEWED_PENDING = {
  fullName: 'Muhammad Idrees',
  userPhoto: 'https://res.cloudinary.com/x/generic.jpg',
  bookingFormVersion: COURSE_BOOKING_DOC_REF_V2,
  advisor: {
    identityDocsVerified: 'no',
    registrationStatus: 'Pending',
    comments: 'Use your original passport size photograph.',
  },
  advisorSignature: 'Muhammad Waqas',
  advisorDate: '2026-10-28',
};

describe('CourseService.requestFormChanges', () => {
  let service: CourseService;
  let prisma: Record<string, any>;
  let notifications: { createNotification: jest.Mock };

  function storedRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ufc-1',
      userId: LEARNER_ID,
      courseId: COURSE_ID,
      formId: 'registration-form',
      courseFormId: COURSE_FORM_ID,
      isComplete: true,
      completedAt: COMPLETED_AT,
      updatedAt: UPDATED_AT,
      metadata: REVIEWED_PENDING,
      ...overrides,
    };
  }

  /** First read is the lookup; the second is the row re-read after the write. */
  function mockStored(row: Record<string, unknown> = storedRow()) {
    prisma.userFormCompletion.findUnique
      .mockResolvedValueOnce(row)
      .mockImplementationOnce(async () => ({
        ...row,
        ...prisma.userFormCompletion.updateMany.mock.calls[0][0].data,
      }));
  }

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
          isActive: true,
          createdAt: new Date('2026-10-28T08:16:34Z'),
        }),
      },
      courseCompletion: { findUnique: jest.fn().mockResolvedValue(null) },
      userFormCompletion: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest
          .fn()
          .mockImplementation(async ({ where }) =>
            where.id === LEARNER_ID
              ? { id: LEARNER_ID, firstName: 'Muhammad' }
              : { firstName: 'Muhammad', lastName: 'Waqas' },
          ),
      },
      course: {
        findUnique: jest.fn().mockResolvedValue({ title: 'NEBOSH IGC' }),
      },
    };
    notifications = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: MailService, useValue: {} },
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

  const sendBack = (overrides: Record<string, unknown> = {}) =>
    service.requestFormChanges({
      adminId: 'admin-1',
      adminRole: Role.admin,
      learnerUserId: LEARNER_ID,
      courseId: COURSE_ID,
      formId: 'registration-form',
      courseFormId: COURSE_FORM_ID,
      comments: 'Upload your original passport-size photograph.',
      ...overrides,
    });

  it('reopens a submitted form for the learner, keeping their answers', async () => {
    mockStored();

    const result = await sendBack({
      submissionCompletedAt: COMPLETED_AT.toISOString(),
    });

    const call = prisma.userFormCompletion.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'ufc-1', updatedAt: UPDATED_AT });
    expect(call.data.isComplete).toBe(false);
    expect(call.data.completedAt).toBeNull();
    expect(call.data.metadata).toMatchObject({
      fullName: 'Muhammad Idrees',
      userPhoto: REVIEWED_PENDING.userPhoto,
      advisor: {
        identityDocsVerified: 'no',
        registrationStatus: 'Pending',
        comments: 'Upload your original passport-size photograph.',
      },
      changesRequested: {
        requestedById: 'admin-1',
        requestedByName: 'Muhammad Waqas',
        comments: 'Upload your original passport-size photograph.',
        previousCompletedAt: COMPLETED_AT.toISOString(),
        previousStatus: 'Pending',
      },
    });
    expect(call.data.metadata.reviewHistory).toEqual([
      expect.objectContaining({
        action: 'CHANGES_REQUESTED',
        statusBefore: 'Pending',
        review: {
          advisor: REVIEWED_PENDING.advisor,
          advisorSignature: 'Muhammad Waqas',
          advisorDate: '2026-10-28',
        },
      }),
    ]);
    expect(result.form.isComplete).toBe(false);
  });

  it('tells the learner what to change, with a link they can submit from', async () => {
    mockStored();

    await sendBack();

    expect(notifications.createNotification).toHaveBeenCalledTimes(1);
    const input = notifications.createNotification.mock.calls[0][0];
    expect(input.userId).toBe(LEARNER_ID);
    expect(input.dedupeKey).toMatch(/^registration-changes-requested:/);
    expect(input.payload).toMatchObject({
      changesRequested: true,
      courseFormId: COURSE_FORM_ID,
      comments: 'Upload your original passport-size photograph.',
    });
    expect(input.email.build({ id: LEARNER_ID, email: 'x@y.z' })).toMatchObject(
      {
        kind: 'REGISTRATION_REVIEWED',
        changesRequested: true,
        courseFormId: COURSE_FORM_ID,
      },
    );
  });

  it('updates the request when sent back again, keeping the original submission time and status', async () => {
    mockStored();
    await sendBack();
    const first = prisma.userFormCompletion.updateMany.mock.calls[0][0].data;

    prisma.userFormCompletion.updateMany.mockClear();
    mockStored(
      storedRow({
        isComplete: false,
        completedAt: null,
        metadata: first.metadata,
      }),
    );
    await sendBack({ comments: 'Also attach your ID card.' });

    const second = prisma.userFormCompletion.updateMany.mock.calls[0][0].data;
    expect(second.metadata.changesRequested).toMatchObject({
      comments: 'Also attach your ID card.',
      previousCompletedAt: COMPLETED_AT.toISOString(),
      previousStatus: 'Pending',
    });
    expect(second.metadata.reviewHistory).toHaveLength(2);
  });

  it('rejects non-admin callers', async () => {
    await expect(sendBack({ adminRole: Role.user })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.userFormCompletion.updateMany).not.toHaveBeenCalled();
  });

  it('requires a note for the learner', async () => {
    await expect(sendBack({ comments: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('only handles the registration form', async () => {
    await expect(
      sendBack({ formId: 'learner-agreement' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a form the learner has not submitted yet', async () => {
    mockStored(storedRow({ isComplete: false, completedAt: null }));

    await expect(sendBack()).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userFormCompletion.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a legacy submission', async () => {
    mockStored(storedRow({ metadata: { fullName: 'Legacy' } }));

    await expect(sendBack()).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses when the learner could not resubmit because the form left the course', async () => {
    mockStored();
    prisma.courseForm.findUnique.mockResolvedValue({
      id: COURSE_FORM_ID,
      createdAt: FORM_ATTACHED_AT,
      detachedAt: new Date(),
      detachedWindows: null,
    });

    await expect(sendBack()).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userFormCompletion.updateMany).not.toHaveBeenCalled();
  });

  it('refuses when the learner is not enrolled or their enrolment is inactive', async () => {
    mockStored();
    prisma.userCourse.findFirst.mockResolvedValue(null);

    await expect(sendBack()).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userCourse.findFirst).toHaveBeenCalledWith({
      where: { userId: LEARNER_ID, courseId: COURSE_ID, isActive: true },
    });
    expect(prisma.userFormCompletion.updateMany).not.toHaveBeenCalled();
  });

  it('refuses when the learner can no longer use the course after completing it', async () => {
    mockStored();
    prisma.courseCompletion.findUnique.mockResolvedValue({
      courseCompletedAt: new Date('2024-01-01T00:00:00.000Z'),
      validityDaysAtCompletion: 365,
    });

    await expect(sendBack()).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userFormCompletion.updateMany).not.toHaveBeenCalled();
  });

  it('refuses when the submission changed since the advisor opened it', async () => {
    mockStored();

    await expect(
      sendBack({ submissionCompletedAt: '2026-10-31T09:00:00.000Z' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.userFormCompletion.updateMany).not.toHaveBeenCalled();
  });

  it('refuses when the row changed between reading and writing', async () => {
    mockStored();
    prisma.userFormCompletion.updateMany.mockResolvedValue({ count: 0 });

    await expect(sendBack()).rejects.toBeInstanceOf(ConflictException);
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });
});
