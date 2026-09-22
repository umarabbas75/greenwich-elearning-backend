import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CourseDeliveryMode } from '@prisma/client';
import { CourseVersionService } from '../course-version/course-version.service';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { FeedbackService } from '../feedback/feedback.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScormCloudClient } from '../scorm-cloud/scorm-cloud.client';
import { CourseService } from './course.service';
import { IMPORTED_SCORM_TREE_LOCKED_MESSAGE } from '../utils/assert-imported-course-tree-locked';

describe('CourseService — imported SCORM guards', () => {
  let service: CourseService;
  let prisma: Record<string, any>;
  let cloud: Record<string, jest.Mock>;

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      course: {
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      module: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      chapter: { findUnique: jest.fn() },
      section: { findUnique: jest.fn(), findMany: jest.fn() },
      scormPackage: { findFirst: jest.fn() },
      userCourse: { findFirst: jest.fn(), delete: jest.fn() },
      userCourseProgress: { count: jest.fn().mockResolvedValue(0) },
      userChapterCompletion: { count: jest.fn().mockResolvedValue(0) },
      userModuleCompletion: { count: jest.fn().mockResolvedValue(0) },
      courseCompletion: { findUnique: jest.fn().mockResolvedValue(null) },
      sectionTimeSpent: { count: jest.fn().mockResolvedValue(0) },
      lastSeenSection: { count: jest.fn().mockResolvedValue(0) },
      quizProgress: { count: jest.fn().mockResolvedValue(0) },
      quizAnswer: { count: jest.fn().mockResolvedValue(0) },
      userFormCompletion: { count: jest.fn().mockResolvedValue(0) },
      userPolicyCompletion: { count: jest.fn().mockResolvedValue(0) },
      userPolicyItemCompletion: { count: jest.fn().mockResolvedValue(0) },
      courseFeedbackSubmission: { count: jest.fn().mockResolvedValue(0) },
      assessmentAttempt: { count: jest.fn().mockResolvedValue(0) },
      assessment: { findMany: jest.fn().mockResolvedValue([]) },
      scormRegistration: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(async (ops: any) => {
        if (typeof ops === 'function') return ops(prisma);
        return Promise.all(ops);
      }),
    };

    // wipeUserCourseState walks ~13 tables; the guard tests above only care
    // that it is never reached, and the unassign tests below only assert the
    // SCORM rows. Give every other table a no-op deleteMany so neither has to
    // restate the full enumeration.
    for (const model of [
      'userCourseProgress',
      'lastSeenSection',
      'quizProgress',
      'quizAnswer',
      'userFormCompletion',
      'userPolicyCompletion',
      'userPolicyItemCompletion',
      'courseFeedbackSubmission',
      'courseCompletion',
      'userChapterCompletion',
      'userModuleCompletion',
      'sectionTimeSpent',
      'assessmentAttempt',
    ]) {
      prisma[model] = prisma[model] ?? {};
      prisma[model].deleteMany = jest.fn().mockResolvedValue({ count: 0 });
      prisma[model].updateMany = jest.fn().mockResolvedValue({ count: 0 });
    }
    prisma.chapter.findMany = jest.fn().mockResolvedValue([]);

    cloud = {
      deleteRegistration: jest.fn().mockResolvedValue(undefined),
      deleteCourse: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: MailService, useValue: { send: jest.fn() } },
        {
          provide: FeedbackService,
          useValue: { notifyFeedbackRequiredIfNeeded: jest.fn() },
        },
        {
          provide: CourseVersionService,
          useValue: {
            autoPublishAfterStructuralChange: jest.fn(),
            getReferencingVersionsWithEnrollments: jest.fn(),
            writeAudit: jest.fn(),
          },
        },
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
        { provide: ScormCloudClient, useValue: cloud },
      ],
    }).compile();

    service = moduleRef.get(CourseService);
  });

  it('setCourseActive refuses isActive true on IMPORTED_SCORM with no live SCORM section', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      deliveryMode: CourseDeliveryMode.IMPORTED_SCORM,
    });
    prisma.section.findMany.mockResolvedValue([]);

    await expect(service.setCourseActive('course-1', true)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it('createModule is rejected on IMPORTED_SCORM', async () => {
    prisma.course.findUnique.mockResolvedValue({
      deliveryMode: CourseDeliveryMode.IMPORTED_SCORM,
    });

    await expect(
      service.createModule({ id: 'course-1', title: 'X', description: '' } as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: IMPORTED_SCORM_TREE_LOCKED_MESSAGE,
      }),
    });
    expect(prisma.module.create).not.toHaveBeenCalled();
  });

  describe('unassign on IMPORTED_SCORM', () => {
    const scormLearner = () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.course.findUnique.mockResolvedValue({
        id: 'course-1',
        deliveryMode: CourseDeliveryMode.IMPORTED_SCORM,
      });
      prisma.userCourse.findFirst.mockResolvedValue({
        id: 'uc-1',
        enrolledVersionId: 'v-1',
      });
    };

    /**
     * A launched SCORM learner has a registration and often nothing else — no
     * section progress, no quiz rows. The probe has to see that as residual
     * state or the unforced path would delete the enrollment and leave the
     * registration behind, which is the whole reason v1 refused this outright.
     */
    it('is refused without force when the learner has only a SCORM registration', async () => {
      scormLearner();
      prisma.scormRegistration.count.mockResolvedValue(1);

      await expect(
        service.unAssignCourse('user-1', 'course-1'),
      ).rejects.toMatchObject({ response: { status: 409 } });
      expect(prisma.userCourse.delete).not.toHaveBeenCalled();
      expect(prisma.scormRegistration.deleteMany).not.toHaveBeenCalled();
    });

    it('force deletes the registration row and the Cloud registration', async () => {
      scormLearner();
      prisma.scormRegistration.count.mockResolvedValue(1);
      prisma.scormRegistration.findMany.mockResolvedValue([
        { scormCloudRegistrationId: 'cloud-reg-1' },
      ]);
      prisma.scormRegistration.deleteMany.mockResolvedValue({ count: 1 });

      const res = await service.unAssignCourse('user-1', 'course-1', {
        force: true,
        adminId: 'admin-1',
      });

      expect(prisma.scormRegistration.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', courseId: 'course-1' },
      });
      expect(prisma.userCourse.delete).toHaveBeenCalledWith({
        where: { id: 'uc-1' },
      });
      expect(cloud.deleteRegistration).toHaveBeenCalledWith('cloud-reg-1');
      expect(res.statusCode).toBe(200);
      expect((res.data as any).scormCloud).toMatchObject({
        registrations: 1,
        registrationsDeleted: 1,
        failures: [],
      });
    });

    /**
     * Local state is already committed by the time Cloud is called, so the
     * learner IS unassigned — failing the request would tell the admin the
     * opposite. The leftover id has to reach them instead.
     */
    it('reports a Cloud delete failure without failing the unassign', async () => {
      scormLearner();
      prisma.scormRegistration.count.mockResolvedValue(1);
      prisma.scormRegistration.findMany.mockResolvedValue([
        { scormCloudRegistrationId: 'cloud-reg-1' },
      ]);
      prisma.scormRegistration.deleteMany.mockResolvedValue({ count: 1 });
      cloud.deleteRegistration.mockRejectedValue(new Error('Cloud 500'));

      const res = await service.unAssignCourse('user-1', 'course-1', {
        force: true,
        adminId: 'admin-1',
      });

      expect(res.statusCode).toBe(200);
      expect(prisma.userCourse.delete).toHaveBeenCalled();
      expect((res.data as any).scormCloud.failures).toEqual([
        'registration:cloud-reg-1',
      ]);
      expect(res.message).toContain('Cloud console');
    });

    it('does not call Cloud when a native course has no registrations', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.course.findUnique.mockResolvedValue({
        id: 'course-1',
        deliveryMode: CourseDeliveryMode.NATIVE,
      });
      prisma.userCourse.findFirst.mockResolvedValue({
        id: 'uc-1',
        enrolledVersionId: null,
      });

      await service.unAssignCourse('user-1', 'course-1');

      expect(cloud.deleteRegistration).not.toHaveBeenCalled();
      expect(prisma.userCourse.delete).toHaveBeenCalled();
    });
  });

  it('reset progress is refused on IMPORTED_SCORM', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ role: 'admin' })
      .mockResolvedValueOnce({ id: 'user-1', deletedAt: null });
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      deliveryMode: CourseDeliveryMode.IMPORTED_SCORM,
    });

    await expect(
      service.resetUserCourseProgress('admin-1', 'user-1', 'course-1'),
    ).rejects.toMatchObject({
      response: { status: 409 },
    });
  });
});
