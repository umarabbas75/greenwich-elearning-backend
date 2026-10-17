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

const COURSE_ID = 'course-1';

function storedPolicy(
  id: string,
  title: string,
  items: Array<{ id: string; title: string; link: string; order: number }>,
) {
  return {
    id,
    courseId: COURSE_ID,
    title,
    description: null,
    order: 0,
    createdAt: new Date('2026-06-01T09:26:25.880Z'),
    updatedAt: new Date('2026-06-01T09:26:25.880Z'),
    items: items.map((item) => ({
      ...item,
      description: '',
      isRequired: true,
      policyId: id,
    })),
  };
}

// What the course editor sends back: the stored rows, ids included.
function editorCopy(policy: ReturnType<typeof storedPolicy>) {
  return {
    ...policy,
    items: policy.items.map((item) => ({ ...item })),
  };
}

describe('CourseService.updateCourse', () => {
  let service: CourseService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      course: {
        findUnique: jest.fn().mockResolvedValue({ id: COURSE_ID }),
        update: jest.fn().mockResolvedValue({ id: COURSE_ID }),
      },
      courseForm: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      courseFeedbackForm: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
      courseFeedbackSubmission: { deleteMany: jest.fn() },
      policy: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      policyItem: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userPolicyCompletion: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userPolicyItemCompletion: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    prisma.$transaction = makeAbortAwareTransactionMock(prisma);

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
            createNotification: jest.fn(),
            createNotificationForMany: jest.fn(),
          },
        },
        {
          provide: ScormCloudClient,
          useValue: { deleteRegistration: jest.fn(), deleteCourse: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(CourseService);
  });

  describe('feedback form', () => {
    it('updates the form in place and never deletes learner submissions', async () => {
      await service.updateCourse(COURSE_ID, {
        feedbackForm: {
          formName: 'Course Completion Feedback',
          isRequired: true,
        },
      } as any);

      expect(prisma.courseFeedbackForm.upsert).toHaveBeenCalledWith({
        where: { courseId: COURSE_ID },
        create: {
          courseId: COURSE_ID,
          formName: 'Course Completion Feedback',
          formStructure: {},
          isRequired: true,
        },
        update: {
          formName: 'Course Completion Feedback',
          isRequired: true,
        },
      });
      expect(prisma.courseFeedbackSubmission.deleteMany).not.toHaveBeenCalled();
      expect(prisma.courseFeedbackForm.deleteMany).not.toHaveBeenCalled();
      expect(prisma.courseFeedbackForm.create).not.toHaveBeenCalled();
    });

    it('overwrites the form structure only when one is sent', async () => {
      const formStructure = { questions: [{ id: 'q1' }] };
      await service.updateCourse(COURSE_ID, {
        feedbackForm: { formName: 'Feedback', isRequired: true, formStructure },
      } as any);

      expect(prisma.courseFeedbackForm.upsert.mock.calls[0][0].update).toEqual({
        formName: 'Feedback',
        isRequired: true,
        formStructure,
      });
    });
  });

  describe('policies', () => {
    const nebosh = storedPolicy('p1', 'NEBOSH Policies and Procedures', [
      { id: 'i1', title: 'Complaints', link: 'https://a', order: 0 },
      { id: 'i2', title: 'Appeals', link: 'https://b', order: 1 },
    ]);
    const greenwich = storedPolicy('p2', 'Greenwich Policies', [
      { id: 'i3', title: 'Code of conduct', link: 'https://c', order: 0 },
    ]);

    it('writes nothing when the policies are re-saved unchanged', async () => {
      prisma.policy.findMany.mockResolvedValue([nebosh]);

      await service.updateCourse(COURSE_ID, {
        policies: [editorCopy(nebosh)],
      } as any);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.policy.update).not.toHaveBeenCalled();
      expect(prisma.policy.create).not.toHaveBeenCalled();
    });

    it('updates an edited policy in place and keeps every acknowledgement', async () => {
      prisma.policy.findMany.mockResolvedValue([nebosh]);
      const edited = editorCopy(nebosh);
      edited.items[0].link = 'https://a-v2';

      await service.updateCourse(COURSE_ID, { policies: [edited] } as any);

      expect(prisma.policy.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1' } }),
      );
      expect(prisma.policyItem.update).toHaveBeenCalledWith({
        where: { id: 'i1' },
        data: expect.objectContaining({ link: 'https://a-v2' }),
      });
      expect(prisma.policyItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'i2' } }),
      );
      expect(prisma.policy.create).not.toHaveBeenCalled();
      expect(prisma.policy.deleteMany).not.toHaveBeenCalled();
      expect(prisma.policyItem.deleteMany).not.toHaveBeenCalled();
      expect(prisma.userPolicyCompletion.deleteMany).not.toHaveBeenCalled();
      expect(prisma.userPolicyItemCompletion.deleteMany).not.toHaveBeenCalled();
    });

    it('adds new items to an existing policy without touching the others', async () => {
      prisma.policy.findMany.mockResolvedValue([nebosh]);
      const edited = editorCopy(nebosh);
      edited.items.push({ title: 'Data protection', link: 'https://d' } as any);

      await service.updateCourse(COURSE_ID, { policies: [edited] } as any);

      expect(prisma.policyItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          policyId: 'p1',
          title: 'Data protection',
          order: 2,
        }),
      });
      expect(prisma.policyItem.deleteMany).not.toHaveBeenCalled();
      expect(prisma.userPolicyItemCompletion.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes only the policies and items the admin removed', async () => {
      prisma.policy.findMany.mockResolvedValue([nebosh, greenwich]);
      const kept = editorCopy(nebosh);
      kept.items = kept.items.filter((item) => item.id === 'i1');

      await service.updateCourse(COURSE_ID, { policies: [kept] } as any);

      expect(prisma.userPolicyItemCompletion.deleteMany).toHaveBeenCalledWith({
        where: { itemId: { in: ['i2'] } },
      });
      expect(prisma.userPolicyItemCompletion.deleteMany).toHaveBeenCalledWith({
        where: { itemId: { in: ['i3'] } },
      });
      expect(prisma.userPolicyCompletion.deleteMany).toHaveBeenCalledWith({
        where: { policyId: { in: ['p2'] } },
      });
      expect(prisma.policy.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['p2'] } },
      });
      expect(prisma.policy.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1' } }),
      );
    });

    it('creates a policy the course did not have', async () => {
      prisma.policy.findMany.mockResolvedValue([nebosh]);

      await service.updateCourse(COURSE_ID, {
        policies: [
          editorCopy(nebosh),
          {
            title: 'New policy',
            items: [{ title: 'Handbook', link: 'https://h' }],
          },
        ],
      } as any);

      expect(prisma.policy.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          courseId: COURSE_ID,
          title: 'New policy',
          items: {
            create: [
              expect.objectContaining({ title: 'Handbook', order: 0 }),
            ],
          },
        }),
      });
      expect(prisma.policy.deleteMany).not.toHaveBeenCalled();
    });

    it('matches by title when a client sends policies without ids', async () => {
      prisma.policy.findMany.mockResolvedValue([nebosh]);
      const { id: _id, ...withoutId } = editorCopy(nebosh);
      const policy = {
        ...withoutId,
        items: withoutId.items.map(({ id: _itemId, ...item }) => item),
      };
      policy.items[1].link = 'https://b-v2';

      await service.updateCourse(COURSE_ID, { policies: [policy] } as any);

      expect(prisma.policy.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1' } }),
      );
      expect(prisma.policyItem.update).toHaveBeenCalledWith({
        where: { id: 'i2' },
        data: expect.objectContaining({ link: 'https://b-v2' }),
      });
      expect(prisma.policy.create).not.toHaveBeenCalled();
      expect(prisma.userPolicyCompletion.deleteMany).not.toHaveBeenCalled();
    });
  });
});
