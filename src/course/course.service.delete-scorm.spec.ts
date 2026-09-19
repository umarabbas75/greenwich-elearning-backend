import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CourseDeliveryMode, ScormPackageStatus } from '@prisma/client';
import { CourseVersionService } from '../course-version/course-version.service';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { FeedbackService } from '../feedback/feedback.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ScormCloudClient,
  ScormCloudHttpError,
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
      };
    }
    return models[name];
  };

  const base: Record<string, any> = {
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
      { scormCloudRegistrationId: 'reg-1' },
      { scormCloudRegistrationId: 'reg-2' },
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
      { scormCloudRegistrationId: 'reg-1' },
    ]);

    const res = await service.deleteCourse('course-1');

    // Two sweeps run (a launch in flight can land a registration after the
    // first), but an id already handled is never deleted twice.
    expect(prisma.scormRegistration.findMany).toHaveBeenCalledTimes(2);
    expect(cloud.deleteRegistration).toHaveBeenCalledTimes(1);
    expect((res.data as any).cloud.registrations).toBe(1);
  });

  it('picks up a registration created after the first sweep', async () => {
    givenCleanScormCourse();
    prisma.scormRegistration.findMany
      .mockResolvedValueOnce([{ scormCloudRegistrationId: 'reg-1' }])
      .mockResolvedValueOnce([
        { scormCloudRegistrationId: 'reg-1' },
        { scormCloudRegistrationId: 'reg-late' },
      ]);

    const res = await service.deleteCourse('course-1');

    expect(cloud.deleteRegistration).toHaveBeenCalledWith('reg-late');
    expect((res.data as any).cloud.registrationsDeleted).toBe(2);
  });

  it('clears question junction rows held by other courses assessments', async () => {
    givenCleanScormCourse();

    await service.deleteCourse('course-1');

    const where = prisma.assessmentQuestion.deleteMany.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ question: { courseId: 'course-1' } });
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
      { scormCloudRegistrationId: 'reg-1' },
    ]);
    cloud.deleteRegistration.mockRejectedValue(new Error('Cloud 502'));
    cloud.deleteCourse.mockRejectedValue(new Error('Cloud 502'));

    const res = await service.deleteCourse('course-1');

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

  it('leaves the native course delete path untouched', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-2',
      title: 'Native course',
      deliveryMode: CourseDeliveryMode.NATIVE,
    });

    await service.deleteCourse('course-2', { force: true });

    expect(cloud.deleteCourse).not.toHaveBeenCalled();
    expect(prisma.scormPackage.findMany).not.toHaveBeenCalled();
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
    expect(prisma.course.delete).not.toHaveBeenCalled();
    expect(cloud.deleteCourse).not.toHaveBeenCalled();
  });
});
