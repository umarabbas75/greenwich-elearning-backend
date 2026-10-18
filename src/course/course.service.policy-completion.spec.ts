import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CourseVersionService } from '../course-version/course-version.service';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { FeedbackService } from '../feedback/feedback.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScormCloudClient } from '../scorm-cloud/scorm-cloud.client';
import { makeAbortAwareTransactionMock } from '../test-utils/prisma-transaction-mock';
import { CourseService } from './course.service';

const ENROLLED_AT = new Date('2026-07-01T00:00:00.000Z');
const BEFORE = new Date('2026-06-01T00:00:00.000Z');
const AFTER = new Date('2026-10-01T00:00:00.000Z');

describe('CourseService.markPolicyItemAsComplete', () => {
  let service: CourseService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      userCourse: {
        findUnique: jest.fn().mockResolvedValue({ createdAt: ENROLLED_AT }),
      },
      policyItem: { findMany: jest.fn() },
      userPolicyItemCompletion: {
        upsert: jest.fn().mockResolvedValue({ id: 'ack-1' }),
        findMany: jest.fn(),
      },
      userPolicyCompletion: {
        upsert: jest.fn().mockResolvedValue({ id: 'policy-ack-1' }),
      },
    };
    prisma.$transaction = makeAbortAwareTransactionMock(prisma);

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

  const acknowledge = (policyItemId: string) =>
    service.markPolicyItemAsComplete({
      userId: 'user-1',
      courseId: 'course-1',
      policyId: 'p1',
      policyItemId,
    });

  it('completes the policy once every item that applies is acknowledged', async () => {
    prisma.policyItem.findMany.mockResolvedValue([
      { id: 'i1', requiredSince: BEFORE },
      // Added after this learner enrolled, so not required of them.
      { id: 'i2', requiredSince: AFTER },
    ]);
    prisma.userPolicyItemCompletion.findMany.mockResolvedValue([
      { itemId: 'i1' },
    ]);

    await acknowledge('i1');

    expect(
      prisma.userPolicyItemCompletion.findMany.mock.calls[0][0].where.itemId,
    ).toEqual({ in: ['i1'] });
    expect(prisma.userPolicyCompletion.upsert).toHaveBeenCalled();
  });

  it('still needs every required item when none of them apply to the learner', async () => {
    prisma.policyItem.findMany.mockResolvedValue([
      { id: 'i1', requiredSince: AFTER },
      { id: 'i2', requiredSince: AFTER },
    ]);
    prisma.userPolicyItemCompletion.findMany.mockResolvedValue([
      { itemId: 'i1' },
    ]);

    await acknowledge('i1');

    expect(prisma.userPolicyCompletion.upsert).not.toHaveBeenCalled();
  });
});
