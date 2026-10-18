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
  let courseVersionService: { writeAudit: jest.Mock };

  beforeEach(async () => {
    prisma = {
      course: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: COURSE_ID, validityDays: 365 }),
        update: jest
          .fn()
          .mockResolvedValue({ id: COURSE_ID, validityDays: 365 }),
      },
      courseForm: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      courseFeedbackForm: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn().mockResolvedValue({ isRequired: true }),
        update: jest.fn().mockResolvedValue({}),
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
    courseVersionService = {
      writeAudit: jest.fn().mockResolvedValue(undefined),
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
        { provide: CourseVersionService, useValue: courseVersionService },
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

  describe('course forms', () => {
    it('detaches a removed form instead of deleting it and its submissions', async () => {
      prisma.courseForm.findMany.mockResolvedValue([
        { formId: 'registration-form', detachedAt: null },
        { formId: 'learner-agreement', detachedAt: null },
      ]);

      await service.updateCourse(COURSE_ID, {
        courseForms: [{ value: 'registration-form', label: 'Registration' }],
      } as any);

      expect(prisma.courseForm.deleteMany).not.toHaveBeenCalled();
      expect(prisma.courseForm.updateMany).toHaveBeenCalledWith({
        where: { courseId: COURSE_ID, formId: { in: ['learner-agreement'] } },
        data: { detachedAt: expect.any(Date) },
      });
    });

    it('re-attaches a removed form and exempts learners who enrolled meanwhile', async () => {
      const removedAt = new Date('2026-10-01T00:00:00.000Z');
      prisma.courseForm.findMany.mockResolvedValue([
        {
          formId: 'learner-agreement',
          isRequired: true,
          detachedAt: removedAt,
          detachedWindows: null,
        },
      ]);

      await service.updateCourse(
        COURSE_ID,
        {
          courseForms: [{ value: 'learner-agreement', label: 'Agreement' }],
        } as any,
        'admin-1',
      );

      const update = prisma.courseForm.upsert.mock.calls[0][0].update;
      expect(update).toEqual(
        expect.objectContaining({
          detachedAt: null,
          detachedWindows: [
            { from: removedAt.toISOString(), until: expect.any(String) },
          ],
        }),
      );
      // The date it applies from is untouched.
      expect(update).not.toHaveProperty('requiredSince');
      expect(prisma.courseForm.updateMany).not.toHaveBeenCalled();
      expect(
        courseVersionService.writeAudit.mock.calls[0][0].metadata.forms,
      ).toEqual({
        attached: [],
        reattached: ['learner-agreement'],
        detached: [],
      });
    });

    it('keeps every earlier removal window when a form is re-added again', async () => {
      const earlier = {
        from: '2026-08-01T00:00:00.000Z',
        until: '2026-09-01T00:00:00.000Z',
      };
      prisma.courseForm.findMany.mockResolvedValue([
        {
          formId: 'learner-agreement',
          isRequired: true,
          detachedAt: new Date('2026-10-01T00:00:00.000Z'),
          detachedWindows: [earlier],
        },
      ]);

      await service.updateCourse(COURSE_ID, {
        courseForms: [{ value: 'learner-agreement', label: 'Agreement' }],
      } as any);

      expect(
        prisma.courseForm.upsert.mock.calls[0][0].update.detachedWindows,
      ).toEqual([
        earlier,
        { from: '2026-10-01T00:00:00.000Z', until: expect.any(String) },
      ]);
    });

    it('restarts the date a form applies from when it is made required', async () => {
      prisma.courseForm.findMany.mockResolvedValue([
        {
          formId: 'learner-agreement',
          isRequired: false,
          detachedAt: null,
          detachedWindows: null,
        },
      ]);

      await service.updateCourse(COURSE_ID, {
        courseForms: [
          { value: 'learner-agreement', label: 'Agreement', isRequired: true },
        ],
      } as any);

      expect(prisma.courseForm.upsert.mock.calls[0][0].update).toEqual({
        formName: 'Agreement',
        isRequired: true,
        requiredSince: expect.any(Date),
      });
    });

    it('leaves the date alone when a required form is re-saved', async () => {
      prisma.courseForm.findMany.mockResolvedValue([
        {
          formId: 'learner-agreement',
          isRequired: true,
          detachedAt: null,
          detachedWindows: null,
        },
      ]);

      await service.updateCourse(COURSE_ID, {
        courseForms: [{ value: 'learner-agreement', label: 'Agreement' }],
      } as any);

      expect(prisma.courseForm.upsert.mock.calls[0][0].update).toEqual({
        formName: 'Agreement',
        isRequired: true,
      });
    });
  });

  describe('feedback form', () => {
    it('updates an existing form in place and never deletes learner submissions', async () => {
      prisma.courseFeedbackForm.findUnique.mockResolvedValue({
        id: 'ff-1',
        isRequired: true,
      });

      await service.updateCourse(COURSE_ID, {
        feedbackForm: {
          formName: 'Course Completion Feedback',
          isRequired: true,
        },
      } as any);

      expect(prisma.courseFeedbackForm.update).toHaveBeenCalledWith({
        where: { id: 'ff-1' },
        data: { formName: 'Course Completion Feedback', isRequired: true },
      });
      expect(prisma.courseFeedbackSubmission.deleteMany).not.toHaveBeenCalled();
      expect(prisma.courseFeedbackForm.deleteMany).not.toHaveBeenCalled();
      expect(prisma.courseFeedbackForm.create).not.toHaveBeenCalled();
    });

    it('overwrites the form structure only when one is sent', async () => {
      prisma.courseFeedbackForm.findUnique.mockResolvedValue({
        id: 'ff-1',
        isRequired: true,
      });
      const formStructure = { questions: [{ id: 'q1' }] };
      await service.updateCourse(COURSE_ID, {
        feedbackForm: { formName: 'Feedback', isRequired: true, formStructure },
      } as any);

      expect(prisma.courseFeedbackForm.update.mock.calls[0][0].data).toEqual({
        formName: 'Feedback',
        isRequired: true,
        formStructure,
      });
    });

    it('lets an admin switch required feedback off', async () => {
      prisma.courseFeedbackForm.findUnique.mockResolvedValue({
        id: 'ff-1',
        isRequired: true,
      });

      await service.updateCourse(COURSE_ID, {
        feedbackForm: { formName: 'Feedback', isRequired: false },
      } as any);

      expect(prisma.courseFeedbackForm.update.mock.calls[0][0].data).toEqual({
        formName: 'Feedback',
        isRequired: false,
      });
    });

    it('creates an optional feedback form when asked for one', async () => {
      prisma.courseFeedbackForm.create.mockResolvedValue({ isRequired: false });

      await service.updateCourse(COURSE_ID, {
        feedbackForm: { formName: 'Feedback', isRequired: false },
      } as any);

      expect(prisma.courseFeedbackForm.create).toHaveBeenCalledWith({
        data: {
          courseId: COURSE_ID,
          formName: 'Feedback',
          formStructure: {},
          isRequired: false,
        },
        select: { isRequired: true },
      });
    });

    it('restarts the requirement from now when feedback is made required again', async () => {
      prisma.courseFeedbackForm.findUnique.mockResolvedValue({
        id: 'ff-1',
        isRequired: false,
      });

      await service.updateCourse(COURSE_ID, {
        feedbackForm: { formName: 'Feedback', isRequired: true },
      } as any);

      expect(prisma.courseFeedbackForm.update.mock.calls[0][0].data).toEqual({
        formName: 'Feedback',
        isRequired: true,
        requiredSince: expect.any(Date),
      });
    });
  });

  describe('audit log', () => {
    it('records which admin changed which fields', async () => {
      prisma.course.update.mockResolvedValue({
        id: COURSE_ID,
        validityDays: 90,
      });

      await service.updateCourse(
        COURSE_ID,
        { validityDays: 90 } as any,
        'admin-1',
      );

      expect(courseVersionService.writeAudit).toHaveBeenCalledWith({
        adminId: 'admin-1',
        action: 'UPDATE_COURSE',
        targetType: 'Course',
        targetId: COURSE_ID,
        courseId: COURSE_ID,
        metadata: {
          fields: { validityDays: { from: 365, to: 90 } },
          forms: null,
          feedbackForm: null,
          policies: null,
        },
      });
    });

    it('writes nothing when the save changed nothing', async () => {
      await service.updateCourse(
        COURSE_ID,
        { validityDays: 365 } as any,
        'admin-1',
      );

      expect(courseVersionService.writeAudit).not.toHaveBeenCalled();
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

    it('restarts the date an item applies from when it is made required', async () => {
      const stored = editorCopy(nebosh);
      stored.items[1].isRequired = false;
      prisma.policy.findMany.mockResolvedValue([stored]);
      const edited = editorCopy(stored);
      edited.items[1].isRequired = true;

      await service.updateCourse(COURSE_ID, { policies: [edited] } as any);

      const updates = prisma.policyItem.update.mock.calls.map(([arg]) => arg);
      expect(updates.find((u) => u.where.id === 'i2').data).toEqual(
        expect.objectContaining({
          isRequired: true,
          requiredSince: expect.any(Date),
        }),
      );
      expect(updates.find((u) => u.where.id === 'i1').data).not.toHaveProperty(
        'requiredSince',
      );
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
            create: [expect.objectContaining({ title: 'Handbook', order: 0 })],
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
