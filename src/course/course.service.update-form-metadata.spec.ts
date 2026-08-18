import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { CourseVersionService } from '../course-version/course-version.service';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { FeedbackService } from '../feedback/feedback.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
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
        update: jest.fn(),
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
      ],
    }).compile();

    service = module.get(CourseService);
  });

  function mockExistingCompletion() {
    prisma.courseForm.findUnique.mockResolvedValue({
      id: COURSE_FORM_ID,
      courseId: COURSE_ID,
      formId: 'registration-form',
    });
    prisma.userFormCompletion.findUnique.mockResolvedValue({
      id: 'ufc-1',
      userId: LEARNER_ID,
      courseId: COURSE_ID,
      formId: 'registration-form',
      courseFormId: COURSE_FORM_ID,
      isComplete: true,
      completedAt: COMPLETED_AT,
      metadata: { fullName: 'Aatzaz Khaliq' },
    });
  }

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
    expect(prisma.userFormCompletion.update).not.toHaveBeenCalled();
  });

  it('overwrites metadata only and returns the persisted form', async () => {
    mockExistingCompletion();
    const meta = advisorMeta();
    prisma.userFormCompletion.update.mockResolvedValue({
      id: 'ufc-1',
      userId: LEARNER_ID,
      courseId: COURSE_ID,
      formId: 'registration-form',
      courseFormId: COURSE_FORM_ID,
      isComplete: true,
      completedAt: COMPLETED_AT,
      metadata: meta,
    });

    const result = await service.updateFormMetadata(
      'admin-1',
      Role.admin,
      LEARNER_ID,
      COURSE_ID,
      'registration-form',
      COURSE_FORM_ID,
      meta,
    );

    expect(prisma.userFormCompletion.update).toHaveBeenCalledWith({
      where: { id: 'ufc-1' },
      data: { metadata: meta },
    });
    expect(result.success).toBe(true);
    expect(result.form.isComplete).toBe(true);
    expect(result.form.completedAt).toBe(COMPLETED_AT);
    expect(result.form.metadata).toEqual(meta);
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
    expect(prisma.userFormCompletion.update).not.toHaveBeenCalled();
  });
});
