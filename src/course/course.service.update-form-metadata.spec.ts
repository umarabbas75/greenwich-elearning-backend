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
const COMPLETED_AT = new Date('2026-08-05T12:00:00.000Z');

function advisorMeta(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Aatzaz Khaliq',
    bookingFormVersion: COURSE_BOOKING_DOC_REF_V2,
    advisor: {
      learnerEligibilityConfirmed: 'yes',
      identityDocsVerified: 'yes',
      entryRequirementsMet: 'yes',
      englishRequirementMet: 'yes',
      needsAssessmentCompleted: 'yes',
      reasonableAdjustmentsRequired: 'no',
      specialConsiderationRequired: 'no',
      registrationStatus: 'Approved',
      comments: 'Looks good',
    },
    advisorSignature: 'Muhammad Waqas',
    advisorDate: '2026-08-16',
    ...overrides,
  };
}

describe('CourseService.updateFormMetadata', () => {
  let service: CourseService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      courseForm: { findUnique: jest.fn() },
      userFormCompletion: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: LEARNER_ID,
          firstName: 'Aatzaz',
        }),
      },
      course: {
        findUnique: jest.fn().mockResolvedValue({ title: 'NEBOSH HSW' }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: MailService, useValue: { send: jest.fn() } },
        {
          provide: FeedbackService,
          useValue: { notifyFeedbackRequiredIfNeeded: jest.fn() },
        },
        { provide: CourseVersionService, useValue: {} },
        {
          provide: CourseCompletionService,
          useValue: { checkContentCompletion: jest.fn() },
        },
        {
          provide: NotificationService,
          useValue: {
            createNotification: jest.fn().mockResolvedValue(undefined),
            createNotificationForMany: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ScormCloudClient,
          useValue: {
            deleteRegistration: jest.fn().mockResolvedValue(undefined),
            deleteCourse: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(CourseService);
  });

  const UPDATED_AT = new Date('2026-08-16T09:00:00.000Z');
  const LEARNER_ANSWERS = {
    fullName: 'Aatzaz Khaliq',
    bookingFormVersion: COURSE_BOOKING_DOC_REF_V2,
  };

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
      metadata: LEARNER_ANSWERS,
      ...overrides,
    };
  }

  /** First read is the lookup; the second is the row re-read after the write. */
  function mockExistingCompletion(
    existing: Record<string, unknown> = storedRow(),
    afterWrite?: Record<string, unknown>,
  ) {
    prisma.courseForm.findUnique.mockResolvedValue({
      id: COURSE_FORM_ID,
      courseId: COURSE_ID,
      formId: 'registration-form',
    });
    prisma.userFormCompletion.findUnique
      .mockResolvedValueOnce(existing)
      .mockImplementationOnce(async () => {
        const data =
          prisma.userFormCompletion.updateMany.mock.calls[0]?.[0]?.data;
        return afterWrite ?? { ...existing, ...data };
      });
  }

  const review = (
    meta: Record<string, unknown> = advisorMeta(),
    submissionCompletedAt?: string | null,
  ) =>
    service.updateFormMetadata(
      'admin-1',
      Role.admin,
      LEARNER_ID,
      COURSE_ID,
      'registration-form',
      COURSE_FORM_ID,
      meta,
      submissionCompletedAt,
    );

  it('rejects non-admin callers', async () => {
    await expect(
      service.updateFormMetadata(
        'user-admin',
        Role.user,
        LEARNER_ID,
        COURSE_ID,
        'registration-form',
        COURSE_FORM_ID,
        advisorMeta(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.userFormCompletion.updateMany).not.toHaveBeenCalled();
  });

  it('writes the advisor review onto the stored submission and returns it', async () => {
    mockExistingCompletion();
    const meta = advisorMeta();

    const result = await review(meta);

    expect(prisma.userFormCompletion.updateMany).toHaveBeenCalledWith({
      where: { id: 'ufc-1', updatedAt: UPDATED_AT },
      data: {
        metadata: {
          ...LEARNER_ANSWERS,
          advisor: meta.advisor,
          advisorSignature: meta.advisorSignature,
          advisorDate: meta.advisorDate,
        },
      },
    });
    expect(result.success).toBe(true);
    expect(result.form.isComplete).toBe(true);
    expect(result.form.completedAt).toBe(COMPLETED_AT);
    expect(result.form.metadata).toMatchObject({ advisor: meta.advisor });
  });

  it('keeps the learner answers as stored, whatever the review tab sent', async () => {
    mockExistingCompletion();

    await review(advisorMeta({ fullName: 'Stale copy from an old tab' }));

    const { data } = prisma.userFormCompletion.updateMany.mock.calls[0][0];
    expect(data.metadata.fullName).toBe('Aatzaz Khaliq');
  });

  it('reviews the submission when the link carries a course form id replaced by a later save', async () => {
    mockExistingCompletion();
    prisma.courseForm.findUnique.mockResolvedValue(null);

    const result = await service.updateFormMetadata(
      'admin-1',
      Role.admin,
      LEARNER_ID,
      COURSE_ID,
      'registration-form',
      'cf-deleted-on-17-oct',
      advisorMeta(),
    );

    expect(prisma.userFormCompletion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ufc-1', updatedAt: UPDATED_AT },
      }),
    );
    expect(result.form.courseFormId).toBe(COURSE_FORM_ID);
  });

  it('refuses a review of a submission the learner changed since it was opened', async () => {
    mockExistingCompletion();

    await expect(
      review(advisorMeta(), '2026-08-01T00:00:00.000Z'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.userFormCompletion.updateMany).not.toHaveBeenCalled();
  });

  it('accepts a review of the submission that was opened', async () => {
    mockExistingCompletion();

    await review(advisorMeta(), COMPLETED_AT.toISOString());

    expect(prisma.userFormCompletion.updateMany).toHaveBeenCalledTimes(1);
  });

  it('refuses when the row changed between reading and writing', async () => {
    mockExistingCompletion();
    prisma.userFormCompletion.updateMany.mockResolvedValue({ count: 0 });

    await expect(review()).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to review a legacy submission', async () => {
    mockExistingCompletion(storedRow({ metadata: { fullName: 'Old form' } }));

    await expect(review()).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userFormCompletion.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to leave a sent-back form Pending, which would lock it with nothing to do', async () => {
    mockExistingCompletion(
      storedRow({
        isComplete: false,
        completedAt: null,
        metadata: {
          ...LEARNER_ANSWERS,
          changesRequested: {
            requestedAt: '2026-08-10T10:00:00.000Z',
            comments: 'New photo please',
          },
        },
      }),
    );

    await expect(
      review(
        advisorMeta({
          advisor: { ...advisorMeta().advisor, registrationStatus: 'Pending' },
        }),
        null,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userFormCompletion.updateMany).not.toHaveBeenCalled();
  });

  it('withdraws a change request when the advisor decides, restoring the original submission', async () => {
    const sentBack = storedRow({
      isComplete: false,
      completedAt: null,
      metadata: {
        ...LEARNER_ANSWERS,
        advisor: {
          registrationStatus: 'Pending',
          comments: 'New photo please',
        },
        changesRequested: {
          requestedAt: '2026-08-10T10:00:00.000Z',
          requestedById: 'admin-1',
          requestedByName: 'Muhammad Waqas',
          comments: 'New photo please',
          previousCompletedAt: COMPLETED_AT.toISOString(),
          previousStatus: 'Pending',
        },
        reviewHistory: [
          { action: 'CHANGES_REQUESTED', at: '2026-08-10T10:00:00.000Z' },
        ],
      },
    });
    mockExistingCompletion(sentBack);

    const result = await review(advisorMeta(), null);

    const { data } = prisma.userFormCompletion.updateMany.mock.calls[0][0];
    expect(data.isComplete).toBe(true);
    expect(data.completedAt).toEqual(COMPLETED_AT);
    expect(data.metadata.changesRequested).toBeUndefined();
    expect(data.metadata.advisor.registrationStatus).toBe('Approved');
    expect(data.metadata.reviewHistory.map((e: any) => e.action)).toEqual([
      'CHANGES_REQUESTED',
      'REQUEST_WITHDRAWN',
    ]);
    expect(result.form.isComplete).toBe(true);
  });

  it('rejects when no submission exists', async () => {
    prisma.courseForm.findUnique.mockResolvedValue({
      id: COURSE_FORM_ID,
      courseId: COURSE_ID,
      formId: 'registration-form',
    });
    prisma.userFormCompletion.findUnique.mockResolvedValue(null);

    await expect(
      service.updateFormMetadata(
        'admin-1',
        Role.admin,
        LEARNER_ID,
        COURSE_ID,
        'registration-form',
        COURSE_FORM_ID,
        advisorMeta(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userFormCompletion.updateMany).not.toHaveBeenCalled();
  });
});
