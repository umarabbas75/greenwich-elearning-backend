import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CourseVersionService } from '../course-version/course-version.service';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { FeedbackService } from '../feedback/feedback.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScormCloudClient } from '../scorm-cloud/scorm-cloud.client';
import { CourseService } from './course.service';

describe('CourseService.canAccessCourseContent', () => {
  let service: CourseService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      course: { findUnique: jest.fn() },
      courseCompletion: { findUnique: jest.fn().mockResolvedValue(null) },
      courseForm: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      policy: { findMany: jest.fn().mockResolvedValue([]) },
      userPolicyCompletion: { findMany: jest.fn().mockResolvedValue([]) },
      userPolicyItemCompletion: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: MailService, useValue: {} },
        { provide: FeedbackService, useValue: {} },
        { provide: CourseVersionService, useValue: {} },
        { provide: CourseCompletionService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: ScormCloudClient, useValue: {} },
      ],
    }).compile();

    service = module.get(CourseService);
  });

  it('gives no access on an enrolment an admin has not activated', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      validityDays: 365,
      users: [{ id: 'uc-1', createdAt: new Date(), isActive: false }],
    });

    const result = await service.canAccessCourseContent('user-1', 'course-1');

    expect(result.statusCode).toBe(403);
    expect(result.data).toEqual({ canAccessContent: false, inactive: true });
    // Nothing else is evaluated for an inactive enrolment.
    expect(prisma.courseCompletion.findUnique).not.toHaveBeenCalled();
  });

  it('does not apply the learner-only enrolment gate to an admin', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      validityDays: 365,
      users: [{ id: 'uc-1', createdAt: new Date(), isActive: false }],
    });

    const result = await service.canAccessCourseContent(
      'admin-1',
      'course-1',
      'admin' as any,
    );

    expect(result.statusCode).toBe(200);
    expect((result.data as any).canAccessContent).toBe(true);
  });

  it('counts a policy complete once the item still outstanding is removed', async () => {
    const enrolledAt = new Date('2026-07-01T00:00:00.000Z');
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      validityDays: 365,
      users: [{ id: 'uc-1', createdAt: enrolledAt, isActive: true }],
    });
    // The policy now only has i1 (an admin detached i2, which the learner had
    // not acknowledged). No policy-level acknowledgement row was ever written.
    const policy = {
      id: 'p1',
      title: 'Policies',
      description: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      detachedWindows: null,
      items: [
        {
          id: 'i1',
          title: 'Complaints',
          description: '',
          link: 'https://a',
          requiredSince: new Date('2026-06-01T00:00:00.000Z'),
          detachedWindows: null,
          completions: [{ isComplete: true }],
        },
      ],
      completions: [],
    };
    prisma.policy.findMany.mockResolvedValue([policy]);
    prisma.userPolicyItemCompletion.findMany.mockResolvedValue([
      { itemId: 'i1' },
    ]);

    const result = await service.canAccessCourseContent('user-1', 'course-1');

    expect((result.data as any).canAccessContent).toBe(true);
    expect((result.data as any).policyStatus.completedPolicies).toBe(1);
    expect((result.data as any).policyStatus.policies[0].isComplete).toBe(true);
  });
});
