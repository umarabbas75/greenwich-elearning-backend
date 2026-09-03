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
  let isPassedStamped = false;

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
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    isPassedStamped = false;
    prisma = {
      scormRegistration: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
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
        count: jest.fn().mockResolvedValue(0),
      },
      courseCompletion: {
        findUnique: jest.fn(),
        update: jest.fn().mockImplementation(async () => {
          isPassedStamped = true;
        }),
        upsert: jest.fn(),
      },
      section: {
        findUnique: jest.fn().mockResolvedValue({
          chapterId: 'ch-1',
          moduleId: 'mod-1',
          isArchived: false,
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
          sectionId: 'sec-1',
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      courseVersion: {
        findMany: jest.fn().mockResolvedValue([]),
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

    prisma.courseCompletion.findUnique.mockImplementation(async () => ({
      courseCompletedAt: new Date(),
      isPassed: isPassedStamped,
    }));

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
    const row = {
      ...baseRow,
      completionStatus: 'completed',
      successStatus: 'passed',
      completeOn: 'passed',
    };

    await service.applyProgressAndMaybeCertify(
      row as any,
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
    const row = {
      ...baseRow,
      completeOn: 'passed',
      completionStatus: 'completed',
      successStatus: 'failed',
    };
    isPassedStamped = false;

    await service.applyProgressAndMaybeCertify(
      row as any,
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
    prisma.scormRegistration.findMany.mockResolvedValue([baseRow]);
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

  it('fail-closes when Cloud 409s with no local row', async () => {
    prisma.section.findFirst.mockResolvedValue({
      id: 'sec-1',
      chapterId: 'ch-1',
      moduleId: 'mod-1',
      config: { packageId: 'pkg-1', completeOn: 'completed' },
    });
    prisma.scormRegistration.findUnique.mockResolvedValue(null);
    cloud.createRegistration.mockRejectedValue(
      new ScormCloudHttpError(409, 'exists'),
    );

    await expect(
      service.launch(
        {
          id: 'user-1',
          role: Role.user,
          firstName: 'A',
          lastName: 'B',
          deletedAt: null,
        } as any,
        { courseId: 'course-1' },
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('remaps unpinned floater from archived section to live SCORM section on certify', async () => {
    const row = {
      ...baseRow,
      sectionId: 'sec-old',
      completionStatus: 'completed',
      successStatus: 'passed',
    };
    prisma.scormPackage.findUnique.mockResolvedValue({
      sectionId: 'sec-old',
    });
    prisma.section.findUnique.mockResolvedValue({
      id: 'sec-old',
      chapterId: 'ch-old',
      moduleId: 'mod-old',
      isArchived: true,
    });
    prisma.userCourse.findFirst.mockResolvedValue({
      id: 'uc-1',
      enrolledVersionId: null,
    });
    prisma.section.findFirst.mockResolvedValue({
      id: 'sec-live',
      chapterId: 'ch-live',
      moduleId: 'mod-live',
    });

    await service.applyProgressAndMaybeCertify(
      row as any,
      { registrationCompletion: 'COMPLETED', registrationSuccess: 'PASSED' },
      { throwIfCertifyIncomplete: false },
    );

    expect(prisma.scormRegistration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'reg-1' },
        data: { sectionId: 'sec-live' },
      }),
    );
    expect(prisma.userCourseProgress.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sectionId: 'sec-live',
        chapterId: 'ch-live',
        moduleId: 'mod-live',
      }),
    });
  });

  it('does not certify when completeOn is passed and success remains failed', async () => {
    const row = {
      ...baseRow,
      completeOn: 'passed',
      completionStatus: 'completed',
      successStatus: 'failed',
    };

    await service.applyProgressAndMaybeCertify(
      row as any,
      {
        registrationCompletion: 'COMPLETED',
        registrationSuccess: 'FAILED',
      },
      { throwIfCertifyIncomplete: false },
    );

    expect(courseCompletion.checkContentCompletion).not.toHaveBeenCalled();
    expect(prisma.courseCompletion.update).not.toHaveBeenCalled();
  });

  it('stamps isPassed for completeOn completed even when SCORM success is failed', async () => {
    const row = {
      ...baseRow,
      completeOn: 'completed',
      completionStatus: 'completed',
      successStatus: 'failed',
    };
    isPassedStamped = false;
    prisma.courseCompletion.findUnique.mockResolvedValue({
      courseCompletedAt: new Date(),
      isPassed: false,
    });

    await service.applyProgressAndMaybeCertify(
      row as any,
      {
        registrationCompletion: 'COMPLETED',
        registrationSuccess: 'FAILED',
      },
      { throwIfCertifyIncomplete: false },
    );

    expect(prisma.courseCompletion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isPassed: true }),
      }),
    );
  });

  it('prunes superseded packages when no in-progress registrations or pinned learners', async () => {
    prisma.scormPackage.findMany.mockResolvedValue([
      {
        id: 'pkg-old',
        courseId: 'course-1',
        sectionId: 'sec-old',
        scormCloudCourseId: 'cloud-old',
      },
    ]);
    prisma.scormRegistration.count.mockResolvedValue(0);
    prisma.courseVersion.findMany.mockResolvedValue([
      {
        id: 'v-1',
        manifest: {
          modules: [
            {
              chapters: [{ sections: [{ id: 'sec-old' }] }],
            },
          ],
        },
      },
    ]);
    prisma.userCourse.count.mockResolvedValue(0);
    prisma.scormRegistration.findMany.mockResolvedValue([
      { scormCloudRegistrationId: 'cloud-reg-old' },
    ]);
    cloud.deleteCourse = jest.fn().mockResolvedValue(undefined);
    cloud.deleteRegistration = jest.fn().mockResolvedValue(undefined);

    const result = await service.pruneSupersededPackagesCron();

    expect(result).toEqual({ candidates: 1, pruned: 1 });
    expect(cloud.deleteCourse).toHaveBeenCalledWith('cloud-old');
    expect(prisma.scormPackage.update).toHaveBeenCalledWith({
      where: { id: 'pkg-old' },
      data: { status: ScormPackageStatus.PRUNED },
    });
  });

  it('does not clobber scoreScaled when reconcile Cloud payload omits score', async () => {
    const staleRow = { ...baseRow, scoreScaled: 50 };
    prisma.$queryRaw.mockResolvedValue([{ id: 'reg-1' }]);
    prisma.scormRegistration.findMany.mockResolvedValue([staleRow]);
    prisma.scormRegistration.findUnique.mockResolvedValue({
      ...baseRow,
      scoreScaled: 90,
    });
    cloud.getRegistrationProgress.mockResolvedValue({
      registrationCompletion: 'INCOMPLETE',
    });

    await service.reconcileCron();

    const updateCall = prisma.scormRegistration.update.mock.calls.at(-1)?.[0];
    expect(updateCall?.data?.scoreScaled).toBeUndefined();
  });
});
