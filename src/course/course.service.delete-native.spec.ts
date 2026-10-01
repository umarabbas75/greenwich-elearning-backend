import { HttpException } from '@nestjs/common';
import { CourseDeliveryMode, Prisma, Role } from '@prisma/client';
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

function makePrisma(): Record<string, any> {
  const models: Record<string, any> = {};
  const model = (name: string) => {
    if (!models[name]) {
      models[name] = {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        groupBy: jest.fn().mockResolvedValue([]),
      };
    }
    return models[name];
  };

  const base: Record<string, any> = {
    // Notification cleanup (tagged template) — returns the deleted count.
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(async (ops: any) => {
      if (typeof ops === 'function') return ops(proxy);
      return Promise.all(ops);
    }),
  };

  const proxy: Record<string, any> = new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (typeof prop !== 'string') return undefined;
      return model(prop);
    },
  });

  return proxy;
}

const NATIVE_COURSE = {
  id: 'course-native-1',
  title: 'Fire Safety',
  isActive: true,
  deliveryMode: CourseDeliveryMode.NATIVE,
};

describe('CourseService — deleting a native course', () => {
  let service: CourseService;
  let prisma: Record<string, any>;
  let courseVersionService: { writeAudit: jest.Mock };

  beforeEach(async () => {
    prisma = makePrisma();
    courseVersionService = {
      writeAudit: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: MailService, useValue: { send: jest.fn() } },
        { provide: FeedbackService, useValue: {} },
        { provide: CourseVersionService, useValue: courseVersionService },
        { provide: CourseCompletionService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: ScormCloudClient, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(CourseService);
  });

  function givenNativeCourseWithModuleTree() {
    prisma.course.findUnique.mockResolvedValue(NATIVE_COURSE);
    prisma.scormPackage.findMany.mockResolvedValue([]);
    prisma.chapter.findMany.mockResolvedValue([{ id: 'chapter-1' }]);
    prisma.assessment.findMany.mockResolvedValue([]);
    prisma.policy.findMany.mockResolvedValue([]);
  }

  it('refuses without force when learners have state', async () => {
    givenNativeCourseWithModuleTree();
    prisma.userCourse.count.mockResolvedValue(2);

    await expect(service.deleteCourse('course-native-1')).rejects.toMatchObject(
      {
        status: 409,
      },
    );
    expect(prisma.course.delete).not.toHaveBeenCalled();
  });

  it('deletes a course with only structure and no learner rows', async () => {
    givenNativeCourseWithModuleTree();

    const res = await service.deleteCourse('course-native-1', {
      adminId: 'admin-1',
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.course.delete).toHaveBeenCalledWith({
      where: { id: 'course-native-1' },
    });
    expect(courseVersionService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE_COURSE' }),
    );
  });

  it('force-deletes when learner rows exist', async () => {
    givenNativeCourseWithModuleTree();
    prisma.userCourse.count.mockResolvedValue(4);
    prisma.userCourseProgress.count.mockResolvedValue(10);

    const res = await service.deleteCourse('course-native-1', {
      force: true,
      adminId: 'admin-1',
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.course.delete).toHaveBeenCalled();
    expect(courseVersionService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE_COURSE_FORCE' }),
    );
  });

  it('deactivates as the first statement inside the teardown transaction', async () => {
    givenNativeCourseWithModuleTree();
    const order: string[] = [];
    let inTx = false;
    prisma.course.update.mockImplementation(async () => {
      order.push(inTx ? 'deactivate:in-tx' : 'deactivate:outside');
      return {};
    });
    prisma.forumThread.updateMany.mockImplementation(async () => {
      order.push('teardown');
      return { count: 0 };
    });
    prisma.$transaction.mockImplementation(async (fn: any) => {
      inTx = true;
      try {
        return await fn(prisma);
      } finally {
        inTx = false;
      }
    });

    await service.deleteCourse('course-native-1');

    // Inside the tx a rollback (or a killed function) restores isActive —
    // there is no JS-side restore that could re-open another admin's change.
    expect(order[0]).toBe('deactivate:in-tx');
    expect(order).not.toContain('deactivate:outside');
    expect(prisma.course.update).toHaveBeenCalledTimes(1);
    expect(prisma.course.update).toHaveBeenCalledWith({
      where: { id: 'course-native-1' },
      data: { isActive: false },
    });
  });

  it('refuses inside the transaction when learner rows appeared after the gather', async () => {
    givenNativeCourseWithModuleTree();
    // Gather sees none; the in-tx re-count sees a fresh enrollment.
    prisma.userCourse.count.mockResolvedValueOnce(0).mockResolvedValue(1);

    const error: HttpException = await service
      .deleteCourse('course-native-1')
      .catch((e) => e);

    expect(error.getStatus()).toBe(409);
    const body = error.getResponse() as any;
    expect(body.error).toContain('while the delete was running');
    expect(body.error).toContain('Nothing was deleted');
    expect(body.details.learnerState.enrollments).toBe(1);
    expect(prisma.userCourse.deleteMany).not.toHaveBeenCalled();
    expect(prisma.course.delete).not.toHaveBeenCalled();
  });

  it('does not re-count with force', async () => {
    givenNativeCourseWithModuleTree();

    await service.deleteCourse('course-native-1', { force: true });

    // One call: the gather. The re-count only guards the no-force path.
    expect(prisma.userCourse.count).toHaveBeenCalledTimes(1);
  });

  it('audits as forced when the teardown deleted learner rows the gather missed', async () => {
    givenNativeCourseWithModuleTree();
    prisma.userCourse.deleteMany.mockResolvedValue({ count: 1 });

    const res = await service.deleteCourse('course-native-1', {
      force: true,
      adminId: 'admin-1',
    });

    expect(res.message).toContain('all learner records');
    expect(courseVersionService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE_COURSE_FORCE' }),
    );
  });

  it('deletes notifications that reference the course or its attempts/assignments', async () => {
    givenNativeCourseWithModuleTree();
    prisma.assessment.findMany.mockResolvedValue([{ id: 'assess-1' }]);
    prisma.assessmentAttempt.findMany.mockResolvedValue([{ id: 'attempt-1' }]);
    prisma.assignment.findMany.mockResolvedValue([{ id: 'assignment-1' }]);
    prisma.assignmentSubmission.findMany.mockResolvedValue([
      { id: 'submission-1' },
    ]);
    prisma.$executeRaw.mockResolvedValue(3);

    const res = await service.deleteCourse('course-native-1');

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = prisma.$executeRaw.mock.calls[0];
    const sql = strings.join('?');
    expect(sql).toContain('DELETE FROM "notifications"');
    // One indexable `= ANY` probe, not an OR of subqueries (seq scan).
    expect(sql).toContain('"referenceId" = ANY(');
    expect(sql).not.toContain('SELECT');
    expect(values).toEqual([
      ['course-native-1', 'attempt-1', 'assignment-1', 'submission-1'],
    ]);
    expect(prisma.assessmentAttempt.findMany).toHaveBeenCalledWith({
      where: { assessmentId: { in: ['assess-1'] } },
      select: { id: true },
    });
    expect((res.data as any).deleted.notifications).toBe(3);
  });

  it('answers "already deleted" when a concurrent delete committed first', async () => {
    givenNativeCourseWithModuleTree();
    prisma.course.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Record to delete does not exist.',
        {
          code: 'P2025',
          clientVersion: '5.9.1',
        },
      ),
    );

    const error: HttpException = await service
      .deleteCourse('course-native-1', { adminId: 'admin-1' })
      .catch((e) => e);

    expect(error.getStatus()).toBe(403);
    expect((error.getResponse() as any).code).toBe('COURSE_ALREADY_DELETED');
    expect((error.getResponse() as any).error).toContain('Course not found');
    expect(courseVersionService.writeAudit).not.toHaveBeenCalled();
  });

  /** post.count answers by authorship: learner (role 'user') vs admin. */
  function givenPosts(byLearners: number, byAdmins: number) {
    prisma.post.count.mockImplementation(async (args: any) =>
      args.where.user?.role === Role.user ? byLearners : byAdmins,
    );
  }

  it('requires force when learners wrote posts in the course', async () => {
    givenNativeCourseWithModuleTree();
    givenPosts(2, 1);

    const error: HttpException = await service
      .deleteCourse('course-native-1')
      .catch((e) => e);

    expect(error.getStatus()).toBe(409);
    const details = (error.getResponse() as any).details;
    expect(details.learnerState.learnerPostRows).toBe(2);
    expect(details.content.posts).toBe(1);
    expect(prisma.post.deleteMany).not.toHaveBeenCalled();
  });

  it('requires force for learner comments, even on an admin post', async () => {
    givenNativeCourseWithModuleTree();
    givenPosts(0, 1);
    prisma.comment.count.mockResolvedValue(3);

    await expect(service.deleteCourse('course-native-1')).rejects.toMatchObject(
      { status: 409 },
    );
    expect(prisma.comment.count).toHaveBeenCalledWith({
      where: {
        post: { courseId: 'course-native-1' },
        user: { role: Role.user },
      },
    });
  });

  it('requires force for daily time-tracking rows', async () => {
    givenNativeCourseWithModuleTree();
    prisma.sectionTimeSpentDaily.count.mockResolvedValue(5);

    await expect(service.deleteCourse('course-native-1')).rejects.toMatchObject(
      { status: 409 },
    );
  });

  it('treats admin-authored posts as content and deletes without force', async () => {
    givenNativeCourseWithModuleTree();
    givenPosts(0, 2);

    const res = await service.deleteCourse('course-native-1');

    expect(res.statusCode).toBe(200);
    expect(prisma.post.deleteMany).toHaveBeenCalled();
  });

  /** `n` other-course assessments use this course's questions. */
  function givenSharedAssessments(n: number) {
    const ids = Array.from({ length: n }, (_, i) => `assess-${i}`);
    prisma.assessmentQuestion.count.mockResolvedValue(n);
    prisma.assessmentQuestion.groupBy.mockResolvedValue(
      ids.map((assessmentId) => ({ assessmentId })),
    );
    prisma.assessment.findMany.mockImplementation(async (args: any) =>
      args.where.id
        ? args.where.id.in.map((id: string) => ({
            id,
            title: 'Quiz',
            courseId: `course-of-${id}`,
            course: { title: `Course of ${id}` },
          }))
        : [],
    );
  }

  it('lists at most 20 shared assessments and adds "…" only past 20', async () => {
    givenNativeCourseWithModuleTree();
    givenSharedAssessments(20);
    const atCap: HttpException = await service
      .deleteCourse('course-native-1')
      .catch((e) => e);
    expect((atCap.getResponse() as any).error).not.toContain('…');

    givenSharedAssessments(21);
    const overCap: HttpException = await service
      .deleteCourse('course-native-1')
      .catch((e) => e);
    const body = overCap.getResponse() as any;
    expect(body.error).toContain('…');
    expect(body.details.sharedQuestionAssessments).toHaveLength(20);
    // Distinct + limit in the database, one past the cap.
    expect(prisma.assessmentQuestion.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['assessmentId'], take: 21 }),
    );
  });

  it('refuses without force when another course uses its questions', async () => {
    givenNativeCourseWithModuleTree();
    prisma.assessmentQuestion.count.mockResolvedValue(2);
    prisma.assessmentQuestion.groupBy.mockResolvedValue([
      { assessmentId: 'assess-x' },
    ]);
    prisma.assessment.findMany.mockImplementation(async (args: any) =>
      args.where.id
        ? [
            {
              id: 'assess-x',
              title: 'Quiz',
              courseId: 'course-x',
              course: { title: 'Manual Handling' },
            },
          ]
        : [],
    );

    const error: HttpException = await service
      .deleteCourse('course-native-1')
      .catch((e) => e);

    expect(error.getStatus()).toBe(409);
    expect((error.getResponse() as any).error).toContain('Manual Handling');
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it('refuses inside the transaction if a cross-course use appeared after the gather', async () => {
    givenNativeCourseWithModuleTree();
    prisma.assessmentQuestion.deleteMany.mockImplementation(
      async (args: any) => (args.where.question ? { count: 1 } : { count: 0 }),
    );

    await expect(service.deleteCourse('course-native-1')).rejects.toMatchObject(
      { status: 409 },
    );
    expect(prisma.course.delete).not.toHaveBeenCalled();
  });

  it('re-reads chapter ids inside the transaction', async () => {
    givenNativeCourseWithModuleTree();
    // Gather sees one chapter; a second is added before the teardown runs.
    prisma.chapter.findMany
      .mockResolvedValueOnce([{ id: 'chapter-1' }])
      .mockResolvedValue([{ id: 'chapter-1' }, { id: 'chapter-2' }]);

    await service.deleteCourse('course-native-1');

    expect(prisma.chapter.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['chapter-1', 'chapter-2'] } },
    });
  });

  it('names the constraint when the teardown hits a P2003, with no JS-side restore', async () => {
    givenNativeCourseWithModuleTree();
    prisma.course.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', {
        code: 'P2003',
        clientVersion: 'test',
        meta: { field_name: 'user_courses_courseId_fkey (index)' },
      }),
    );

    const error: HttpException = await service
      .deleteCourse('course-native-1')
      .catch((e) => e);

    expect(error.getStatus()).toBe(403);
    const body = error.getResponse() as any;
    expect(body.error).toContain('user_courses_courseId_fkey');
    expect(body.details.constraint).toBe('user_courses_courseId_fkey (index)');
    // Only the in-tx deactivation; the rollback is what restores it.
    expect(prisma.course.update).toHaveBeenCalledTimes(1);
  });

  it('leaves an already-inactive course inactive when the teardown fails', async () => {
    givenNativeCourseWithModuleTree();
    prisma.course.findUnique.mockResolvedValue({
      ...NATIVE_COURSE,
      isActive: false,
    });
    prisma.course.delete.mockRejectedValue(new Error('boom'));

    await expect(service.deleteCourse('course-native-1')).rejects.toBeDefined();
    expect(prisma.course.update).not.toHaveBeenCalled();
  });
});
