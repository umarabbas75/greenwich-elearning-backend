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

/**
 * The admin list must say WHY an imported SCORM course is unpublishable.
 * "Unpublished / 0 units" alone reads identically for a failed import, an
 * in-flight import, and a healthy draft — which is how a course whose Cloud
 * import died on the account's course limit looked like a platform bug.
 */
describe('CourseService — SCORM import state on the admin course list', () => {
  let service: CourseService;
  let prisma: Record<string, any>;

  const baseCourse = {
    description: '',
    image: '',
    overview: '',
    duration: '',
    assessment: '',
    syllabusOverview: '',
    resourcesOverview: '',
    _count: { modules: 0, users: 0 },
    courseVersions: [],
  };

  beforeEach(async () => {
    prisma = {
      course: { findMany: jest.fn() },
      userCourse: { groupBy: jest.fn().mockResolvedValue([]) },
      scormPackage: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: MailService, useValue: { send: jest.fn() } },
        { provide: FeedbackService, useValue: {} },
        { provide: CourseVersionService, useValue: {} },
        { provide: CourseCompletionService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: ScormCloudClient, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(CourseService);
  });

  it('reports the failed import reason instead of a silent 0-unit row', async () => {
    prisma.course.findMany.mockResolvedValue([
      {
        ...baseCourse,
        id: 'course-1',
        title: 'Failure Modes and Effects Analysis',
        isActive: false,
        deliveryMode: CourseDeliveryMode.IMPORTED_SCORM,
      },
    ]);
    prisma.scormPackage.findMany.mockResolvedValue([
      {
        id: 'pkg-1',
        courseId: 'course-1',
        versionNumber: 1,
        status: 'FAILED',
        failureReason:
          'The maximum number of courses for this account type has been reached.',
        importWarning: null,
        sectionId: null,
      },
    ]);

    const res = await service.getAllCourses();
    const row = (res.data as any[])[0];

    expect(row.scormImport).toEqual({
      packageId: 'pkg-1',
      versionNumber: 1,
      status: 'FAILED',
      failureReason:
        'The maximum number of courses for this account type has been reached.',
      importWarning: null,
      hasSection: false,
    });
  });

  it('keeps only the latest package version per course', async () => {
    prisma.course.findMany.mockResolvedValue([
      {
        ...baseCourse,
        id: 'course-1',
        title: 'Retried import',
        isActive: false,
        deliveryMode: CourseDeliveryMode.IMPORTED_SCORM,
      },
    ]);
    prisma.scormPackage.findMany.mockResolvedValue([
      {
        id: 'pkg-2',
        courseId: 'course-1',
        versionNumber: 2,
        status: 'PROCESSING',
        failureReason: null,
        importWarning: null,
        sectionId: null,
      },
      {
        id: 'pkg-1',
        courseId: 'course-1',
        versionNumber: 1,
        status: 'FAILED',
        failureReason: 'old failure',
        importWarning: null,
        sectionId: null,
      },
    ]);

    const res = await service.getAllCourses();

    expect((res.data as any[])[0].scormImport).toMatchObject({
      packageId: 'pkg-2',
      status: 'PROCESSING',
    });
  });

  it('leaves native courses alone and never queries packages for them', async () => {
    prisma.course.findMany.mockResolvedValue([
      {
        ...baseCourse,
        id: 'course-2',
        title: 'Native course',
        isActive: true,
        deliveryMode: CourseDeliveryMode.NATIVE,
      },
    ]);

    const res = await service.getAllCourses();

    expect((res.data as any[])[0].scormImport).toBeNull();
    expect(prisma.scormPackage.findMany).not.toHaveBeenCalled();
  });
});
