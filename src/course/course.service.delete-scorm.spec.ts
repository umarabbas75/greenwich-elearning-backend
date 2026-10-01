import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CourseDeliveryMode, Prisma, ScormPackageStatus } from '@prisma/client';
import { CourseVersionService } from '../course-version/course-version.service';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { FeedbackService } from '../feedback/feedback.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ScormCloudClient,
  ScormCloudHttpError,
  ScormCloudNetworkError,
  ScormCloudTimeoutError,
} from '../scorm-cloud/scorm-cloud.client';
import { CourseService } from './course.service';

/**
 * Destroying an imported SCORM course — the v2 delete path.
 *
 * The model mock is a Proxy so the ~30 tables the ordered teardown touches
 * don't have to be enumerated by hand; every model answers count → 0,
 * findMany → [], deleteMany → { count: 0 } unless a test overrides it.
 */
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

const SCORM_COURSE = {
  id: 'course-1',
  title: 'Fire Safety (SCORM)',
  isActive: true,
  deliveryMode: CourseDeliveryMode.IMPORTED_SCORM,
};

describe('CourseService — deleting an imported SCORM course', () => {
  let service: CourseService;
  let prisma: Record<string, any>;
  let cloud: { deleteRegistration: jest.Mock; deleteCourse: jest.Mock };
  let courseVersionService: { writeAudit: jest.Mock };

  beforeEach(async () => {
    prisma = makePrisma();
    cloud = {
      deleteRegistration: jest.fn().mockResolvedValue(undefined),
      deleteCourse: jest.fn().mockResolvedValue(undefined),
    };
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
        { provide: ScormCloudClient, useValue: cloud },
      ],
    }).compile();

    service = moduleRef.get(CourseService);
  });

  /** One READY package + its chapter, with no learner rows anywhere. */
  function givenCleanScormCourse() {
    prisma.course.findUnique.mockResolvedValue(SCORM_COURSE);
    prisma.scormPackage.findMany.mockResolvedValue([
      {
        id: 'pkg-1',
        versionNumber: 1,
        status: ScormPackageStatus.READY,
        scormCloudCourseId: 'cloud-1',
      },
    ]);
    prisma.chapter.findMany.mockResolvedValue([{ id: 'chapter-1' }]);
  }

  it('refuses without force when learners have state, touching neither Cloud nor the DB', async () => {
    givenCleanScormCourse();
    prisma.userCourse.count.mockResolvedValue(3);
    prisma.scormRegistration.count.mockResolvedValue(2);

    await expect(service.deleteCourse('course-1')).rejects.toMatchObject({
      status: 409,
    });
    expect(cloud.deleteRegistration).not.toHaveBeenCalled();
    expect(cloud.deleteCourse).not.toHaveBeenCalled();
    expect(prisma.course.delete).not.toHaveBeenCalled();
  });

  it('reports what would be lost in the 409 body', async () => {
    givenCleanScormCourse();
    prisma.userCourse.count.mockResolvedValue(3);
    prisma.courseCompletion.count.mockResolvedValue(1);

    const error: HttpException = await service
      .deleteCourse('course-1')
      .catch((e) => e);

    const body = error.getResponse() as any;
    expect(body.details.learnerState.enrollments).toBe(3);
    expect(body.details.content.scormPackages).toBe(1);
    expect(body.error).toContain('force: true');
  });

  it('deletes a SCORM course with no learner state: Cloud course first, then the row', async () => {
    givenCleanScormCourse();

    const res = await service.deleteCourse('course-1', { adminId: 'admin-1' });

    expect(cloud.deleteCourse).toHaveBeenCalledWith('cloud-1');
    expect(prisma.course.delete).toHaveBeenCalledWith({
      where: { id: 'course-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(courseVersionService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE_SCORM_COURSE' }),
    );
  });

  it('force-destroys: Cloud registrations, then the ordered local teardown', async () => {
    givenCleanScormCourse();
    prisma.userCourse.count.mockResolvedValue(2);
    prisma.scormRegistration.count.mockResolvedValue(2);
    prisma.scormRegistration.findMany.mockResolvedValue([
      { id: 'row-reg-1', scormCloudRegistrationId: 'reg-1' },
      { id: 'row-reg-2', scormCloudRegistrationId: 'reg-2' },
    ]);

    const res = await service.deleteCourse('course-1', {
      force: true,
      adminId: 'admin-1',
    });

    expect(cloud.deleteRegistration).toHaveBeenCalledWith('reg-1');
    expect(cloud.deleteRegistration).toHaveBeenCalledWith('reg-2');
    expect(cloud.deleteCourse).toHaveBeenCalledWith('cloud-1');
    // Enrollments must be cleared before course versions (RESTRICT FK), and
    // the Course row goes last.
    expect(prisma.userCourse.deleteMany).toHaveBeenCalledWith({
      where: { courseId: 'course-1' },
    });
    expect(prisma.courseVersion.deleteMany).toHaveBeenCalledWith({
      where: { courseId: 'course-1' },
    });
    expect(prisma.course.delete).toHaveBeenCalled();
    expect((res.data as any).cloud.registrationsDeleted).toBe(2);
    expect(courseVersionService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE_SCORM_COURSE_FORCE' }),
    );
  });

  it('detaches forum threads and hides them instead of deleting them', async () => {
    givenCleanScormCourse();

    await service.deleteCourse('course-1');

    // courseId: null alone would publish this course's private discussions to
    // every learner (getAllForumThreads treats null-course threads as global).
    expect(prisma.forumThread.updateMany).toHaveBeenCalledWith({
      where: { courseId: 'course-1' },
      data: { courseId: null, status: 'inActive' },
    });
    expect(prisma.forumThread.deleteMany).not.toHaveBeenCalled();
  });

  it('deactivates the course before touching SCORM Cloud', async () => {
    givenCleanScormCourse();
    const order: string[] = [];
    prisma.course.update.mockImplementation(async () => {
      order.push('deactivate');
      return {};
    });
    cloud.deleteCourse.mockImplementation(async () => {
      order.push('cloud');
    });

    await service.deleteCourse('course-1');

    expect(prisma.course.update).toHaveBeenCalledWith({
      where: { id: 'course-1' },
      data: { isActive: false },
    });
    expect(order).toEqual(['deactivate', 'cloud']);
  });

  it('does not re-delete a Cloud registration on the second sweep', async () => {
    givenCleanScormCourse();
    prisma.scormRegistration.findMany.mockResolvedValue([
      { id: 'row-reg-1', scormCloudRegistrationId: 'reg-1' },
    ]);

    const res = await service.deleteCourse('course-1', { force: true });

    // Two sweeps run (a launch in flight can land a registration after the
    // first), but an id already handled is never deleted twice.
    expect(prisma.scormRegistration.findMany).toHaveBeenCalledTimes(2);
    expect(cloud.deleteRegistration).toHaveBeenCalledTimes(1);
    expect((res.data as any).cloud.registrations).toBe(1);
  });

  it('picks up a registration created after the first sweep', async () => {
    givenCleanScormCourse();
    prisma.scormRegistration.findMany
      .mockResolvedValueOnce([
        { id: 'row-reg-1', scormCloudRegistrationId: 'reg-1' },
      ])
      .mockResolvedValueOnce([
        { id: 'row-reg-1', scormCloudRegistrationId: 'reg-1' },
        { id: 'row-reg-late', scormCloudRegistrationId: 'reg-late' },
      ]);

    const res = await service.deleteCourse('course-1', { force: true });

    expect(cloud.deleteRegistration).toHaveBeenCalledWith('reg-late');
    expect((res.data as any).cloud.registrationsDeleted).toBe(2);
  });

  /** One question of this course used in another course's assessment. */
  function givenSharedQuestionUse() {
    prisma.assessmentQuestion.count.mockResolvedValue(1);
    prisma.assessmentQuestion.groupBy.mockResolvedValue([
      { assessmentId: 'assess-other' },
    ]);
    prisma.assessment.findMany.mockImplementation(async (args: any) =>
      args.where.id
        ? [
            {
              id: 'assess-other',
              title: 'Final quiz',
              courseId: 'course-other',
              course: { title: 'Working at Height' },
            },
          ]
        : [],
    );
  }

  it("refuses without force when another course uses this course's questions, before touching Cloud", async () => {
    givenCleanScormCourse();
    givenSharedQuestionUse();

    const error: HttpException = await service
      .deleteCourse('course-1')
      .catch((e) => e);

    expect(error.getStatus()).toBe(409);
    const body = error.getResponse() as any;
    expect(body.error).toContain('Working at Height');
    expect(body.details.sharedQuestionUses).toBe(1);
    expect(body.details.sharedQuestionAssessments).toEqual([
      expect.objectContaining({
        assessmentId: 'assess-other',
        courseId: 'course-other',
      }),
    ]);
    expect(cloud.deleteCourse).not.toHaveBeenCalled();
    expect(prisma.assessmentQuestion.deleteMany).not.toHaveBeenCalled();
  });

  it('with force, unlinks the cross-course uses and reports them', async () => {
    givenCleanScormCourse();
    givenSharedQuestionUse();
    prisma.assessmentQuestion.deleteMany.mockImplementation(
      async (args: any) => (args.where.question ? { count: 1 } : { count: 0 }),
    );

    const res = await service.deleteCourse('course-1', {
      force: true,
      adminId: 'admin-1',
    });

    // Question is RESTRICT on AssessmentQuestion: without this arm the
    // question-bank delete would P2003 and roll the teardown back.
    expect(prisma.assessmentQuestion.deleteMany).toHaveBeenCalledWith({
      where: {
        question: { courseId: 'course-1' },
        assessment: { courseId: { not: 'course-1' } },
      },
    });
    expect((res.data as any).deleted.sharedQuestionUses).toBe(1);
    expect(courseVersionService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DELETE_SCORM_COURSE_FORCE',
        metadata: expect.objectContaining({ sharedQuestionUses: 1 }),
      }),
    );
  });

  it('says the course was left deactivated when teardown fails after the Cloud purge', async () => {
    givenCleanScormCourse();
    prisma.course.delete.mockRejectedValue(new Error('connection reset'));

    const error: HttpException = await service
      .deleteCourse('course-1')
      .catch((e) => e);

    expect(cloud.deleteCourse).toHaveBeenCalledWith('cloud-1');
    expect((error.getResponse() as any).error).toContain('left deactivated');
    // Cloud is gone — re-activating would hand learners dead launch links.
    expect(prisma.course.update).toHaveBeenCalledTimes(1);
    expect(prisma.course.update).toHaveBeenCalledWith({
      where: { id: 'course-1' },
      data: { isActive: false },
    });
  });

  it('skips the Cloud DeleteCourse for an already-pruned package', async () => {
    prisma.course.findUnique.mockResolvedValue(SCORM_COURSE);
    prisma.scormPackage.findMany.mockResolvedValue([
      {
        id: 'pkg-0',
        versionNumber: 1,
        status: ScormPackageStatus.PRUNED,
        scormCloudCourseId: 'cloud-old',
      },
      {
        id: 'pkg-1',
        versionNumber: 2,
        status: ScormPackageStatus.READY,
        scormCloudCourseId: 'cloud-new',
      },
    ]);

    await service.deleteCourse('course-1');

    expect(cloud.deleteCourse).toHaveBeenCalledTimes(1);
    expect(cloud.deleteCourse).toHaveBeenCalledWith('cloud-new');
  });

  it('still deletes locally when SCORM Cloud fails, and reports the orphans', async () => {
    givenCleanScormCourse();
    prisma.scormRegistration.findMany.mockResolvedValue([
      { id: 'row-reg-1', scormCloudRegistrationId: 'reg-1' },
    ]);
    // Non-transient refusals (a plain error, a 4xx) are reported as orphans.
    cloud.deleteRegistration.mockRejectedValue(new Error('boom'));
    cloud.deleteCourse.mockRejectedValue(new ScormCloudHttpError(403, 'no'));

    const res = await service.deleteCourse('course-1', { force: true });

    expect(prisma.course.delete).toHaveBeenCalled();
    expect((res.data as any).cloud.failures).toEqual([
      'registration:reg-1',
      'course:cloud-1',
    ]);
    expect(res.message).toContain('Cloud console');
  });

  it('treats a Cloud 404 as already-gone, not an orphan', async () => {
    // Real case: a package whose import job errored (SCORM Cloud course limit
    // reached) never created a Cloud course, so DELETE returns 404.
    givenCleanScormCourse();
    cloud.deleteCourse.mockRejectedValue(new ScormCloudHttpError(404, 'gone'));

    const res = await service.deleteCourse('course-1');

    expect((res.data as any).cloud.failures).toEqual([]);
    expect((res.data as any).cloud.cloudCoursesDeleted).toBe(1);
    expect(res.message).not.toContain('Cloud console');
  });

  it('previews cross-course question uses and requires force for them', async () => {
    givenCleanScormCourse();
    givenSharedQuestionUse();

    const res = await service.getCourseDeletionPreview('course-1');

    expect((res.data as any).learnerStateTotal).toBe(0);
    expect((res.data as any).sharedQuestionUses).toBe(1);
    expect((res.data as any).sharedQuestionAssessments[0].courseTitle).toBe(
      'Working at Height',
    );
    expect((res.data as any).canDeleteWithoutForce).toBe(false);
  });

  it('uses the ordered native teardown without touching SCORM Cloud', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-2',
      title: 'Native course',
      isActive: true,
      deliveryMode: CourseDeliveryMode.NATIVE,
    });
    prisma.scormPackage.findMany.mockResolvedValue([]);
    prisma.chapter.findMany.mockResolvedValue([]);

    await service.deleteCourse('course-2', { force: true });

    expect(cloud.deleteCourse).not.toHaveBeenCalled();
    expect(prisma.scormPackage.findMany).toHaveBeenCalled();
    expect(prisma.course.delete).toHaveBeenCalledWith({
      where: { id: 'course-2' },
    });
  });

  it('previews the blast radius without deleting anything', async () => {
    prisma.course.findUnique.mockResolvedValue(SCORM_COURSE);
    prisma.scormPackage.findMany.mockResolvedValue([
      {
        id: 'pkg-1',
        versionNumber: 1,
        status: ScormPackageStatus.READY,
        scormCloudCourseId: 'cloud-1',
      },
    ]);
    prisma.userCourse.count.mockResolvedValue(4);
    prisma.courseCompletion.count.mockResolvedValue(2);

    const res = await service.getCourseDeletionPreview('course-1');

    expect((res.data as any).learnerState.enrollments).toBe(4);
    expect((res.data as any).canDeleteWithoutForce).toBe(false);
    expect((res.data as any).sharedQuestionUses).toBe(0);
    expect(prisma.course.delete).not.toHaveBeenCalled();
    expect(cloud.deleteCourse).not.toHaveBeenCalled();
  });

  describe('resumable Cloud purge', () => {
    afterEach(() => jest.restoreAllMocks());

    function rows(n: number) {
      return Array.from({ length: n }, (_, i) => ({
        id: `row-${i}`,
        scormCloudRegistrationId: `reg-${i}`,
      }));
    }

    it('deletes each local registration row once Cloud confirms it gone (deleted or 404)', async () => {
      givenCleanScormCourse();
      prisma.scormRegistration.findMany
        .mockResolvedValueOnce(rows(3))
        .mockResolvedValue([]);
      cloud.deleteRegistration.mockImplementation(async (id: string) => {
        if (id === 'reg-1') throw new ScormCloudHttpError(404, 'gone');
        if (id === 'reg-2') throw new Error('Cloud 502');
      });

      await service.deleteCourse('course-1', { force: true });

      const deletedIds = prisma.scormRegistration.deleteMany.mock.calls
        .map((c: any[]) => c[0].where.id)
        .filter(Boolean);
      // reg-2 failed on Cloud: its row stays so a retry (or the teardown)
      // still knows the id.
      expect(deletedIds).toEqual(['row-0', 'row-1']);
    });

    it('runs at most 8 DeleteRegistration calls at once', async () => {
      givenCleanScormCourse();
      prisma.scormRegistration.findMany
        .mockResolvedValueOnce(rows(20))
        .mockResolvedValue([]);
      let inFlight = 0;
      let peak = 0;
      cloud.deleteRegistration.mockImplementation(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setImmediate(r));
        inFlight -= 1;
      });

      const res = await service.deleteCourse('course-1', { force: true });

      expect(cloud.deleteRegistration).toHaveBeenCalledTimes(20);
      expect(peak).toBe(8);
      expect((res.data as any).cloud.registrationsDeleted).toBe(20);
    });

    it('stops at the time budget with a retryable 409 and skips the local teardown', async () => {
      givenCleanScormCourse();
      let now = 1_000_000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      prisma.scormRegistration.findMany.mockResolvedValue(rows(3));
      cloud.deleteRegistration.mockImplementation(async () => {
        now += 40_000; // one slow call blows the ~25s budget
      });

      const error: HttpException = await service
        .deleteCourse('course-1', { force: true })
        .catch((e) => e);

      expect(error.getStatus()).toBe(409);
      const body = error.getResponse() as any;
      expect(body.code).toBe('SCORM_PURGE_INCOMPLETE');
      expect(body.retryable).toBe(true);
      expect(body.error).toContain('Retry');
      expect(body.details.cloud.registrationsDeleted).toBe(1);
      expect(body.details.cloud.registrationsRemaining).toBe(2);
      expect(cloud.deleteRegistration).toHaveBeenCalledTimes(1);
      // Progress is durable: the purged row is gone, the rest wait for a retry.
      expect(prisma.scormRegistration.deleteMany).toHaveBeenCalledWith({
        where: { id: 'row-0' },
      });
      // Registrations before the Cloud course; local teardown not started.
      expect(cloud.deleteCourse).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.course.delete).not.toHaveBeenCalled();
    });

    it('a retry only handles the rows left by the previous attempt', async () => {
      givenCleanScormCourse();
      prisma.scormRegistration.findMany
        .mockResolvedValueOnce(rows(3).slice(1))
        .mockResolvedValue([]);

      const res = await service.deleteCourse('course-1', { force: true });

      expect(cloud.deleteRegistration.mock.calls.map((c) => c[0])).toEqual([
        'reg-1',
        'reg-2',
      ]);
      expect(res.statusCode).toBe(200);
    });
  });

  it('passes the in-transaction shared-question 409 through, worded for an already-purged course', async () => {
    givenCleanScormCourse();
    prisma.assessmentQuestion.deleteMany.mockImplementation(
      async (args: any) => (args.where.question ? { count: 1 } : { count: 0 }),
    );

    const error: HttpException = await service
      .deleteCourse('course-1')
      .catch((e) => e);

    expect(error.getStatus()).toBe(409);
    const body = error.getResponse() as any;
    expect(body.error).toContain('while the delete was running');
    // No force ⇒ no registration was purged; say so rather than claim one.
    expect(body.error).toContain(
      'SCORM Cloud content was already removed (this request deleted no learner registrations)',
    );
    expect(body.error).not.toContain('learner registrations were already');
    expect(body.error).not.toContain('Nothing was deleted');
    expect(body.details.cloud.cloudCoursesDeleted).toBe(1);
    expect(prisma.course.delete).not.toHaveBeenCalled();
  });

  it('audits as forced when the purge removed a registration the gather missed', async () => {
    givenCleanScormCourse();
    // An in-flight launch landed a registration after the gather.
    prisma.scormRegistration.findMany
      .mockResolvedValueOnce([
        { id: 'row-late', scormCloudRegistrationId: 'reg-late' },
      ])
      .mockResolvedValue([]);

    await service.deleteCourse('course-1', { force: true, adminId: 'admin-1' });

    expect(courseVersionService.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE_SCORM_COURSE_FORCE' }),
    );
  });

  it('without force, refuses a registration that appeared after the gather instead of purging it', async () => {
    givenCleanScormCourse();
    prisma.scormRegistration.findMany.mockResolvedValue([
      { id: 'row-late', scormCloudRegistrationId: 'reg-late' },
    ]);

    const error: HttpException = await service
      .deleteCourse('course-1')
      .catch((e) => e);

    expect(error.getStatus()).toBe(409);
    expect((error.getResponse() as any).error).toContain('force: true');
    expect(cloud.deleteRegistration).not.toHaveBeenCalled();
    expect(cloud.deleteCourse).not.toHaveBeenCalled();
    expect(prisma.scormRegistration.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('transient SCORM Cloud failures', () => {
    it.each([
      ['a timeout', new ScormCloudTimeoutError('DeleteRegistration', 10_000)],
      ['a 5xx', new ScormCloudHttpError(503, 'unavailable')],
      ['a network failure', new ScormCloudNetworkError()],
    ])(
      'make a forced purge retryable on %s, keeping the row and the Cloud course',
      async (_label, failure) => {
        givenCleanScormCourse();
        prisma.scormRegistration.findMany.mockResolvedValue([
          { id: 'row-reg-1', scormCloudRegistrationId: 'reg-1' },
        ]);
        cloud.deleteRegistration.mockRejectedValue(failure);

        const error: HttpException = await service
          .deleteCourse('course-1', { force: true })
          .catch((e) => e);

        expect(error.getStatus()).toBe(409);
        const body = error.getResponse() as any;
        expect(body.code).toBe('SCORM_PURGE_INCOMPLETE');
        expect(body.details.cloud.retryableFailures).toEqual([
          'registration:reg-1',
        ]);
        expect(body.details.cloud.failures).toEqual([]);
        expect(body.details.cloud.registrationsRemaining).toBe(1);
        expect(prisma.scormRegistration.deleteMany).not.toHaveBeenCalled();
        expect(cloud.deleteCourse).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it('make the Cloud course delete retryable on a 5xx', async () => {
      givenCleanScormCourse();
      cloud.deleteCourse.mockRejectedValue(new ScormCloudHttpError(502, 'bad'));

      const error: HttpException = await service
        .deleteCourse('course-1')
        .catch((e) => e);

      const body = error.getResponse() as any;
      expect(body.code).toBe('SCORM_PURGE_INCOMPLETE');
      expect(body.details.cloud.retryableFailures).toEqual(['course:cloud-1']);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  it('checks the time budget before each Cloud course delete', async () => {
    givenCleanScormCourse();
    prisma.scormPackage.findMany.mockResolvedValue([
      {
        id: 'pkg-1',
        versionNumber: 1,
        status: ScormPackageStatus.READY,
        scormCloudCourseId: 'cloud-1',
      },
      {
        id: 'pkg-2',
        versionNumber: 2,
        status: ScormPackageStatus.READY,
        scormCloudCourseId: 'cloud-2',
      },
    ]);
    let now = 1_000_000;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    cloud.deleteCourse.mockImplementation(async () => {
      now += 30_000;
    });

    const error: HttpException = await service
      .deleteCourse('course-1')
      .catch((e) => e);
    spy.mockRestore();

    expect(cloud.deleteCourse).toHaveBeenCalledTimes(1);
    const body = error.getResponse() as any;
    expect(body.code).toBe('SCORM_PURGE_INCOMPLETE');
    expect(body.details.cloud.cloudCoursesDeleted).toBe(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('teardown failure after a completed Cloud purge', () => {
    it('marks the purged packages PRUNED before the teardown, so the publish gate refuses the course', async () => {
      givenCleanScormCourse();
      const order: string[] = [];
      prisma.scormPackage.updateMany.mockImplementation(async () => {
        order.push('prune');
        return { count: 1 };
      });
      prisma.$transaction.mockImplementation(async () => {
        order.push('teardown');
        throw new Error('connection reset');
      });

      await service.deleteCourse('course-1').catch(() => undefined);

      expect(prisma.scormPackage.updateMany).toHaveBeenCalledWith({
        where: {
          courseId: 'course-1',
          scormCloudCourseId: { in: ['cloud-1'] },
          status: { not: ScormPackageStatus.PRUNED },
        },
        data: { status: ScormPackageStatus.PRUNED },
      });
      expect(order).toEqual(['prune', 'teardown']);
    });

    it('does not mark a package whose Cloud course could not be deleted', async () => {
      givenCleanScormCourse();
      cloud.deleteCourse.mockRejectedValue(new ScormCloudHttpError(403, 'no'));

      await service.deleteCourse('course-1');

      expect(prisma.scormPackage.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      ['a non-HTTP failure', () => new Error('connection reset')],
      [
        'the in-transaction 409',
        () =>
          new HttpException({ status: 409, error: 'Refusing to delete' }, 409),
      ],
    ])('audits DELETE_SCORM_COURSE_PARTIAL on %s', async (_label, makeErr) => {
      givenCleanScormCourse();
      prisma.$transaction.mockRejectedValue(makeErr());

      await expect(
        service.deleteCourse('course-1', { force: true, adminId: 'admin-1' }),
      ).rejects.toBeInstanceOf(HttpException);

      expect(courseVersionService.writeAudit).toHaveBeenCalledTimes(1);
      expect(courseVersionService.writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELETE_SCORM_COURSE_PARTIAL',
          courseId: 'course-1',
          metadata: expect.objectContaining({
            force: true,
            learnerState: expect.any(Object),
            cloud: expect.objectContaining({ incomplete: false }),
            teardownError: expect.any(String),
          }),
        }),
      );
    });

    it('a retry does not re-delete the Cloud course of a PRUNED package', async () => {
      prisma.course.findUnique.mockResolvedValue({
        ...SCORM_COURSE,
        isActive: false,
      });
      prisma.scormPackage.findMany.mockResolvedValue([
        {
          id: 'pkg-1',
          versionNumber: 1,
          status: ScormPackageStatus.PRUNED,
          scormCloudCourseId: 'cloud-1',
        },
      ]);

      const res = await service.deleteCourse('course-1', { force: true });

      expect(res.statusCode).toBe(200);
      expect(cloud.deleteCourse).not.toHaveBeenCalled();
      expect(prisma.course.delete).toHaveBeenCalled();
    });
  });

  it('still starts one Cloud delete when the gather alone used up the budget', async () => {
    givenCleanScormCourse();
    let now = 1_000_000;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    prisma.scormRegistration.findMany.mockResolvedValue([
      { id: 'row-0', scormCloudRegistrationId: 'reg-0' },
      { id: 'row-1', scormCloudRegistrationId: 'reg-1' },
    ]);
    // The gather's first query is slow enough to exhaust the 25s budget.
    prisma.chapter.findMany.mockImplementation(async () => {
      now += 30_000;
      return [{ id: 'chapter-1' }];
    });

    const error: HttpException = await service
      .deleteCourse('course-1', { force: true })
      .catch((e) => e);
    spy.mockRestore();

    // Progress per retry, not none.
    expect(cloud.deleteRegistration).toHaveBeenCalledTimes(1);
    const body = error.getResponse() as any;
    expect(body.code).toBe('SCORM_PURGE_INCOMPLETE');
    expect(body.details.cloud.registrationsDeleted).toBe(1);
  });

  it('runs the SCORM teardown under the tighter transaction limits', async () => {
    givenCleanScormCourse();

    await service.deleteCourse('course-1');

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 15_000,
      maxWait: 4_000,
    });
  });

  describe('auditing a partial purge', () => {
    afterEach(() => jest.restoreAllMocks());

    it('audits the stopped attempt as DELETE_SCORM_COURSE_PARTIAL', async () => {
      givenCleanScormCourse();
      prisma.userCourse.count.mockResolvedValue(1);
      prisma.scormRegistration.findMany.mockResolvedValue([
        { id: 'row-reg-1', scormCloudRegistrationId: 'reg-1' },
      ]);
      cloud.deleteRegistration.mockRejectedValue(
        new ScormCloudTimeoutError('DeleteRegistration', 10_000),
      );

      await service
        .deleteCourse('course-1', { force: true, adminId: 'admin-1' })
        .catch(() => undefined);

      expect(courseVersionService.writeAudit).toHaveBeenCalledTimes(1);
      expect(courseVersionService.writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELETE_SCORM_COURSE_PARTIAL',
          courseId: 'course-1',
          metadata: expect.objectContaining({
            force: true,
            learnerState: expect.objectContaining({ enrollments: 1 }),
            cloud: expect.objectContaining({ incomplete: true }),
          }),
        }),
      );
    });

    it('logs a no-force finishing retry as FORCE when an earlier attempt was forced', async () => {
      // The forced attempt purged every registration and ran out of time on
      // the Cloud course; this retry gathers no learner state at all.
      givenCleanScormCourse();
      prisma.adminAuditLog.findMany.mockResolvedValue([
        {
          id: 'audit-partial-1',
          metadata: { force: true, cloud: { registrationsDeleted: 40 } },
        },
      ]);

      const res = await service.deleteCourse('course-1', {
        adminId: 'admin-1',
      });

      expect(res.statusCode).toBe(200);
      expect(courseVersionService.writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELETE_SCORM_COURSE_FORCE',
          metadata: expect.objectContaining({
            priorPartialAuditIds: ['audit-partial-1'],
          }),
        }),
      );
    });

    it('ignores partial attempts from before the newest package import', async () => {
      givenCleanScormCourse();
      const importedAt = new Date('2026-09-01T00:00:00Z');
      prisma.scormPackage.findMany.mockResolvedValue([
        {
          id: 'pkg-1',
          versionNumber: 1,
          status: ScormPackageStatus.READY,
          scormCloudCourseId: 'cloud-1',
          createdAt: importedAt,
        },
      ]);

      await service.deleteCourse('course-1', { adminId: 'admin-1' });

      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            action: 'DELETE_SCORM_COURSE_PARTIAL',
            createdAt: { gt: importedAt },
          }),
        }),
      );
    });

    it('measures "since" from the newest READY/PRUNED package, not a later FAILED attempt', async () => {
      // A partial destroy PRUNEs the READY package; a failed re-import after
      // it must not hide that partial attempt from the finishing request.
      givenCleanScormCourse();
      const importedAt = new Date('2026-09-01T00:00:00Z');
      prisma.scormPackage.findMany.mockResolvedValue([
        {
          id: 'pkg-1',
          versionNumber: 1,
          status: ScormPackageStatus.PRUNED,
          scormCloudCourseId: 'cloud-1',
          createdAt: importedAt,
        },
        {
          id: 'pkg-2',
          versionNumber: 2,
          status: ScormPackageStatus.FAILED,
          scormCloudCourseId: 'cloud-2',
          createdAt: new Date('2026-09-20T00:00:00Z'),
        },
      ]);

      await service.deleteCourse('course-1', { adminId: 'admin-1' });

      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            action: 'DELETE_SCORM_COURSE_PARTIAL',
            createdAt: { gt: importedAt },
          }),
        }),
      );
    });

    it('stays a plain delete when the earlier partial attempt was not forced', async () => {
      givenCleanScormCourse();
      prisma.adminAuditLog.findMany.mockResolvedValue([
        { id: 'audit-partial-1', metadata: { force: false, cloud: {} } },
      ]);

      await service.deleteCourse('course-1', { adminId: 'admin-1' });

      expect(courseVersionService.writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELETE_SCORM_COURSE' }),
      );
    });
  });

  describe('concurrent double delete', () => {
    const p2025 = () =>
      new Prisma.PrismaClientKnownRequestError(
        'Record to delete does not exist.',
        {
          code: 'P2025',
          clientVersion: '5.9.1',
        },
      );

    it('answers "already deleted" when the other request committed first', async () => {
      givenCleanScormCourse();
      prisma.course.delete.mockRejectedValue(p2025());

      const error: HttpException = await service
        .deleteCourse('course-1', { adminId: 'admin-1' })
        .catch((e) => e);

      expect(error.getStatus()).toBe(403);
      const body = error.getResponse() as any;
      expect(body.code).toBe('COURSE_ALREADY_DELETED');
      expect(body.error).toContain('Course not found');
      expect(body.error).not.toContain('local course records failed');
      expect(courseVersionService.writeAudit).not.toHaveBeenCalled();
    });

    it('answers "already deleted" to a retry that arrives after the other request committed', async () => {
      prisma.course.findUnique.mockResolvedValue(null);
      prisma.adminAuditLog.findFirst.mockResolvedValue({ id: 'audit-del' });

      const error: HttpException = await service
        .deleteCourse('course-1')
        .catch((e) => e);

      expect(error.getStatus()).toBe(403);
      expect((error.getResponse() as any).code).toBe('COURSE_ALREADY_DELETED');
      expect(prisma.adminAuditLog.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ courseId: 'course-1' }),
        }),
      );
    });

    it('keeps the plain "Course not found" for an id that was never deleted', async () => {
      prisma.course.findUnique.mockResolvedValue(null);

      const error: HttpException = await service
        .deleteCourse('course-1')
        .catch((e) => e);

      const body = error.getResponse() as any;
      expect(body.code).toBeUndefined();
      expect(body.error).toBe('Course not found');
    });

    it('also when the course vanished before the pre-purge deactivation', async () => {
      givenCleanScormCourse();
      prisma.course.update.mockRejectedValue(p2025());

      const error: HttpException = await service
        .deleteCourse('course-1')
        .catch((e) => e);

      expect((error.getResponse() as any).code).toBe('COURSE_ALREADY_DELETED');
      expect(cloud.deleteCourse).not.toHaveBeenCalled();
    });
  });
});
