import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role, ScormPackageStatus } from '@prisma/client';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { CourseVersionService } from '../course-version/course-version.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { ScormCloudClient, ScormCloudHttpError } from '../scorm-cloud/scorm-cloud.client';
import { ScormRuntimeService } from './scorm-runtime.service';

jest.mock('../utils/chapter-progression', () => ({
  recordChapterAndModuleCompletionIfNeeded: jest
    .fn()
    .mockResolvedValue(undefined),
}));

describe('ScormRuntimeService', () => {
  let service: ScormRuntimeService;
  let prisma: Record<string, any>;
  let cloud: Record<string, jest.Mock>;
  let courseCompletion: { checkContentCompletion: jest.Mock };

  const baseRow = {
    id: 'reg-1',
    userId: 'user-1',
    courseId: 'course-1',
    packageId: 'pkg-1',
    sectionId: 'sec-1',
    completeOn: 'completed',
    scormCloudRegistrationId: 'cloud-reg-1',
    completionStatus: 'unknown',
    successStatus: 'unknown',
    scoreScaled: null,
    totalTimeSeconds: null,
    firstLaunchAt: new Date(),
    lastPostbackAt: null,
    completedAt: null,
  };

  beforeEach(async () => {
    prisma = {
      scormRegistration: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(async ({ data }) => ({ ...baseRow, ...data })),
        create: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          role: Role.user,
          deletedAt: null,
        }),
      },
      userCourse: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'uc-1',
          userId: 'user-1',
          courseId: 'course-1',
          isActive: true,
        }),
      },
      courseCompletion: {
        findUnique: jest.fn().mockResolvedValue({
          courseCompletedAt: new Date(),
          isPassed: true,
        }),
        upsert: jest.fn(),
      },
      section: {
        findUnique: jest.fn().mockResolvedValue({
          chapterId: 'ch-1',
          moduleId: 'mod-1',
        }),
        findFirst: jest.fn(),
      },
      userCourseProgress: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      lastSeenSection: { upsert: jest.fn() },
      course: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'course-1',
          isActive: true,
          deliveryMode: 'IMPORTED_SCORM',
          validityDays: 365,
        }),
      },
      scormPackage: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pkg-1',
          status: ScormPackageStatus.READY,
          scormCloudCourseId: 'cloud-course-1',
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    cloud = {
      createRegistration: jest.fn().mockResolvedValue(undefined),
      buildRegistrationLaunchLink: jest
        .fn()
        .mockResolvedValue('https://cloud.scorm.com/launch/x'),
      getRegistrationProgress: jest.fn(),
      deleteRegistration: jest.fn(),
    };

    courseCompletion = {
      checkContentCompletion: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ScormRuntimeService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                PUBLIC_APP_URL: 'https://api.example.com',
                PUBLIC_FRONTEND_URL: 'https://app.example.com',
                SCORM_POSTBACK_AUTH_USER: 'u',
                SCORM_POSTBACK_AUTH_PASSWORD: 'p',
              })[key],
          },
        },
        { provide: ScormCloudClient, useValue: cloud },
        {
          provide: CourseVersionService,
          useValue: { resolveCurriculumTree: jest.fn().mockResolvedValue({ mode: 'live' }) },
        },
        { provide: CourseCompletionService, useValue: courseCompletion },
      ],
    }).compile();

    service = moduleRef.get(ScormRuntimeService);
  });

  it('rejects an unknown postback id with 5xx', async () => {
    prisma.scormRegistration.findUnique.mockResolvedValue(null);
    await expect(
      service.handlePostback({ id: 'missing', registrationCompletion: 'COMPLETED' }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('does not create a second UserCourseProgress on a repeated postback', async () => {
    prisma.scormRegistration.findUnique.mockResolvedValue(baseRow);
    prisma.userCourseProgress.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'prog-1' });

    await service.handlePostback({
      id: 'cloud-reg-1',
      registrationCompletion: 'COMPLETED',
      registrationSuccess: 'UNKNOWN',
    });
    await service.handlePostback({
      id: 'cloud-reg-1',
      registrationCompletion: 'COMPLETED',
      registrationSuccess: 'UNKNOWN',
    });

    expect(prisma.userCourseProgress.create).toHaveBeenCalledTimes(1);
    expect(courseCompletion.checkContentCompletion).toHaveBeenCalled();
  });

  it('never regresses completion or success status', async () => {
    prisma.scormRegistration.findUnique.mockResolvedValue({
      ...baseRow,
      completionStatus: 'completed',
      successStatus: 'passed',
      completeOn: 'passed',
    });

    await service.applyProgressAndMaybeCertify(
      'reg-1',
      {
        id: 'cloud-reg-1',
        registrationCompletion: 'INCOMPLETE',
        registrationSuccess: 'FAILED',
      },
      { throwIfCertifyIncomplete: false },
    );

    const update = prisma.scormRegistration.update.mock.calls[0][0];
    expect(update.data.completionStatus).toBe('completed');
    expect(update.data.successStatus).toBe('passed');
  });

  it('allows failed → passed (success rank is one-way absorbing at passed)', async () => {
    prisma.scormRegistration.findUnique.mockResolvedValue({
      ...baseRow,
      completeOn: 'passed',
      completionStatus: 'completed',
      successStatus: 'failed',
    });

    await service.applyProgressAndMaybeCertify(
      'reg-1',
      {
        registrationCompletion: 'COMPLETED',
        registrationSuccess: 'PASSED',
        score: { scaled: 90 },
      },
      { throwIfCertifyIncomplete: false },
    );

    const update = prisma.scormRegistration.update.mock.calls[0][0];
    expect(update.data.successStatus).toBe('passed');
    expect(update.data.scoreScaled).toBe(90);
  });

  it('reconcile query is batched', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'reg-1' }]);
    prisma.scormRegistration.findUnique.mockResolvedValue(baseRow);
    cloud.getRegistrationProgress.mockResolvedValue({
      registrationCompletion: 'INCOMPLETE',
    });

    const result = await service.reconcileCron();
    expect(result.candidates).toBe(1);
    expect(cloud.getRegistrationProgress).toHaveBeenCalledTimes(1);
  });

  it('still launches when Cloud CreateRegistration returns 409 and a local row exists', async () => {
    prisma.section.findFirst.mockResolvedValue({
      id: 'sec-1',
      chapterId: 'ch-1',
      moduleId: 'mod-1',
      config: { packageId: 'pkg-1', completeOn: 'completed' },
    });
    prisma.scormRegistration.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...baseRow,
        firstLaunchAt: new Date(),
      });
    cloud.createRegistration.mockRejectedValue(
      new ScormCloudHttpError(409, 'exists'),
    );

    const result = await service.launch(
      {
        id: 'user-1',
        role: Role.user,
        firstName: 'A',
        lastName: 'B',
        deletedAt: null,
      } as any,
      { courseId: 'course-1' },
    );

    expect(result.launchLink).toContain('cloud.scorm.com');
    expect(cloud.buildRegistrationLaunchLink).toHaveBeenCalled();
    expect(cloud.deleteRegistration).not.toHaveBeenCalled();
  });
});
