import { ConflictException } from '@nestjs/common';
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
import {
  COURSE_BOOKING_DOC_REF_V2,
  evaluateRegistrationAccess,
} from '../utils/advisor-review-metadata';
import { CourseService } from './course.service';

/**
 * The whole send-back lifecycle against one stored row, so each step reads
 * what the previous one actually wrote.
 */
const COURSE_ID = 'course-1';
const COURSE_FORM_ID = 'cf-1';
const LEARNER_ID = 'learner-1';
const ADMIN_ID = 'admin-1';

type Row = {
  id: string;
  userId: string;
  courseId: string;
  formId: string;
  courseFormId: string;
  isComplete: boolean;
  completedAt: Date | null;
  updatedAt: Date;
  metadata: any;
};

function fakeDb() {
  let clock = Date.parse('2026-10-28T10:00:00.000Z');
  const tick = () => new Date((clock += 60_000));
  const rows: Row[] = [];
  const user = { id: LEARNER_ID, photo: null as string | null };

  const find = (where: any): Row | undefined =>
    where.id
      ? rows.find((r) => r.id === where.id)
      : rows.find(
          (r) =>
            r.userId === where.userId_courseId_formId.userId &&
            r.courseId === where.userId_courseId_formId.courseId &&
            r.formId === where.userId_courseId_formId.formId,
        );
  const matches = (r: Row, where: any) =>
    r.id === where.id &&
    (where.isComplete === undefined || r.isComplete === where.isComplete) &&
    (where.updatedAt === undefined ||
      r.updatedAt.getTime() === where.updatedAt.getTime());
  const copy = (r: Row | undefined) =>
    r ? { ...r, metadata: JSON.parse(JSON.stringify(r.metadata)) } : null;

  const prisma = {
    courseForm: {
      findUnique: jest.fn(async () => ({
        id: COURSE_FORM_ID,
        courseId: COURSE_ID,
        formId: 'registration-form',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        requiredSince: new Date('2026-06-01T00:00:00.000Z'),
        detachedAt: null,
        detachedWindows: null,
      })),
    },
    userCourse: {
      findFirst: jest.fn(async () => ({
        id: 'uc-1',
        userId: LEARNER_ID,
        courseId: COURSE_ID,
        isActive: true,
        createdAt: new Date('2026-10-28T08:00:00.000Z'),
      })),
    },
    courseCompletion: { findUnique: jest.fn(async () => null) },
    course: {
      findUnique: jest.fn(async () => ({
        title: 'NEBOSH IGC',
        validityDays: 365,
      })),
    },
    user: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === LEARNER_ID
          ? {
              id: LEARNER_ID,
              email: 'idrees@example.com',
              firstName: 'Muhammad',
              lastName: 'Idrees',
              photo: user.photo,
            }
          : { firstName: 'Muhammad', lastName: 'Waqas' },
      ),
      findMany: jest.fn(async () => [{ id: ADMIN_ID }]),
      update: jest.fn(async ({ data }: any) => {
        user.photo = data.photo;
        return user;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (user.photo !== where.photo) return { count: 0 };
        user.photo = data.photo;
        return { count: 1 };
      }),
    },
    userFormCompletion: {
      findUnique: jest.fn(async ({ where }: any) => copy(find(where))),
      create: jest.fn(async ({ data }: any) => {
        const row: Row = {
          id: `ufc-${rows.length + 1}`,
          updatedAt: tick(),
          ...JSON.parse(JSON.stringify(data)),
          completedAt: data.completedAt,
        };
        rows.push(row);
        return copy(row);
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => matches(r, where));
        if (!row) return { count: 0 };
        Object.assign(row, {
          ...data,
          metadata:
            data.metadata === undefined
              ? row.metadata
              : JSON.parse(JSON.stringify(data.metadata)),
          updatedAt: tick(),
        });
        return { count: 1 };
      }),
    },
  };
  return { prisma, rows, user };
}

describe('registration send-back lifecycle', () => {
  let service: CourseService;
  let db: ReturnType<typeof fakeDb>;
  let notifications: {
    createNotification: jest.Mock;
    createNotificationForMany: jest.Mock;
  };

  const learnerSubmits = (metadata: Record<string, unknown>) =>
    service.markFormComplete(
      LEARNER_ID,
      Role.user,
      COURSE_ID,
      'registration-form',
      metadata,
      COURSE_FORM_ID,
    );
  const row = () => db.rows[0];
  const seen = () => row().completedAt?.toISOString() ?? null;
  const advisorDecides = (
    registrationStatus: string,
    comments = '',
    submissionCompletedAt: string | null | undefined = seen(),
  ) =>
    service.updateFormMetadata(
      ADMIN_ID,
      Role.admin,
      LEARNER_ID,
      COURSE_ID,
      'registration-form',
      COURSE_FORM_ID,
      {
        ...row().metadata,
        advisor: {
          learnerEligibilityConfirmed: 'yes',
          identityDocsVerified: 'yes',
          entryRequirementsMet: 'yes',
          englishRequirementMet: 'yes',
          needsAssessmentCompleted: 'yes',
          reasonableAdjustmentsRequired: 'no',
          specialConsiderationRequired: 'no',
          registrationStatus,
          comments,
        },
        advisorSignature: 'Muhammad Waqas',
        advisorDate: '2026-10-31',
      },
      submissionCompletedAt,
    );
  const advisorSendsBack = (comments: string) =>
    service.requestFormChanges({
      adminId: ADMIN_ID,
      adminRole: Role.admin,
      learnerUserId: LEARNER_ID,
      courseId: COURSE_ID,
      formId: 'registration-form',
      courseFormId: COURSE_FORM_ID,
      comments,
      submissionCompletedAt: seen(),
    });
  const gate = () =>
    evaluateRegistrationAccess([
      { formId: 'registration-form', metadata: row().metadata },
    ]);

  const firstSubmission = {
    bookingFormVersion: COURSE_BOOKING_DOC_REF_V2,
    fullName: 'Muhammad Idrees',
    userPhoto: 'https://cdn/generic.jpg',
    // What the current frontend sends along; it must never stick.
    advisor: { registrationStatus: 'Pending' },
  };

  beforeEach(async () => {
    db = fakeDb();
    notifications = {
      createNotification: jest.fn().mockResolvedValue(undefined),
      createNotificationForMany: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: db.prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: MailService,
          useValue: {
            sendRegistrationReceived: jest.fn().mockResolvedValue(undefined),
            sendNotificationEmail: jest.fn().mockResolvedValue(undefined),
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

    await learnerSubmits(firstSubmission);
    await advisorDecides('Pending', 'Use your original passport photo.');
  });

  it('runs submit → send back → resubmit → approve end to end', async () => {
    const originalCompletedAt = row().completedAt;
    expect(db.user.photo).toBe('https://cdn/generic.jpg');

    await advisorSendsBack('Upload your original passport-size photograph.');
    expect(row().isComplete).toBe(false);
    expect(gate()).toMatchObject({
      blocked: true,
      reason: 'REGISTRATION_CHANGES_REQUESTED',
      comments: 'Upload your original passport-size photograph.',
    });

    // Learner reopens the form: frontend pre-fills from stored answers and
    // sends back whatever was in the bag, including advisor keys.
    await learnerSubmits({
      ...row().metadata,
      userPhoto: 'https://cdn/passport.jpg',
    });
    expect(row().isComplete).toBe(true);
    expect(row().completedAt!.getTime()).toBeGreaterThan(
      originalCompletedAt!.getTime(),
    );
    expect(row().metadata.advisor).toBeUndefined();
    expect(row().metadata.changesRequested).toBeUndefined();
    expect(row().metadata.userPhoto).toBe('https://cdn/passport.jpg');
    expect(db.user.photo).toBe('https://cdn/passport.jpg');
    expect(gate()).toMatchObject({ reason: 'REGISTRATION_PENDING' });
    expect(row().metadata.reviewHistory.map((e: any) => e.action)).toEqual([
      'CHANGES_REQUESTED',
      'RESUBMITTED',
    ]);

    const submitted = notifications.createNotificationForMany.mock.calls.map(
      (c) => c[0].dedupeKeyFor(ADMIN_ID),
    );
    expect(submitted).toEqual([
      `registration-submitted:${COURSE_FORM_ID}:${LEARNER_ID}:${ADMIN_ID}`,
      `registration-submitted:${COURSE_FORM_ID}:${LEARNER_ID}:${ADMIN_ID}:r1`,
    ]);

    await advisorDecides('Approved');
    expect(gate()).toMatchObject({ blocked: false });
    const reviewKeys = notifications.createNotification.mock.calls
      .map((c) => c[0].dedupeKey)
      .filter((k: string) => k.startsWith('registration-reviewed:'));
    expect(reviewKeys[reviewKeys.length - 1]).toMatch(/:Approved::h.+$/);
  });

  it('tells the learner about a decision that withdraws a request, even if it repeats an earlier one', async () => {
    await advisorDecides('Approved');
    await advisorSendsBack('Photo please.');
    await advisorDecides('Approved', '', null);

    const approvals = notifications.createNotification.mock.calls
      .map((c) => c[0].dedupeKey as string)
      .filter((k) => k.includes(':Approved:'));
    expect(approvals).toHaveLength(2);
    expect(new Set(approvals).size).toBe(2);
  });

  it('lets the advisor approve instead, restoring the original submission', async () => {
    const original = row().completedAt;
    await advisorSendsBack('Upload your original passport-size photograph.');

    await advisorDecides('Approved', 'Photo received by email', null);

    expect(row().isComplete).toBe(true);
    expect(row().completedAt).toEqual(original);
    expect(row().metadata.changesRequested).toBeUndefined();
    expect(gate()).toMatchObject({ blocked: false });

    // The learner's open tab can no longer overwrite the decided form.
    await expect(
      learnerSubmits({ ...firstSubmission, fullName: 'Late edit' }),
    ).resolves.toMatchObject({ alreadyCompleted: true });
    expect(row().metadata.fullName).toBe('Muhammad Idrees');
  });

  it('keeps the first request time and status when the request is updated', async () => {
    const original = row().completedAt!.toISOString();
    await advisorSendsBack('Photo please.');
    await advisorSendsBack('Photo and ID please.');

    expect(row().metadata.changesRequested).toMatchObject({
      comments: 'Photo and ID please.',
      previousCompletedAt: original,
      previousStatus: 'Pending',
    });
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: expect.stringMatching(/^registration-changes-requested:/),
      }),
    );
  });

  it('refuses an advisor decision made on a submission the learner has since replaced', async () => {
    await advisorSendsBack('Photo please.');
    const seenWhileSentBack = seen();
    await learnerSubmits({
      ...firstSubmission,
      userPhoto: 'https://cdn/new.jpg',
    });

    await expect(
      advisorDecides('Rejected', 'stale', seenWhileSentBack),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(row().metadata.advisor).toBeUndefined();
  });

  it('never lets a learner approve themselves', async () => {
    await advisorSendsBack('Photo please.');
    await learnerSubmits({
      ...firstSubmission,
      advisor: { registrationStatus: 'Approved' },
    });

    expect(gate()).toMatchObject({
      blocked: true,
      reason: 'REGISTRATION_PENDING',
    });
  });
});
