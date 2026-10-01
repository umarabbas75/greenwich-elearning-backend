import { readFileSync } from 'fs';
import { join } from 'path';
import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, Role, ScormPackageStatus } from '@prisma/client';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { CourseVersionService } from '../course-version/course-version.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import {
  ScormCloudClient,
  ScormCloudHttpError,
} from '../scorm-cloud/scorm-cloud.client';
import { ScormRuntimeService } from './scorm-runtime.service';

import { recordChapterAndModuleCompletionIfNeeded } from '../utils/chapter-progression';

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
  let courseVersionService: Record<string, jest.Mock>;
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
        // stampCompletionDenominator re-reads the row for its certify snapshot.
        findFirstOrThrow: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(async ({ data }) => ({ ...baseRow, ...data })),
        // Conditional writes: completedAt, the certify snapshot, the pull claim.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
          id: 'sec-1',
          chapterId: 'ch-1',
          moduleId: 'mod-1',
          isArchived: false,
        }),
        findFirst: jest.fn(),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'sec-1', chapterId: 'ch-1', moduleId: 'mod-1' },
          ]),
      },
      userCourseProgress: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      lastSeenSection: {
        upsert: jest.fn(),
        // lastSeenPointerIsStale reads this before deciding whether to repair.
        findUnique: jest.fn().mockResolvedValue(null),
      },
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

    courseVersionService = {
      resolveCurriculumTree: jest.fn().mockResolvedValue({ mode: 'live' }),
      // The completion bridge stamps whatever the GATE counts, so this mock
      // must answer as the gate does — see stampCompletionDenominator.
      countCompletionDenominator: jest.fn().mockResolvedValue({
        total: 1,
        liveSectionIds: ['sec-1'],
        quizBearingChapterIds: [],
      }),
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
        { provide: CourseVersionService, useValue: courseVersionService },
        { provide: CourseCompletionService, useValue: courseCompletion },
      ],
    }).compile();

    service = moduleRef.get(ScormRuntimeService);
  });

  it('rejects an unknown postback id with 5xx', async () => {
    prisma.scormRegistration.findUnique.mockResolvedValue(null);
    await expect(
      service.handlePostback({
        id: 'missing',
        registrationCompletion: 'COMPLETED',
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  /**
   * Cloud retries a postback whenever certification is incomplete (a 5xx), so
   * the bridge runs repeatedly for one learner. Idempotence used to rest on a
   * read-then-create; it now rests on `skipDuplicates` against the
   * (userId, courseId, chapterId, sectionId) unique — which also holds under
   * two retries landing concurrently, where the read-then-create did not.
   */
  it('re-stamping on a repeated postback inserts no duplicate progress', async () => {
    prisma.scormRegistration.findUnique.mockResolvedValue(baseRow);

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

    expect(prisma.userCourseProgress.createMany).toHaveBeenCalledTimes(2);
    for (const [args] of prisma.userCourseProgress.createMany.mock.calls) {
      expect(args.skipDuplicates).toBe(true);
    }
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
    expect(cloud.buildRegistrationLaunchLink).toHaveBeenCalledWith({
      registrationId: expect.any(String),
      redirectOnExitUrl:
        'https://app.example.com/studentCourses/course-1/scorm',
      expiry: 120,
    });
    expect(cloud.deleteRegistration).not.toHaveBeenCalled();
  });

  describe('resume pointer on launch', () => {
    const launchAsLearner = () =>
      service.launch(
        {
          id: 'user-1',
          role: Role.user,
          firstName: 'A',
          lastName: 'B',
          deletedAt: null,
        } as any,
        { courseId: 'course-1' },
      );

    const setupLaunch = () => {
      prisma.section.findFirst.mockResolvedValue({
        id: 'sec-1',
        chapterId: 'ch-1',
        moduleId: 'mod-1',
        config: { packageId: 'pkg-1', completeOn: 'completed' },
      });
      prisma.scormRegistration.findUnique.mockResolvedValue({
        ...baseRow,
        firstLaunchAt: new Date(),
      });
    };

    /**
     * The progress path moves this pointer to the learner's real bookmark.
     * Overwriting on every launch would rewind them to lesson 1 each time.
     */
    it('leaves a live pointer alone', async () => {
      setupLaunch();
      prisma.lastSeenSection.findUnique.mockResolvedValue({
        sectionId: 'sec-7',
      });
      prisma.section.findUnique.mockResolvedValue({
        isActive: true,
        isArchived: false,
      });

      await launchAsLearner();

      expect(prisma.lastSeenSection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: {} }),
      );
    });

    /**
     * A package replace or the backfill archives the section the pointer holds
     * while leaving the row intact. Launch is the only writer that can fix it.
     */
    it('repairs a pointer left on an archived section', async () => {
      setupLaunch();
      prisma.lastSeenSection.findUnique.mockResolvedValue({
        sectionId: 'sec-archived',
      });
      prisma.section.findUnique.mockResolvedValue({
        isActive: true,
        isArchived: true,
      });

      await launchAsLearner();

      expect(prisma.lastSeenSection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { sectionId: 'sec-1' } }),
      );
    });

    it('repairs when the pointed-at section no longer exists', async () => {
      setupLaunch();
      prisma.lastSeenSection.findUnique.mockResolvedValue({
        sectionId: 'sec-gone',
      });
      prisma.section.findUnique.mockResolvedValue(null);

      await launchAsLearner();

      expect(prisma.lastSeenSection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { sectionId: 'sec-1' } }),
      );
    });
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

    /*
     * The stamp now comes from countCompletionDenominator, which already
     * resolves pinned vs live correctly — so the remap above is bookkeeping on
     * the registration row, and the progress rows follow the GATE's answer
     * rather than this file's. Asserting the gate's ids is what guarantees
     * `progressed.length < totalSections` cannot fail.
     */
    expect(prisma.userCourseProgress.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            sectionId: 'sec-1',
            chapterId: 'ch-1',
            moduleId: 'mod-1',
          }),
        ],
        skipDuplicates: true,
      }),
    );
  });

  describe('completion bridge — D4 denominator stamping', () => {
    /** 14-lesson curriculum, learner decoded at 3. */
    const setupLessonCourse = () => {
      const sections = Array.from({ length: 14 }, (_, i) => ({
        id: `sec-${i}`,
        chapterId: 'ch-1',
        moduleId: 'mod-1',
      }));
      courseVersionService.countCompletionDenominator.mockResolvedValue({
        total: 14,
        liveSectionIds: sections.map((s) => s.id),
        quizBearingChapterIds: [],
      });
      prisma.section.findMany.mockResolvedValue(sections);
      return sections;
    };

    /**
     * The deadlock D4 exists to prevent: the gate requires a progress row for
     * EVERY section, so stamping one of fourteen would leave a Cloud-complete
     * learner permanently uncertified.
     */
    it('stamps every section the gate counts, not just one', async () => {
      const sections = setupLessonCourse();
      prisma.scormRegistration.findUnique.mockResolvedValue({
        lessonsCompleted: 3,
        lessonsCompletedAtCertify: null,
      });

      await service.applyProgressAndMaybeCertify(
        {
          ...baseRow,
          completionStatus: 'completed',
          successStatus: 'passed',
        } as any,
        { registrationCompletion: 'COMPLETED', registrationSuccess: 'PASSED' },
        { throwIfCertifyIncomplete: false },
      );

      const call = prisma.userCourseProgress.createMany.mock.calls.at(-1)[0];
      expect(call.data).toHaveLength(14);
      expect(call.skipDuplicates).toBe(true);
      expect(call.data.map((r: any) => r.sectionId).sort()).toEqual(
        sections.map((s) => s.id).sort(),
      );
    });

    /**
     * Progress rows are additive with no marker, so once the bridge stamps all
     * 14 the real figure is unrecoverable from them. This column is the only
     * surviving answer to "how much did they actually read".
     */
    it('snapshots the real lesson count before stamping', async () => {
      setupLessonCourse();
      prisma.scormRegistration.findUnique.mockResolvedValue({
        lessonsCompleted: 3,
        lessonsCompletedAtCertify: null,
      });

      await service.applyProgressAndMaybeCertify(
        {
          ...baseRow,
          completionStatus: 'completed',
          successStatus: 'passed',
        } as any,
        { registrationCompletion: 'COMPLETED', registrationSuccess: 'PASSED' },
        { throwIfCertifyIncomplete: false },
      );

      // Conditional on null IN the write, so two overlapping bridge runs
      // cannot both land a snapshot.
      expect(prisma.scormRegistration.updateMany).toHaveBeenCalledWith({
        where: { id: 'reg-1', lessonsCompletedAtCertify: null },
        data: { lessonsCompletedAtCertify: 3 },
      });
    });

    /**
     * Incomplete certification returns 5xx and Cloud retries, so the bridge
     * runs repeatedly — the snapshot must not be overwritten with the
     * post-stamp count on the second pass.
     */
    /**
     * `Section.moduleId` is nullable but `UserCourseProgress.moduleId` is not.
     * Dropping such a section would stamp fewer rows than the gate counts, and
     * `progressed.length < totalSections` would then never clear — a permanent
     * 500-retry loop for a learner Cloud already considers complete.
     */
    it('stamps sections whose moduleId is null via their chapter', async () => {
      courseVersionService.countCompletionDenominator.mockResolvedValue({
        total: 2,
        liveSectionIds: ['sec-a', 'sec-b'],
        quizBearingChapterIds: [],
      });
      prisma.section.findMany.mockResolvedValue([
        {
          id: 'sec-a',
          chapterId: 'ch-1',
          moduleId: 'mod-1',
          chapter: { moduleId: 'mod-1' },
        },
        {
          id: 'sec-b',
          chapterId: 'ch-1',
          moduleId: null,
          chapter: { moduleId: 'mod-1' },
        },
      ]);
      prisma.scormRegistration.findUnique.mockResolvedValue({
        lessonsCompleted: 1,
        lessonsCompletedAtCertify: null,
      });

      await service.applyProgressAndMaybeCertify(
        {
          ...baseRow,
          completionStatus: 'completed',
          successStatus: 'passed',
        } as any,
        { registrationCompletion: 'COMPLETED', registrationSuccess: 'PASSED' },
        { throwIfCertifyIncomplete: false },
      );

      const call = prisma.userCourseProgress.createMany.mock.calls.at(-1)[0];
      expect(call.data).toHaveLength(2);
      expect(call.data.every((r: any) => typeof r.moduleId === 'string')).toBe(
        true,
      );
    });

    /**
     * If the terminal pull failed, lessonsCompleted is null — writing 0 would
     * freeze "read nothing" even after a later reconcile decodes the real set.
     */
    it('leaves the certify snapshot null when no lesson data was decoded', async () => {
      setupLessonCourse();
      prisma.scormRegistration.findUnique.mockResolvedValue({
        lessonsCompleted: null,
        lessonsCompletedAtCertify: null,
      });

      await service.applyProgressAndMaybeCertify(
        {
          ...baseRow,
          completionStatus: 'completed',
          successStatus: 'passed',
        } as any,
        { registrationCompletion: 'COMPLETED', registrationSuccess: 'PASSED' },
        { throwIfCertifyIncomplete: false },
      );

      const snapshotWrites = [
        ...prisma.scormRegistration.update.mock.calls,
        ...prisma.scormRegistration.updateMany.mock.calls,
      ].filter((c: any) => 'lessonsCompletedAtCertify' in (c[0].data ?? {}));
      expect(snapshotWrites).toHaveLength(0);
    });

    it('does not overwrite an existing certify snapshot on retry', async () => {
      setupLessonCourse();
      prisma.scormRegistration.findUnique.mockResolvedValue({
        lessonsCompleted: 14,
        lessonsCompletedAtCertify: 3,
      });

      await service.applyProgressAndMaybeCertify(
        {
          ...baseRow,
          completionStatus: 'completed',
          successStatus: 'passed',
        } as any,
        { registrationCompletion: 'COMPLETED', registrationSuccess: 'PASSED' },
        { throwIfCertifyIncomplete: false },
      );

      const snapshotWrites = [
        ...prisma.scormRegistration.update.mock.calls,
        ...prisma.scormRegistration.updateMany.mock.calls,
      ].filter((c: any) => 'lessonsCompletedAtCertify' in (c[0].data ?? {}));
      expect(snapshotWrites).toHaveLength(0);
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

  /**
   * A finished learner reopening the package keeps posting back. The bridge is
   * a dozen queries plus a full-curriculum stamp, so it must not re-run while
   * the completion row is still certified.
   */
  it('skips the certify bridge for a registration that is still certified', async () => {
    prisma.courseCompletion.findUnique.mockResolvedValue({
      courseCompletedAt: new Date(),
      isPassed: true,
    });
    await service.applyProgressAndMaybeCertify(
      {
        ...baseRow,
        completionStatus: 'completed',
        completedAt: new Date('2026-09-01T00:00:00Z'),
      } as any,
      { registrationCompletion: 'COMPLETED' },
      { throwIfCertifyIncomplete: true },
    );
    expect(courseCompletion.checkContentCompletion).not.toHaveBeenCalled();
    expect(prisma.userCourseProgress.createMany).not.toHaveBeenCalled();
  });

  /** `completedAt` alone is not trusted: the completion row can be reset. */
  it('re-runs the bridge when the completion row is no longer certified', async () => {
    prisma.courseCompletion.findUnique
      .mockResolvedValueOnce({ courseCompletedAt: null, isPassed: false })
      .mockResolvedValue({ courseCompletedAt: new Date(), isPassed: true });
    await service.applyProgressAndMaybeCertify(
      {
        ...baseRow,
        completionStatus: 'completed',
        completedAt: new Date('2026-09-01T00:00:00Z'),
      } as any,
      { registrationCompletion: 'COMPLETED' },
      { throwIfCertifyIncomplete: false },
    );
    expect(courseCompletion.checkContentCompletion).toHaveBeenCalled();
  });

  /** First certification wins; a retry must not move the certified date. */
  it('stamps completedAt only while it is still null', async () => {
    prisma.courseCompletion.findUnique.mockResolvedValue({
      courseCompletedAt: new Date(),
      isPassed: true,
    });
    await service.applyProgressAndMaybeCertify(
      { ...baseRow, completionStatus: 'completed' } as any,
      { registrationCompletion: 'COMPLETED' },
      { throwIfCertifyIncomplete: false },
    );
    expect(prisma.scormRegistration.updateMany).toHaveBeenCalledWith({
      where: { id: 'reg-1', completedAt: null },
      data: { completedAt: expect.any(Date) },
    });
    const unconditional = prisma.scormRegistration.update.mock.calls.filter(
      (c: any) => 'completedAt' in (c[0].data ?? {}),
    );
    expect(unconditional).toHaveLength(0);
  });

  it('defers prune candidates once the shared deadline has passed', async () => {
    prisma.scormPackage.findMany.mockResolvedValue([
      { id: 'pkg-a', courseId: 'c', sectionId: 's', scormCloudCourseId: 'x' },
      { id: 'pkg-b', courseId: 'c', sectionId: 's', scormCloudCourseId: 'y' },
    ]);
    cloud.deleteCourse = jest.fn();
    const result = await service.pruneSupersededPackagesCron(Date.now() - 1);
    expect(result).toEqual({ candidates: 2, pruned: 0, deferred: 2 });
    expect(cloud.deleteCourse).not.toHaveBeenCalled();
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
        // The REAL manifest shape: chapters carry `sectionIds: string[]`.
        // This test previously used `sections: [{ id }]`, a shape the manifest
        // has never had — encoding the same mistake the code made, so the
        // pinned-learner guard looked covered while never actually running.
        manifest: {
          modules: [
            {
              chapters: [
                { sourceId: 'ch-1', sectionIds: ['sec-old'], quizIds: [] },
              ],
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

    expect(result).toEqual({ candidates: 1, pruned: 1, deferred: 0 });
    expect(cloud.deleteCourse).toHaveBeenCalledWith('cloud-old');
    expect(prisma.scormPackage.update).toHaveBeenCalledWith({
      where: { id: 'pkg-old' },
      data: { status: ScormPackageStatus.PRUNED },
    });
  });

  /**
   * The guard that stops the prune cron deleting a SCORM Cloud course out from
   * under learners still pinned to the version that references it. It read a
   * manifest shape that has never existed, so it always passed — and deleting
   * the Cloud course is not recoverable.
   */
  it('refuses to prune a package whose sections a pinned version references', async () => {
    prisma.scormPackage.findMany.mockResolvedValue([
      {
        id: 'pkg-old',
        courseId: 'course-1',
        sectionId: 'sec-old-0',
        scormCloudCourseId: 'cloud-old',
        chapterId: null,
        lessons: null,
      },
    ]);
    prisma.scormRegistration.count.mockResolvedValue(0);
    prisma.courseVersion.findMany.mockResolvedValue([
      {
        id: 'v-1',
        manifest: {
          modules: [
            {
              chapters: [
                { sourceId: 'ch-1', sectionIds: ['sec-old-0'], quizIds: [] },
              ],
            },
          ],
        },
      },
    ]);
    prisma.userCourse.count.mockResolvedValue(3); // learners pinned to v-1
    cloud.deleteCourse = jest.fn();

    const result = await service.pruneSupersededPackagesCron();

    expect(cloud.deleteCourse).not.toHaveBeenCalled();
    expect(result.pruned).toBe(0);
  });

  /**
   * A package with a lesson manifest owns N sections and `sectionId` names only
   * the first, so the reference test has to be a set intersection.
   */
  it('matches a pinned version that references a later lesson section', async () => {
    prisma.scormPackage.findMany.mockResolvedValue([
      {
        id: 'pkg-old',
        courseId: 'course-1',
        sectionId: 'sec-old-0',
        scormCloudCourseId: 'cloud-old',
        chapterId: null,
        lessons: [
          {
            index: 0,
            id: 'l0',
            title: 'A',
            type: 'blocks',
            sectionId: 'sec-old-0',
          },
          {
            index: 1,
            id: 'l1',
            title: 'B',
            type: 'blocks',
            sectionId: 'sec-old-1',
          },
        ],
      },
    ]);
    prisma.scormRegistration.count.mockResolvedValue(0);
    prisma.courseVersion.findMany.mockResolvedValue([
      {
        id: 'v-1',
        manifest: {
          modules: [
            {
              // Only the SECOND lesson's section — a single-id test on
              // `sectionId` would miss this entirely.
              chapters: [
                { sourceId: 'ch-1', sectionIds: ['sec-old-1'], quizIds: [] },
              ],
            },
          ],
        },
      },
    ]);
    prisma.userCourse.count.mockResolvedValue(1);
    cloud.deleteCourse = jest.fn();

    const result = await service.pruneSupersededPackagesCron();

    expect(cloud.deleteCourse).not.toHaveBeenCalled();
    expect(result.pruned).toBe(0);
  });

  /**
   * The replacement package reuses the SAME chapter, so treating "every SCORM
   * section in the chapter" as owned would make a superseded package match the
   * live one's sections — and nothing would ever be prunable.
   */
  it('still prunes when only the CURRENT package sections are pinned', async () => {
    prisma.scormPackage.findMany.mockResolvedValue([
      {
        id: 'pkg-old',
        courseId: 'course-1',
        sectionId: 'sec-old-0',
        scormCloudCourseId: 'cloud-old',
        chapterId: 'ch-shared',
        lessons: [
          {
            index: 0,
            id: 'l0',
            title: 'A',
            type: 'blocks',
            sectionId: 'sec-old-0',
          },
        ],
      },
    ]);
    prisma.scormRegistration.count.mockResolvedValue(0);
    prisma.courseVersion.findMany.mockResolvedValue([
      {
        id: 'v-2',
        manifest: {
          modules: [
            {
              // The NEW package's sections, in the same chapter the old one used.
              chapters: [
                {
                  sourceId: 'ch-shared',
                  sectionIds: ['sec-new-0'],
                  quizIds: [],
                },
              ],
            },
          ],
        },
      },
    ]);
    prisma.userCourse.count.mockResolvedValue(5); // pinned to the NEW version
    prisma.scormRegistration.findMany.mockResolvedValue([]);
    cloud.deleteCourse = jest.fn().mockResolvedValue(undefined);

    const result = await service.pruneSupersededPackagesCron();

    expect(cloud.deleteCourse).toHaveBeenCalledWith('cloud-old');
    expect(result.pruned).toBe(1);
  });

  /**
   * The backfill overwrites `sectionId` and `lessons` with the new lesson ids,
   * so a version manifest published BEFORE it references a synthetic section id
   * neither field mentions any more. Ownership is resolved from the sections'
   * own `config.packageId`, which the archived synthetic section still carries.
   */
  it('refuses to prune when a pre-backfill version pins the archived synthetic section', async () => {
    prisma.scormPackage.findMany.mockResolvedValue([
      {
        id: 'pkg-old',
        courseId: 'course-1',
        sectionId: 'sec-lesson-0',
        scormCloudCourseId: 'cloud-old',
        chapterId: 'ch-1',
        lessons: [
          {
            index: 0,
            id: 'l0',
            title: 'A',
            type: 'blocks',
            sectionId: 'sec-lesson-0',
          },
        ],
      },
    ]);
    prisma.scormRegistration.count.mockResolvedValue(0);
    // The archived synthetic section still carries config.packageId = pkg-old.
    prisma.section.findMany.mockResolvedValue([
      { id: 'sec-lesson-0' },
      { id: 'sec-synthetic-old' },
    ]);
    prisma.courseVersion.findMany.mockResolvedValue([
      {
        id: 'v-pre-backfill',
        manifest: {
          modules: [
            {
              chapters: [
                {
                  sourceId: 'ch-1',
                  sectionIds: ['sec-synthetic-old'],
                  quizIds: [],
                },
              ],
            },
          ],
        },
      },
    ]);
    prisma.userCourse.count.mockResolvedValue(2);
    cloud.deleteCourse = jest.fn();

    const result = await service.pruneSupersededPackagesCron();

    expect(cloud.deleteCourse).not.toHaveBeenCalled();
    expect(result.pruned).toBe(0);
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

describe('ScormRuntimeService — lesson progress sync', () => {
  let service: ScormRuntimeService;
  let prisma: Record<string, any>;
  let cloud: Record<string, jest.Mock>;
  let courseVersionService: Record<string, jest.Mock>;

  const SUSPEND = readFileSync(
    join(__dirname, '../utils/fixtures/rise-suspend-data-hira.json'),
    'utf8',
  );

  /** 14 lessons, each already mapped to a section — as import writes it. */
  const packageLessons = Array.from({ length: 14 }, (_, i) => ({
    index: i,
    id: `lesson-${i}`,
    title: `Lesson ${i}`,
    type: i === 13 ? 'quiz' : 'blocks',
    sectionId: `sec-${i}`,
  }));

  const fullPayload = (overrides: Record<string, unknown> = {}) => ({
    id: 'cloud-reg-1',
    registrationCompletion: 'INCOMPLETE',
    registrationSuccess: 'UNKNOWN',
    totalSecondsTracked: 1966,
    firstAccessDate: '2026-09-20T17:50:14Z',
    lastAccessDate: '2026-09-21T07:38:33Z',
    learner: { id: 'user-1', firstName: 'Given', lastName: 'Family' },
    activityDetails: {
      id: 'B0',
      attempts: 1,
      suspended: true,
      completionAmount: { scaled: 0 },
      children: [
        {
          id: 'i1',
          attempts: 1,
          suspended: true,
          completionAmount: { scaled: 0 },
          children: [],
          runtime: {
            location: 'index.html#/lessons/lesson-5',
            suspendData: SUSPEND,
            entry: 'resume',
            exit: 'suspend',
            progressMeasure: '',
          },
        },
      ],
    },
    ...overrides,
  });

  const baseRow = {
    id: 'reg-1',
    userId: 'user-1',
    courseId: 'course-1',
    packageId: 'pkg-1',
    sectionId: 'sec-0',
    completeOn: 'completed',
    scormCloudRegistrationId: 'cloud-reg-1',
    completionStatus: 'unknown',
    successStatus: 'unknown',
    scoreScaled: null,
    totalTimeSeconds: null,
    lessonsCompleted: null,
    lessonsCompletedIndices: [],
    firstLaunchAt: new Date(),
    lastPostbackAt: null,
    lastRuntimePullAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      scormRegistration: {
        findUnique: jest.fn().mockResolvedValue(baseRow),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        // Other registrations that corroborated the same cpv — see
        // maybeSeedPackageCpv. None by default.
        count: jest.fn().mockResolvedValue(0),
      },
      scormPackage: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pkg-1',
          lessons: packageLessons,
          riseCpv: null,
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      section: {
        findMany: jest.fn(async ({ where }: any) =>
          (where.id.in as string[]).map((id) => ({
            id,
            chapterId: 'ch-1',
            moduleId: 'mod-1',
            chapter: { moduleId: 'mod-1' },
          })),
        ),
        // updateLastSeenLesson resolves the bookmarked section's parents.
        findUnique: jest.fn().mockResolvedValue({
          chapterId: 'ch-1',
          moduleId: 'mod-1',
          chapter: { moduleId: 'mod-1' },
        }),
        findFirst: jest.fn(),
      },
      userCourseProgress: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      user: jest.fn() as any,
      // The lesson-progress path now applies the same access gate the certify
      // path does, so these have to answer "published" and "enrolled".
      course: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'course-1', isActive: true }),
      },
      courseCompletion: { findUnique: jest.fn(), update: jest.fn() },
      userCourse: {
        findFirst: jest.fn().mockResolvedValue({ id: 'uc-1', isActive: true }),
        findUnique: jest.fn().mockResolvedValue({ id: 'uc-1', isActive: true }),
      },
      lastSeenSection: { upsert: jest.fn().mockResolvedValue({}) },
      // recordChapterAndModuleCompletionIfNeeded reads these.
      userChapterCompletion: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      userModuleCompletion: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      chapter: { findUnique: jest.fn().mockResolvedValue(null) },
      courseVersion: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      // The completed-index set is unioned in SQL so concurrent writers
      // compose rather than clobber — see applyLessonIndices.
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    // canRecordProgress refuses a soft-deleted account, so the happy path needs
    // a live one.
    prisma.user = {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', deletedAt: null }),
    };

    cloud = {
      getRegistrationProgress: jest.fn(),
      createRegistration: jest.fn(),
      buildRegistrationLaunchLink: jest.fn(),
      deleteRegistration: jest.fn(),
    };
    courseVersionService = {
      resolveCurriculumTree: jest.fn(),
      countCompletionDenominator: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ScormRuntimeService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: ScormCloudClient, useValue: cloud },
        { provide: CourseVersionService, useValue: courseVersionService },
        {
          provide: CourseCompletionService,
          useValue: { checkContentCompletion: jest.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(ScormRuntimeService);
  });

  /** The composed SQL text of the last atomic index union, whitespace-collapsed. */
  const executedSql = (): string =>
    String(prisma.$executeRaw.mock.calls.at(-1)?.[0]?.sql ?? '').replace(
      /\s+/g,
      ' ',
    );

  /**
   * The bound values of that statement. `Prisma.join` binds array elements as
   * parameters inside an explicitly-typed `ARRAY[...]::int[]`, so the indices
   * live here rather than in the SQL text.
   */
  const executedValues = (): unknown[] =>
    (prisma.$executeRaw.mock.calls.at(-1)?.[0]?.values ?? []) as unknown[];

  const apply = (row: any = baseRow, payload: any = fullPayload()) =>
    service.applyProgressAndMaybeCertify(row, payload, {
      throwIfCertifyIncomplete: false,
    });

  it('writes a progress row per decoded completed lesson', async () => {
    await apply();

    const call = prisma.userCourseProgress.createMany.mock.calls.at(-1)[0];
    expect(call.skipDuplicates).toBe(true);
    // The captured blob completes lessons 0, 1 and 4.
    expect(call.data.map((r: any) => r.sectionId).sort()).toEqual([
      'sec-0',
      'sec-1',
      'sec-4',
    ]);
    expect(call.data.every((r: any) => r.userId === 'user-1')).toBe(true);
    expect(call.data.every((r: any) => r.chapterId === 'ch-1')).toBe(true);
  });

  it('records the lesson count and marks the source as suspend-data', async () => {
    await apply();
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.progressSource).toBe('suspend-data');
  });

  it('stores the bookmark as a 1-based label', async () => {
    await apply();
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.lessonId).toBe('lesson-5');
    expect(data.lessonIndex).toBe(6);
    expect(data.lessonTitle).toBe('Lesson 5');
    expect(data.locationRaw).toBe('index.html#/lessons/lesson-5');
  });

  /**
   * The rule that keeps this feature from corrupting itself: lesson indices are
   * package-scoped, so they must resolve against the registration's OWN
   * package, never the course's newest.
   */
  it('resolves indices against the registration own package', async () => {
    await apply();
    expect(prisma.scormPackage.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pkg-1' } }),
    );
  });

  /**
   * A COURSE-format payload carries no runtime. Treating that as "zero lessons"
   * would make every such postback erase what the last full pull filled in.
   */
  it('leaves lesson data untouched when the payload has no runtime', async () => {
    const noRuntime = fullPayload({
      activityDetails: { id: 'B0', attempts: 1, suspended: true, children: [] },
    });
    await apply({ ...baseRow, lessonsCompleted: 3 }, noRuntime);

    expect(prisma.userCourseProgress.createMany).not.toHaveBeenCalled();
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data).not.toHaveProperty('lessonsCompleted');
    expect(data).not.toHaveProperty('lessonId');
    expect(data).not.toHaveProperty('locationRaw');
    expect(data).not.toHaveProperty('progressSource');
  });

  it('degrades to binary when suspendData cannot be decoded', async () => {
    const bad = fullPayload();
    (bad.activityDetails as any).children[0].runtime.suspendData = '{"v":9}';
    await apply(baseRow, bad);

    expect(prisma.userCourseProgress.createMany).not.toHaveBeenCalled();
    expect(
      prisma.scormRegistration.update.mock.calls.at(-1)[0].data.progressSource,
    ).toBe('binary');
  });

  it('degrades to binary for a package with no lesson manifest', async () => {
    prisma.scormPackage.findUnique.mockResolvedValue({
      id: 'pkg-1',
      lessons: null,
      riseCpv: null,
    });
    await apply();

    expect(prisma.userCourseProgress.createMany).not.toHaveBeenCalled();
    expect(
      prisma.scormRegistration.update.mock.calls.at(-1)[0].data.progressSource,
    ).toBe('binary');
  });

  /**
   * Postbacks are unordered and retried, and a Rise re-attempt can reset
   * suspendData. Rows are additive so they survive it; the counter has to too.
   */
  it('never lets the lesson counter go backwards', async () => {
    const regressed = fullPayload();
    (regressed.activityDetails as any).children[0].runtime.suspendData =
      JSON.stringify({ v: 3, d: [] });
    await apply({ ...baseRow, lessonsCompleted: 7 }, regressed);

    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.lessonsCompleted ?? 7).toBeGreaterThanOrEqual(7);
  });

  it('skips the row write when the completed set is unchanged', async () => {
    await apply({
      ...baseRow,
      lessonsCompleted: 3,
      lessonsCompletedIndices: [0, 1, 4],
    });
    expect(prisma.userCourseProgress.createMany).not.toHaveBeenCalled();
    // The counter is never written through the last-write-wins scalar update:
    // it was computed from a snapshot taken before the Cloud call, so writing
    // it there could lower a value a concurrent pass raised. The skip path
    // still normalises it atomically (empty union), which cannot regress.
    expect(
      prisma.scormRegistration.update.mock.calls.at(-1)[0].data,
    ).not.toHaveProperty('lessonsCompleted');
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    // The empty case must still emit a TYPED literal — Prisma cannot infer an
    // element type for an empty array, and an untyped one is rejected.
    expect(executedSql()).toContain('ARRAY[]::int[]');
  });

  it('seeds the counter on a first decode that completes nothing', async () => {
    const empty = fullPayload();
    (empty.activityDetails as any).children[0].runtime.suspendData =
      JSON.stringify({ v: 3, d: [] });
    await apply({ ...baseRow, lessonsCompleted: null });

    // Nothing decoded, but progressSource records that we DID read the blob —
    // so 0 here means "none complete" rather than "never looked".
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.progressSource).toBe('suspend-data');
  });

  /**
   * A Rise re-attempt can complete a DIFFERENT set of the same size. Comparing
   * counts reads that as "nothing new" and silently drops three lessons, so the
   * guard has to compare the set.
   */
  it('writes rows when the set changes but its size does not', async () => {
    await apply({
      ...baseRow,
      lessonsCompleted: 3,
      lessonsCompletedIndices: [2, 3, 5],
    });

    const call = prisma.userCourseProgress.createMany.mock.calls.at(-1)[0];
    // Union of the previously-applied {2,3,5} and the decoded {0,1,4}.
    expect(call.data.map((r: any) => r.sectionId).sort()).toEqual([
      'sec-0',
      'sec-1',
      'sec-2',
      'sec-3',
      'sec-4',
      'sec-5',
    ]);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(executedValues()).toEqual(expect.arrayContaining([0, 1, 4]));
  });

  /**
   * The recorded set is a union, never a replacement: suspendData is per
   * attempt, and a reset blob must not retract lessons already credited.
   */
  it('unions rather than replaces the recorded set', async () => {
    const reset = fullPayload();
    (reset.activityDetails as any).children[0].runtime.suspendData =
      JSON.stringify({ v: 3, d: [] });

    await apply(
      { ...baseRow, lessonsCompleted: 3, lessonsCompletedIndices: [0, 1, 4] },
      reset,
    );

    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.lessonsCompleted ?? 3).toBeGreaterThanOrEqual(3);
  });

  /**
   * The backfill re-points a package at new section ids, so a set carried over
   * from the old ones resolves to nothing. Recording it before the rows exist
   * would make the skip guard treat it as applied, and no later postback would
   * retry — a learner stuck at 0% with a column claiming three lessons done.
   */
  it('does not record the index set when no rows could be written', async () => {
    prisma.scormPackage.findUnique.mockResolvedValue({
      id: 'pkg-1',
      // Manifest points at sections that no longer exist.
      lessons: packageLessons.map((l) => ({
        ...l,
        sectionId: `stale-${l.index}`,
      })),
      riseCpv: null,
    });
    prisma.section.findMany.mockResolvedValue([]);

    await apply();

    expect(prisma.userCourseProgress.createMany).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('records the index set once the rows are written', async () => {
    await apply();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(executedValues()).toEqual(expect.arrayContaining([0, 1, 4]));
  });

  /**
   * `current` is read before the Cloud call, so computing the new set in JS and
   * writing `{ set: … }` would clobber an overlapping reconcile pass. The union
   * happens in the UPDATE instead, against whatever the row holds at that
   * moment.
   */
  it('never writes the index set through the last-write-wins scalar update', async () => {
    await apply();
    for (const [args] of prisma.scormRegistration.update.mock.calls) {
      expect(args.data).not.toHaveProperty('lessonsCompletedIndices');
    }
  });

  /**
   * A lesson that cannot be written must not be recorded as applied — the skip
   * guard would short-circuit every later postback and it would never get a row.
   */
  it('records only the lessons whose rows actually landed', async () => {
    // sec-1 has no Section row at all; sec-0 and sec-4 do.
    prisma.section.findMany.mockResolvedValue([
      {
        id: 'sec-0',
        chapterId: 'ch-1',
        moduleId: 'mod-1',
        chapter: { moduleId: 'mod-1' },
      },
      {
        id: 'sec-4',
        chapterId: 'ch-1',
        moduleId: 'mod-1',
        chapter: { moduleId: 'mod-1' },
      },
    ]);

    await apply();

    const call = prisma.userCourseProgress.createMany.mock.calls.at(-1)[0];
    expect(call.data.map((r: any) => r.sectionId).sort()).toEqual([
      'sec-0',
      'sec-4',
    ]);
    // Lesson 1 stays unapplied so the next pull retries it. The set is written
    // by the atomic union, not by the scalar update.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    // The statement binds the APPLIED set and the VALID set, each composed into
    // both SET expressions — so an applied index appears 4x and a merely-valid
    // one 2x. Lesson 1 had no section row, so it must be valid-only.
    const count = (n: number) => executedValues().filter((v) => v === n).length;
    expect(count(0)).toBe(4);
    expect(count(4)).toBe(4);
    expect(count(1)).toBe(2);
  });

  /** Section.moduleId is nullable; UserCourseProgress.moduleId is not. */
  it('resolves a null section moduleId through its chapter', async () => {
    prisma.section.findMany.mockResolvedValue([
      {
        id: 'sec-0',
        chapterId: 'ch-1',
        moduleId: null,
        chapter: { moduleId: 'mod-1' },
      },
      {
        id: 'sec-1',
        chapterId: 'ch-1',
        moduleId: 'mod-1',
        chapter: { moduleId: 'mod-1' },
      },
      {
        id: 'sec-4',
        chapterId: 'ch-1',
        moduleId: 'mod-1',
        chapter: { moduleId: 'mod-1' },
      },
    ]);

    await apply();

    const call = prisma.userCourseProgress.createMany.mock.calls.at(-1)[0];
    expect(call.data).toHaveLength(3);
    expect(call.data.every((r: any) => r.moduleId === 'mod-1')).toBe(true);
  });

  /**
   * `Math.max` makes the counter monotonic, so a figure written without any
   * backing rows would never self-correct.
   */
  it('does not advance the counter when no rows could be written', async () => {
    prisma.section.findMany.mockResolvedValue([]);

    await apply();

    expect(prisma.userCourseProgress.createMany).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.lessonsCompleted ?? null).toBeNull();
  });

  /**
   * A first decode that completes nothing must still read 0 rather than null —
   * "decoded, none complete" is different information from "never looked".
   */
  it('normalises the counter on a decode with nothing completed', async () => {
    const empty = fullPayload();
    // A blob that DECODES cleanly but reports no completed lesson — distinct
    // from an undecodable one, which takes the binary path instead.
    (empty.activityDetails as any).children[0].runtime.suspendData =
      encodeSuspendData({ cpv: 'z9SXlNnk', progress: { p: 0, lessons: {} } });
    await apply({ ...baseRow, lessonsCompleted: null }, empty);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    // The empty case must still emit a TYPED literal — Prisma cannot infer an
    // element type for an empty array, and an untyped one is rejected.
    expect(executedSql()).toContain('ARRAY[]::int[]');
  });

  /**
   * Cloud keeps posting back for a learner whose enrolment was revoked or whose
   * access expired. Without this gate an open Rise tab would keep re-creating
   * curriculum rows for a course they can no longer reach — the same rule the
   * certify path already applies.
   */
  it('does not write progress rows for a soft-deleted account', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      deletedAt: new Date(),
    });

    await apply();

    expect(prisma.userCourseProgress.createMany).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('does not write progress rows when the course is unpublished', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      isActive: false,
    });

    await apply();

    expect(prisma.userCourseProgress.createMany).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  /** The Cloud snapshot is still recorded — it reports what the package said. */
  it('still records the Cloud snapshot when progress is gated', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      isActive: false,
    });

    await apply();

    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.progressSource).toBe('suspend-data');
    expect(data.locationRaw).toBe('index.html#/lessons/lesson-5');
    expect(data.attempts).toBe(1);
  });

  /**
   * The native section-complete path stamps chapter/module completion with the
   * progress row. Without it, the roster drill-down and PDF report would show
   * every section done under a chapter still marked incomplete.
   */
  it('stamps chapter completion for the lesson chapter', async () => {
    await apply();
    expect(recordChapterAndModuleCompletionIfNeeded).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      'ch-1',
      expect.objectContaining({ courseId: 'course-1' }),
    );
  });

  it('does not fail the postback when completion bookkeeping throws', async () => {
    (
      recordChapterAndModuleCompletionIfNeeded as jest.Mock
    ).mockRejectedValueOnce(new Error('db blip'));
    await expect(apply()).resolves.toBeUndefined();
    expect(prisma.userCourseProgress.createMany).toHaveBeenCalled();
  });

  /**
   * `every` is vacuously true on an empty array, and a learner who has
   * completed nothing is the most likely first postback — so an "all indices
   * fit" check alone would seed the write-once fingerprint from a blob that
   * corroborated nothing, permanently degrading everyone else on the package.
   */
  it('does not seed the fingerprint from a blob with nothing to corroborate', async () => {
    const empty = fullPayload();
    (empty.activityDetails as any).children[0].runtime.suspendData =
      encodeSuspendData({ cpv: 'z9SXlNnk', progress: { p: 0, lessons: {} } });
    // No bookmark either, so there is no positive evidence at all.
    (empty.activityDetails as any).children[0].runtime.location = '';

    // Another learner already agrees — still no seed, and no marker either.
    prisma.scormRegistration.count.mockResolvedValue(1);

    await apply(baseRow, empty);

    expect(prisma.scormPackage.update).not.toHaveBeenCalled();
    expect(prisma.scormPackage.updateMany).not.toHaveBeenCalled();
    const { metadata } =
      prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(metadata).not.toHaveProperty('riseCpvCorroborated');
  });

  it('counts a resolvable bookmark alone as corroboration', async () => {
    const empty = fullPayload();
    (empty.activityDetails as any).children[0].runtime.suspendData =
      encodeSuspendData({ cpv: 'z9SXlNnk', progress: { p: 0, lessons: {} } });
    prisma.scormRegistration.count.mockResolvedValue(1);

    await apply(baseRow, empty);

    expect(prisma.scormPackage.updateMany).toHaveBeenCalledWith({
      where: { id: 'pkg-1', riseCpv: null },
      data: { riseCpv: 'z9SXlNnk' },
    });
  });

  /**
   * `upsertLastSeen` runs at LAUNCH and can only know the section it launched
   * (lesson 1), and LastSeenSection is unique per (userId, chapterId) — which
   * all N lesson sections share. Without moving it here, "continue where you
   * left off" is permanently lesson 1.
   */
  it('moves the resume pointer to the bookmarked lesson', async () => {
    await apply();
    expect(prisma.lastSeenSection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_chapterId: { userId: 'user-1', chapterId: 'ch-1' } },
        update: { sectionId: 'sec-5' },
      }),
    );
  });

  it('does not fail the postback when the resume pointer cannot be moved', async () => {
    prisma.lastSeenSection.upsert.mockRejectedValue(new Error('db blip'));
    await expect(apply()).resolves.toBeUndefined();
    expect(prisma.userCourseProgress.createMany).toHaveBeenCalled();
  });

  /**
   * The Cloud snapshot is persisted FIRST by contract. A transient failure in
   * the lesson decode must not abandon that write and hand Cloud a 5xx it
   * retries on the same body forever.
   */
  it('still writes the Cloud snapshot when lesson progress throws', async () => {
    prisma.scormPackage.findUnique.mockRejectedValue(new Error('db blip'));

    await apply();

    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.completionStatus).toBeDefined();
    // But the row stays dirty: the lessons never landed, so stamping it
    // applied would hide that from reconcile and pull-on-read.
    expect(data).not.toHaveProperty('lastRuntimeAppliedAt');
  });

  /**
   * A stale "Lesson 6 of 14" beside `progressSource: 'binary'` reads as a
   * current position we no longer stand behind.
   */
  it.each([
    [
      'an undecodable blob whose bookmark does not resolve either',
      (p: any) => {
        p.activityDetails.children[0].runtime.suspendData = '{"v":9}';
        p.activityDetails.children[0].runtime.location =
          'index.html#/lessons/not-in-manifest';
      },
      () => {},
    ],
    [
      'a package with no lesson manifest',
      () => {},
      (prismaRef: any) =>
        prismaRef.scormPackage.findUnique.mockResolvedValue({
          id: 'pkg-1',
          lessons: null,
          riseCpv: null,
        }),
    ],
  ])(
    'clears the lesson label when falling back to binary for %s',
    async (_label, mutatePayload, mutatePrisma) => {
      const payload = fullPayload();
      mutatePayload(payload as any);
      mutatePrisma(prisma);

      await apply(baseRow, payload);

      const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
      expect(data.progressSource).toBe('binary');
      expect(data.lessonId).toBeNull();
      expect(data.lessonIndex).toBeNull();
      expect(data.lessonTitle).toBeNull();
      // Verbatim evidence is kept.
      expect(data.locationRaw).toBe(
        (payload as any).activityDetails.children[0].runtime.location,
      );
    },
  );

  /**
   * The bookmark resolves by lesson ID, independent of suspendData, so an
   * unreadable blob is no reason to throw away a position we can still read.
   */
  it('keeps a resolvable bookmark when the blob cannot be decoded', async () => {
    const undecodable = fullPayload();
    (undecodable.activityDetails as any).children[0].runtime.suspendData =
      '{"v":9}';
    await apply(baseRow, undecodable);

    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.progressSource).toBe('binary');
    expect(data.lessonId).toBe('lesson-5');
    expect(data.lessonIndex).toBe(6);
    expect(prisma.userCourseProgress.createMany).not.toHaveBeenCalled();
  });

  /** A Rise format change must not present only as everyone silently at 0. */
  it('warns once, with version and size, for an undecodable blob', async () => {
    const warn = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    const undecodable = fullPayload();
    (undecodable.activityDetails as any).children[0].runtime.suspendData =
      '{"v":9}';

    await apply(baseRow, undecodable);
    await apply(baseRow, undecodable);

    const hits = warn.mock.calls.filter((c) =>
      String(c[0]).includes('could not be decoded'),
    );
    expect(hits).toHaveLength(1);
    expect(String(hits[0][0])).toContain('reg-1');
    expect(String(hits[0][0])).toContain('v=9');
    expect(String(hits[0][0])).toContain('7 bytes');
  });

  it('does not warn for a learner Rise has written no state for yet', async () => {
    const warn = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    const empty = fullPayload();
    (empty.activityDetails as any).children[0].runtime.suspendData = '';
    await apply(baseRow, empty);
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes('could not be decoded'),
      ),
    ).toBe(false);
  });

  /**
   * The union re-reads the stored set, so the manifest filter has to apply in
   * SQL as well as in JS — otherwise indices written against a previous
   * manifest survive and `cardinality` counts them, giving "20 of 14".
   */
  it('passes the manifest index space to the atomic union', async () => {
    await apply();
    // Applied indices {0,1,4} plus the 14 valid ones, bound twice over (the
    // merged set is composed into both SET expressions).
    expect(executedValues()).toEqual(expect.arrayContaining([0, 1, 4]));
    expect(executedValues()).toEqual(
      expect.arrayContaining([11, 12, 13]), // only the valid-index list has these
    );
  });

  /** The resume pointer is curriculum state, so the access gate covers it too. */
  it('does not move the resume pointer for a revoked learner', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      isActive: false,
    });

    await apply();

    expect(prisma.lastSeenSection.upsert).not.toHaveBeenCalled();
  });

  /**
   * Lesson counts are cumulative and monotonic. A Rise re-attempt resets
   * suspendData, but downgrading to 'binary' beside a populated
   * `lessonsCompleted` would describe the row as having no lesson data next to
   * lesson data.
   */
  it('does not downgrade progressSource for a learner who already has lessons', async () => {
    const undecodable = fullPayload();
    (undecodable.activityDetails as any).children[0].runtime.suspendData =
      '{"v":9}';

    await apply(
      {
        ...baseRow,
        lessonsCompleted: 6,
        lessonsCompletedIndices: [0, 1, 2, 3, 4, 5],
      },
      undecodable,
    );

    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data).not.toHaveProperty('progressSource');
    // The bookmark still resolves by id, so its label stands.
    expect(data.lessonId).toBe('lesson-5');
  });

  it('still marks binary for a learner with no decoded lessons yet', async () => {
    const undecodable = fullPayload();
    (undecodable.activityDetails as any).children[0].runtime.suspendData =
      '{"v":9}';

    await apply({ ...baseRow, lessonsCompleted: null }, undecodable);

    expect(
      prisma.scormRegistration.update.mock.calls.at(-1)[0].data.progressSource,
    ).toBe('binary');
  });

  /**
   * The chapter stamp is best-effort, so a throw leaves it unwritten while the
   * indices are still recorded — and the unchanged-set short-circuit would then
   * block every later attempt. It is retried from that path for a learner who
   * holds every lesson, which is the only state where it could newly complete.
   */
  it('retries the chapter stamp when the learner already holds every lesson', async () => {
    const allIndices = Array.from({ length: 14 }, (_, i) => i);
    await apply({
      ...baseRow,
      lessonsCompleted: 14,
      lessonsCompletedIndices: allIndices,
    });

    expect(prisma.userCourseProgress.createMany).not.toHaveBeenCalled();
    expect(recordChapterAndModuleCompletionIfNeeded).toHaveBeenCalled();
  });

  it('does not retry the chapter stamp for a part-way learner', async () => {
    (recordChapterAndModuleCompletionIfNeeded as jest.Mock).mockClear();

    await apply({
      ...baseRow,
      lessonsCompleted: 3,
      lessonsCompletedIndices: [0, 1, 4],
    });

    expect(prisma.userCourseProgress.createMany).not.toHaveBeenCalled();
    expect(recordChapterAndModuleCompletionIfNeeded).not.toHaveBeenCalled();
  });

  /**
   * The blob is learner-controlled and the seed rejects every disagreeing
   * learner afterwards, so one learner's corroboration is recorded but does
   * not seed the package.
   */
  it('records a corroborated fingerprint on the registration, not the package, on first sight', async () => {
    await apply();

    expect(prisma.scormPackage.update).not.toHaveBeenCalled();
    expect(prisma.scormPackage.updateMany).not.toHaveBeenCalled();
    const { metadata } =
      prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(metadata.riseCpvCorroborated).toBe('z9SXlNnk');
  });

  it('seeds the package once a second registration agrees', async () => {
    prisma.scormRegistration.count.mockResolvedValue(1);
    await apply();

    expect(prisma.scormRegistration.count).toHaveBeenCalledWith({
      where: {
        packageId: 'pkg-1',
        id: { not: 'reg-1' },
        metadata: { path: ['riseCpvCorroborated'], equals: 'z9SXlNnk' },
      },
    });
    // Conditional, so a concurrent seed or an admin's reset-and-reseed is
    // never overwritten.
    expect(prisma.scormPackage.updateMany).toHaveBeenCalledWith({
      where: { id: 'pkg-1', riseCpv: null },
      data: { riseCpv: 'z9SXlNnk' },
    });
  });

  it('does not fail the pass when seeding throws', async () => {
    prisma.scormRegistration.count.mockRejectedValue(new Error('db blip'));
    await apply();
    expect(prisma.userCourseProgress.createMany).toHaveBeenCalled();
  });

  /**
   * Whether Rise keys suspendData by the filtered or the raw lesson list is
   * unverified for manifests where they differ, so such a package must not
   * have decoded indices applied — a guess would misattribute every lesson
   * after the divergence.
   */
  it('stays binary for a package whose index space is unverified', async () => {
    prisma.scormPackage.findUnique.mockResolvedValue({
      id: 'pkg-1',
      lessons: packageLessons,
      riseCpv: null,
      riseProbeJson: { riseIndexSpaceRisk: '1 soft-deleted lesson(s)' },
    });
    await apply();

    expect(prisma.userCourseProgress.createMany).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.progressSource).toBe('binary');
    // The bookmark resolves by id, not index, so it is still trusted.
    expect(data.lessonId).toBe('lesson-5');
  });

  it('applies lessons once an admin has verified the index space', async () => {
    prisma.scormPackage.findUnique.mockResolvedValue({
      id: 'pkg-1',
      lessons: packageLessons,
      riseCpv: null,
      riseProbeJson: {
        riseIndexSpaceRisk: '1 soft-deleted lesson(s)',
        riseIndexSpaceVerified: true,
      },
    });
    await apply();
    expect(prisma.userCourseProgress.createMany).toHaveBeenCalled();
  });

  /**
   * A changed cpv means the index space no longer describes the manifest these
   * sections were built from — applying it would attribute progress to the
   * wrong lessons.
   */
  it('refuses to apply indices when the fingerprint disagrees', async () => {
    prisma.scormPackage.findUnique.mockResolvedValue({
      id: 'pkg-1',
      lessons: packageLessons,
      riseCpv: 'DIFFERENT',
    });
    await apply();

    expect(prisma.userCourseProgress.createMany).not.toHaveBeenCalled();
    expect(
      prisma.scormRegistration.update.mock.calls.at(-1)[0].data.progressSource,
    ).toBe('binary');
  });

  /**
   * The bookmark is read out of the same manifest the cpv says is stale, so
   * writing it would persist exactly the "Lesson 6 of 14" misattribution the
   * fingerprint guard exists to prevent.
   */
  it('does not write a lesson label from a manifest the fingerprint rejects', async () => {
    prisma.scormPackage.findUnique.mockResolvedValue({
      id: 'pkg-1',
      lessons: packageLessons,
      riseCpv: 'DIFFERENT',
    });
    await apply();

    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.lessonId).toBeNull();
    expect(data.lessonIndex).toBeNull();
    expect(data.lessonTitle).toBeNull();
    // The verbatim location is evidence rather than an interpretation, so it
    // is still kept.
    expect(data.locationRaw).toBe('index.html#/lessons/lesson-5');
  });

  it('keeps learner names and suspendData out of the stored metadata', async () => {
    await apply();
    const { metadata } =
      prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    const serialised = JSON.stringify(metadata);

    expect(serialised).not.toContain('Given');
    expect(serialised).not.toContain('Family');
    // `suspendDataBytes` is kept deliberately, so match the blob itself rather
    // than the substring: no raw envelope, no LZW code array.
    expect(serialised).not.toContain('"suspendData"');
    expect(serialised).not.toContain('"v":3');
    expect(
      metadata.activityDetails.children[0].runtime.suspendData,
    ).toBeUndefined();
    expect(metadata.learner).toEqual({ id: 'user-1' });
    // The size survives, so "has a resume state" stays distinguishable from
    // "decode failed" without keeping the blob.
    expect(
      metadata.activityDetails.children[0].runtime.suspendDataBytes,
    ).toBeGreaterThan(0);
  });

  /**
   * A COURSE postback still carries `activityDetails`, so writing metadata from
   * it would replace the richer snapshot a previous FULL pull left — the
   * runtime block and suspendDataBytes would flip in and out on alternating
   * writes.
   */
  it('does not overwrite metadata from a runtime-less payload', async () => {
    const noRuntime = fullPayload({
      activityDetails: { id: 'B0', attempts: 1, suspended: true, children: [] },
    });
    await apply(baseRow, noRuntime);

    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data).not.toHaveProperty('metadata');
    // The cheap scalars are still safe to refresh from any detail level.
    expect(data.attempts).toBe(1);
  });

  /**
   * Not reachable today — we never request interactions — but the guarantee
   * has to live in the stripper, not in a query param in another file.
   */
  it('strips per-question responses if Cloud ever sends them', async () => {
    const withInteractions = fullPayload();
    (
      withInteractions.activityDetails as any
    ).children[0].runtime.runtimeInteractions = [
      { id: 'q1', learnerResponse: 'the answer', result: 'correct' },
    ];
    await apply(baseRow, withInteractions);

    const { metadata } =
      prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    const serialised = JSON.stringify(metadata);
    expect(serialised).not.toContain('learnerResponse');
    expect(serialised).not.toContain('the answer');
    expect(
      metadata.activityDetails.children[0].runtime.runtimeInteractionsCount,
    ).toBe(1);
  });

  /**
   * Written up to once a minute per active learner on a row the same request
   * already updates, so the blob must not duplicate what the columns hold.
   */
  it('omits fields that have their own column', async () => {
    await apply();
    const { metadata } =
      prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    for (const key of [
      'registrationCompletion',
      'registrationSuccess',
      'totalSecondsTracked',
      'firstAccessDate',
      'lastAccessDate',
    ]) {
      expect(metadata).not.toHaveProperty(key);
    }
    // The part with no column of its own is what survives.
    expect(metadata.activityDetails).toBeDefined();
  });

  it('scrubs learner names nested below the root', async () => {
    const nested = fullPayload();
    (nested.activityDetails as any).children[0].previousAttempts = [
      { learner: { id: 'user-1', firstName: 'Given', lastName: 'Family' } },
    ];
    await apply(baseRow, nested);

    const { metadata } =
      prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    const serialised = JSON.stringify(metadata);
    expect(serialised).not.toContain('Given');
    expect(serialised).not.toContain('Family');
    // The learner id survives — it is our own User id.
    expect(serialised).toContain('user-1');
  });

  it('stores Cloud access timestamps and activity scalars', async () => {
    await apply();
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.attempts).toBe(1);
    expect(data.suspended).toBe(true);
    expect(data.completionAmount).toBe(0);
    expect(data.firstAccessAt).toEqual(new Date('2026-09-20T17:50:14Z'));
    expect(data.lastAccessAt).toEqual(new Date('2026-09-21T07:38:33Z'));
  });

  /**
   * Snapshots arrive out of order. An older one must not walk lastAccessAt
   * backwards or firstAccessAt forwards.
   */
  it('keeps access timestamps monotonic', async () => {
    await apply({
      ...baseRow,
      firstAccessAt: new Date('2026-09-01T00:00:00Z'),
      lastAccessAt: new Date('2026-09-30T00:00:00Z'),
    });
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data).not.toHaveProperty('firstAccessAt');
    expect(data).not.toHaveProperty('lastAccessAt');
  });

  it('advances access timestamps when the snapshot is newer', async () => {
    await apply({
      ...baseRow,
      firstAccessAt: new Date('2026-09-21T00:00:00Z'),
      lastAccessAt: new Date('2026-09-21T00:00:00Z'),
    });
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.firstAccessAt).toEqual(new Date('2026-09-20T17:50:14Z'));
    expect(data.lastAccessAt).toEqual(new Date('2026-09-21T07:38:33Z'));
  });

  /** `new Date('…T07:38:33')` is LOCAL time in JS; Cloud means UTC. */
  it('reads a zone-less Cloud timestamp as UTC', async () => {
    await apply(
      baseRow,
      fullPayload({
        firstAccessDate: '2026-09-20T17:50:14',
        lastAccessDate: '2026-09-21 07:38:33.5',
      }),
    );
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.firstAccessAt).toEqual(new Date('2026-09-20T17:50:14Z'));
    expect(data.lastAccessAt).toEqual(new Date('2026-09-21T07:38:33.500Z'));
  });

  /** Rise re-commits the same bookmark on every block. */
  it('does not touch the resume pointer when the bookmark has not moved', async () => {
    await apply({ ...baseRow, lessonId: 'lesson-5' });
    expect(prisma.lastSeenSection.upsert).not.toHaveBeenCalled();
  });

  /**
   * The count is the cardinality of the filtered set. A GREATEST against the
   * stored figure could never come down, so a count inflated by stale indices
   * would stay above the set it describes — and above lessonCount — forever.
   */
  it('derives the lesson count from the filtered set alone', async () => {
    await apply();
    const sql = executedSql();
    expect(sql).not.toContain('GREATEST');
    expect(sql).toMatch(/"lessonsCompleted" = cardinality\(ARRAY\(/);
  });

  /**
   * The clean stamp is the instant the pull was ISSUED, never when its answer
   * was written — and only real postbacks move lastPostbackAt.
   */
  it('stamps the issue instant, not the apply instant, as applied', async () => {
    const issuedAt = new Date(Date.now() - 45_000);
    const receivedAt = new Date(Date.now() - 50_000);
    await service.applyProgressAndMaybeCertify(baseRow as any, fullPayload(), {
      throwIfCertifyIncomplete: false,
      snapshotAt: issuedAt,
      postbackReceivedAt: receivedAt,
    });
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.lastRuntimeAppliedAt).toEqual(issuedAt);
    expect(data.lastPostbackAt).toEqual(receivedAt);
  });

  it('does not touch lastPostbackAt for a pull that is not a postback', async () => {
    await service.applyProgressAndMaybeCertify(baseRow as any, fullPayload(), {
      throwIfCertifyIncomplete: false,
      snapshotAt: new Date(),
      fullPull: true,
    });
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data).not.toHaveProperty('lastPostbackAt');
  });

  /**
   * H1: pull A is issued at t0; postback B arrives at t1 and is debounced; A's
   * answer lands at t2. Stamping t2 would read clean and nobody would ever
   * pull B's lessons. Stamping t0 keeps the row dirty.
   */
  it('keeps the row dirty when a postback arrived after the pull was issued', async () => {
    const t0 = new Date(Date.now() - 20_000);
    const t1 = new Date(Date.now() - 10_000);
    const row = {
      ...baseRow,
      lastPostbackAt: t1,
      lastRuntimeAppliedAt: new Date(Date.now() - 600_000),
    };
    await service.applyProgressAndMaybeCertify(row as any, fullPayload(), {
      throwIfCertifyIncomplete: false,
      snapshotAt: t0,
      fullPull: true,
    });
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.lastRuntimeAppliedAt).toEqual(t0);
    expect(data.lastRuntimeAppliedAt.getTime()).toBeLessThan(t1.getTime());
  });

  it('never moves the applied stamp backwards', async () => {
    const newer = new Date(Date.now() - 1_000);
    await service.applyProgressAndMaybeCertify(
      { ...baseRow, lastRuntimeAppliedAt: newer } as any,
      fullPayload(),
      {
        throwIfCertifyIncomplete: false,
        snapshotAt: new Date(Date.now() - 30_000),
        fullPull: true,
      },
    );
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.lastRuntimeAppliedAt).toEqual(newer);
  });

  /**
   * A stale apply keeps its monotonic merges (lessons, status rank) but must
   * not put back an older bookmark, suspended flag, attempts or resume pointer.
   */
  it('skips the last-write-wins fields for an apply older than the row', async () => {
    const row = {
      ...baseRow,
      lessonId: 'lesson-9',
      suspended: false,
      lastPostbackAt: new Date(Date.now() - 5_000),
    };
    await service.applyProgressAndMaybeCertify(
      row as any,
      fullPayload({ registrationSuccess: 'PASSED' }),
      {
        throwIfCertifyIncomplete: false,
        snapshotAt: new Date(Date.now() - 30_000),
        fullPull: true,
      },
    );
    const data = prisma.scormRegistration.update.mock.calls[0][0].data;
    for (const key of [
      'lessonId',
      'lessonIndex',
      'suspended',
      'attempts',
      'locationRaw',
      'metadata',
      'progressSource',
    ]) {
      expect(data).not.toHaveProperty(key);
    }
    expect(data.successStatus).toBe('passed');
    expect(prisma.lastSeenSection.upsert).not.toHaveBeenCalled();
    // Lessons are additive, so a stale snapshot still contributes them.
    expect(prisma.userCourseProgress.createMany).toHaveBeenCalled();
  });

  /** M2: a FULL pull with no runtime yet still happened. */
  it('marks the row clean after a FULL pull that carried no runtime', async () => {
    const issuedAt = new Date();
    await service.applyProgressAndMaybeCertify(
      baseRow as any,
      fullPayload({ activityDetails: { id: 'B0', children: [] } }),
      { throwIfCertifyIncomplete: false, snapshotAt: issuedAt, fullPull: true },
    );
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.lastRuntimeAppliedAt).toEqual(issuedAt);
  });

  it('leaves the row dirty when a postback carried no runtime and nothing was pulled', async () => {
    await service.applyProgressAndMaybeCertify(
      baseRow as any,
      fullPayload({ activityDetails: { id: 'B0', children: [] } }),
      {
        throwIfCertifyIncomplete: false,
        postbackReceivedAt: new Date(),
        snapshotAt: new Date(),
      },
    );
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.lastPostbackAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty('lastRuntimeAppliedAt');
  });

  /**
   * M1: the merge must be against the row as it is at WRITE time. A conflict
   * on updatedAt re-reads and re-merges, so a lagging 'incomplete' cannot land
   * over a concurrent 'completed'.
   */
  it('re-merges against the current row when a concurrent write wins', async () => {
    // completeOn 'passed' keeps the certify bridge out of this test.
    const stale = {
      ...baseRow,
      completeOn: 'passed',
      updatedAt: new Date(1_000),
    };
    prisma.scormRegistration.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );
    prisma.scormRegistration.findUnique.mockResolvedValue({
      ...baseRow,
      completeOn: 'passed',
      completionStatus: 'completed',
      totalTimeSeconds: 5_000,
      updatedAt: new Date(2_000),
    });

    await apply(stale, fullPayload());

    const calls = prisma.scormRegistration.update.mock.calls;
    expect(calls[0][0].where).toEqual({
      id: 'reg-1',
      updatedAt: new Date(1_000),
    });
    expect(calls[0][0].data.completionStatus).toBe('incomplete');
    expect(calls[1][0].where).toEqual({
      id: 'reg-1',
      updatedAt: new Date(2_000),
    });
    expect(calls[1][0].data.completionStatus).toBe('completed');
    expect(calls[1][0].data.totalTimeSeconds).toBe(5_000);
  });

  it('gives up after bounded retries rather than spinning', async () => {
    prisma.scormRegistration.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );
    await expect(apply()).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(prisma.scormRegistration.update).toHaveBeenCalledTimes(5);
  });

  /** L2: an apply must not erase keys a previous pass recorded. */
  it('merges metadata instead of replacing it', async () => {
    const binaryPkg = { id: 'pkg-1', lessons: null, riseCpv: null };
    prisma.scormPackage.findUnique.mockResolvedValue(binaryPkg);
    await apply({
      ...baseRow,
      metadata: { riseCpvCorroborated: 'z9SXlNnk', somethingElse: 1 },
    });
    const { metadata } =
      prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(metadata.riseCpvCorroborated).toBe('z9SXlNnk');
    expect(metadata.somethingElse).toBe(1);
    expect(metadata.activityDetails).toBeDefined();
  });

  /** L4: once this registration has corroborated, the count is not repeated. */
  it('does not re-count corroborations for an already-corroborated registration', async () => {
    await apply({ ...baseRow, metadata: { riseCpvCorroborated: 'z9SXlNnk' } });
    expect(prisma.scormRegistration.count).not.toHaveBeenCalled();
  });

  it('re-counts when the corroborated cpv changed', async () => {
    await apply({ ...baseRow, metadata: { riseCpvCorroborated: 'older' } });
    expect(prisma.scormRegistration.count).toHaveBeenCalled();
  });

  /** L5: the blob grows every commit, so length must not be in the key. */
  it('warns once per registration and version even as the blob grows', async () => {
    const warn = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    for (const blob of ['{"v":9}', '{"v":9,"x":1}', '{"v":9,"x":12}']) {
      const p = fullPayload();
      (p.activityDetails as any).children[0].runtime.suspendData = blob;
      await apply(baseRow, p);
    }
    const hits = warn.mock.calls.filter((c) =>
      String(c[0]).includes('could not be decoded'),
    );
    expect(hits).toHaveLength(1);
  });
});

describe('ScormRuntimeService — runtime pull debounce', () => {
  let service: ScormRuntimeService;
  let prisma: Record<string, any>;
  let cloud: Record<string, jest.Mock>;
  let configValue: unknown;

  const courseRow = {
    id: 'reg-1',
    userId: 'user-1',
    courseId: 'course-1',
    packageId: 'pkg-1',
    sectionId: 'sec-0',
    completeOn: 'completed',
    scormCloudRegistrationId: 'cloud-reg-1',
    completionStatus: 'unknown',
    successStatus: 'unknown',
    scoreScaled: null,
    totalTimeSeconds: null,
    lessonsCompleted: null,
    lessonsCompletedIndices: [],
    firstLaunchAt: new Date(),
    lastPostbackAt: null,
    lastRuntimePullAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  /** COURSE-detail postback: no children, so no runtime. */
  const coursePostback = {
    id: 'cloud-reg-1',
    registrationCompletion: 'INCOMPLETE',
    registrationSuccess: 'UNKNOWN',
    activityDetails: { id: 'B0', attempts: 1, children: [] },
  };

  beforeEach(async () => {
    configValue = undefined;
    prisma = {
      scormRegistration: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        // The pull claim: count 1 means this caller won it.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      scormPackage: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      section: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      userCourseProgress: { createMany: jest.fn(), findFirst: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      course: { findUnique: jest.fn() },
      courseCompletion: { findUnique: jest.fn(), update: jest.fn() },
      userCourse: { findFirst: jest.fn() },
      lastSeenSection: { upsert: jest.fn() },
      courseVersion: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    cloud = {
      getRegistrationProgress: jest
        .fn()
        .mockResolvedValue({ id: 'cloud-reg-1' }),
      createRegistration: jest.fn(),
      buildRegistrationLaunchLink: jest.fn(),
      deleteRegistration: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ScormRuntimeService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => configValue } },
        { provide: ScormCloudClient, useValue: cloud },
        {
          provide: CourseVersionService,
          useValue: {
            countCompletionDenominator: jest.fn(),
            resolveCurriculumTree: jest.fn(),
          },
        },
        {
          provide: CourseCompletionService,
          useValue: { checkContentCompletion: jest.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(ScormRuntimeService);
  });

  const post = async (row: any) => {
    prisma.scormRegistration.findUnique.mockResolvedValue(row);
    await service.handlePostback(coursePostback);
  };

  it('pulls when no runtime has ever been pulled', async () => {
    await post(courseRow);
    expect(cloud.getRegistrationProgress).toHaveBeenCalledWith(
      'cloud-reg-1',
      'full',
    );
  });

  /**
   * The bug this replaced: the floor used to measure from `lastPostbackAt`,
   * which every postback stamps. An actively-committing learner therefore
   * always looked "too recent" and never got a pull — the exact case the pull
   * exists to serve.
   */
  it('pulls for an active learner whose last postback was seconds ago', async () => {
    await post({
      ...courseRow,
      lastPostbackAt: new Date(Date.now() - 2_000),
      lastRuntimePullAt: null,
    });
    expect(cloud.getRegistrationProgress).toHaveBeenCalled();
  });

  it('skips when a pull happened inside the floor', async () => {
    await post({
      ...courseRow,
      lastRuntimePullAt: new Date(Date.now() - 5_000),
    });
    expect(cloud.getRegistrationProgress).not.toHaveBeenCalled();
  });

  it('pulls again once the floor has elapsed', async () => {
    await post({
      ...courseRow,
      lastRuntimePullAt: new Date(Date.now() - 120_000),
    });
    expect(cloud.getRegistrationProgress).toHaveBeenCalled();
  });

  it('stamps the pull time so the next postback is debounced', async () => {
    await post(courseRow);
    expect(prisma.scormRegistration.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { lastRuntimePullAt: expect.any(Date) },
      }),
    );
  });

  /**
   * The claim is the check: two concurrent postbacks can both read "outside
   * the floor", and only the one whose conditional UPDATE matched may pull.
   */
  it('does not pull when a concurrent postback won the claim', async () => {
    prisma.scormRegistration.updateMany.mockResolvedValue({ count: 0 });
    await post(courseRow);
    expect(cloud.getRegistrationProgress).not.toHaveBeenCalled();
  });

  it('claims against the floor in the write itself', async () => {
    await post(courseRow);
    const { where } = prisma.scormRegistration.updateMany.mock.calls[0][0];
    expect(where.id).toBe('reg-1');
    expect(where.OR).toEqual([
      { lastRuntimePullAt: null },
      { lastRuntimePullAt: { lt: expect.any(Date) } },
    ]);
    const cutoff = where.OR[1].lastRuntimePullAt.lt.getTime();
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(59_000);
  });

  /**
   * The learner's last commit before closing Rise is the one most likely to
   * be debounced. The COURSE envelope's `suspended` flipping true is the
   * session-end signal, and it waives the floor.
   */
  it('pulls inside the floor when the postback ends the session', async () => {
    prisma.scormRegistration.findUnique.mockResolvedValue({
      ...courseRow,
      suspended: false,
      lastRuntimePullAt: new Date(Date.now() - 5_000),
    });
    await service.handlePostback({
      ...coursePostback,
      activityDetails: { ...coursePostback.activityDetails, suspended: true },
    });
    expect(cloud.getRegistrationProgress).toHaveBeenCalled();
  });

  /** Edge-triggered: an already-suspended row is not a new session end. */
  it('keeps the floor once the row is already suspended', async () => {
    prisma.scormRegistration.findUnique.mockResolvedValue({
      ...courseRow,
      suspended: true,
      lastRuntimePullAt: new Date(Date.now() - 5_000),
    });
    await service.handlePostback({
      ...coursePostback,
      activityDetails: { ...coursePostback.activityDetails, suspended: true },
    });
    expect(cloud.getRegistrationProgress).not.toHaveBeenCalled();
  });

  /**
   * `row` predates the Cloud round-trip; merging against it could write back
   * a status a concurrent writer already advanced.
   */
  it('merges against the row as re-read after the pull', async () => {
    cloud.getRegistrationProgress.mockResolvedValue({
      id: 'cloud-reg-1',
      registrationCompletion: 'INCOMPLETE',
      activityDetails: { id: 'B0', children: [] },
    });
    prisma.scormRegistration.findUnique
      .mockResolvedValueOnce(courseRow)
      .mockResolvedValueOnce({
        ...courseRow,
        completionStatus: 'completed',
        completedAt: new Date(),
      });

    await service.handlePostback(coursePostback);

    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.completionStatus).toBe('completed');
  });

  const terminalPostback = {
    ...coursePostback,
    registrationCompletion: 'COMPLETED',
  };

  /**
   * Certification wants the freshest lesson data, so a terminal postback gets a
   * SHORTER floor (10s) than an ordinary commit (60s) — 30s in is past the
   * terminal floor but well inside the ordinary one.
   */
  /** A learner the completion bridge could actually certify. */
  const certifiableLearner = () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', deletedAt: null });
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      isActive: true,
    });
    prisma.userCourse.findFirst.mockResolvedValue({
      id: 'uc-1',
      isActive: true,
    });
    prisma.courseCompletion.findUnique.mockResolvedValue(null);
  };

  it('uses a shorter floor for the postback that decides certification', async () => {
    const thirtySecondsAgo = new Date(Date.now() - 30_000);
    certifiableLearner();

    prisma.scormRegistration.findUnique.mockResolvedValue({
      ...courseRow,
      lastRuntimePullAt: thirtySecondsAgo,
    });
    // The bridge itself cannot finish on these mocks; only the pull matters.
    await service.handlePostback(terminalPostback).catch(() => undefined);
    expect(cloud.getRegistrationProgress).toHaveBeenCalled();

    cloud.getRegistrationProgress.mockClear();
    prisma.scormRegistration.findUnique.mockResolvedValue({
      ...courseRow,
      lastRuntimePullAt: thirtySecondsAgo,
    });
    await service.handlePostback(coursePostback);
    expect(cloud.getRegistrationProgress).not.toHaveBeenCalled();
  });

  /**
   * The terminal case is a shorter floor, NOT a waiver. `completedAt` is only
   * stamped once the bridge returns 'done', so a certify that keeps failing
   * leaves it null and Cloud re-posts indefinitely — waiving the floor there
   * would mean one Cloud read per retry, forever.
   */
  it('still rate-limits a terminal postback that keeps retrying', async () => {
    prisma.scormRegistration.findUnique.mockResolvedValue({
      ...courseRow,
      lastRuntimePullAt: new Date(Date.now() - 1_000),
      completedAt: null,
    });
    await service.handlePostback(terminalPostback);
    expect(cloud.getRegistrationProgress).not.toHaveBeenCalled();
  });

  /**
   * L1: completedAt is only stamped when the bridge returns 'done', so for a
   * learner it will only ever skip (staff preview, unpublished course, revoked
   * enrolment) the cheap test stays true forever. They keep the normal floor.
   */
  it.each([
    [
      'a user with no usable enrolment',
      () => {
        certifiableLearner();
        prisma.userCourse.findFirst.mockResolvedValue(null);
      },
    ],
    [
      'an unpublished course',
      () => {
        certifiableLearner();
        prisma.course.findUnique.mockResolvedValue({
          id: 'course-1',
          isActive: false,
        });
      },
    ],
    [
      'a deleted account',
      () => {
        certifiableLearner();
        prisma.user.findUnique.mockResolvedValue({
          id: 'user-1',
          deletedAt: new Date(),
        });
      },
    ],
  ])(
    'keeps the normal floor for %s the bridge would skip',
    async (_l, arrange) => {
      arrange();
      prisma.scormRegistration.findUnique.mockResolvedValue({
        ...courseRow,
        lastRuntimePullAt: new Date(Date.now() - 30_000),
      });
      await service.handlePostback(terminalPostback).catch(() => undefined);
      expect(cloud.getRegistrationProgress).not.toHaveBeenCalled();
    },
  );

  it('does not query the access gate for an ordinary commit', async () => {
    prisma.scormRegistration.findUnique.mockResolvedValue({
      ...courseRow,
      lastRuntimePullAt: new Date(Date.now() - 30_000),
    });
    await service.handlePostback(coursePostback);
    expect(prisma.userCourse.findFirst).not.toHaveBeenCalled();
  });

  /**
   * H1, end to end: the apply stamps lastRuntimeAppliedAt with the CLAIM
   * instant and lastPostbackAt with the receipt instant, so the pair still
   * reads clean for the postback that triggered the pull.
   */
  it('stamps the claim instant as applied and the receipt as the postback', async () => {
    cloud.getRegistrationProgress.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { id: 'cloud-reg-1', activityDetails: { id: 'B0', children: [] } };
    });
    await post(courseRow);

    const claimedAt =
      prisma.scormRegistration.updateMany.mock.calls[0][0].data
        .lastRuntimePullAt;
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.lastRuntimeAppliedAt).toEqual(claimedAt);
    expect(data.lastPostbackAt.getTime()).toBeLessThanOrEqual(
      claimedAt.getTime(),
    );
  });

  it('does not mark a debounced postback as applied', async () => {
    await post({
      ...courseRow,
      lastRuntimePullAt: new Date(Date.now() - 5_000),
    });
    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.lastPostbackAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty('lastRuntimeAppliedAt');
  });

  /** M2: a registration Cloud no longer has must stop being retried. */
  it('marks the runtime pulled when Cloud 404s the registration', async () => {
    cloud.getRegistrationProgress.mockRejectedValue(
      new ScormCloudHttpError(404, 'not found'),
    );
    await post(courseRow);
    const claimedAt =
      prisma.scormRegistration.updateMany.mock.calls[0][0].data
        .lastRuntimePullAt;
    expect(prisma.scormRegistration.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'reg-1',
        OR: [
          { lastRuntimeAppliedAt: null },
          { lastRuntimeAppliedAt: { lt: claimedAt } },
        ],
      },
      data: { lastRuntimeAppliedAt: claimedAt },
    });
  });

  it('does not mark the runtime pulled for a transient Cloud failure', async () => {
    cloud.getRegistrationProgress.mockRejectedValue(
      new ScormCloudHttpError(503, 'busy'),
    );
    await post(courseRow);
    expect(
      prisma.scormRegistration.updateMany.mock.calls.some(
        (c: any[]) => 'lastRuntimeAppliedAt' in c[0].data,
      ),
    ).toBe(false);
  });

  it('does not use the terminal floor once the registration is complete', async () => {
    prisma.scormRegistration.findUnique.mockResolvedValue({
      ...courseRow,
      lastRuntimePullAt: new Date(Date.now() - 30_000),
      completedAt: new Date(),
    });
    await service.handlePostback(terminalPostback);
    expect(cloud.getRegistrationProgress).not.toHaveBeenCalled();
  });

  /**
   * The floor counts ATTEMPTS. Stamping only on success would leave
   * lastRuntimePullAt untouched through a Cloud outage, so every Rise commit
   * would fire another outbound call for as long as it lasted.
   */
  it('stamps the pull time even when the Cloud call throws', async () => {
    cloud.getRegistrationProgress.mockRejectedValue(new Error('Cloud 503'));
    await post(courseRow);
    expect(prisma.scormRegistration.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { lastRuntimePullAt: expect.any(Date) },
      }),
    );
  });

  /** A typo in the env var must not silently disable the floor. */
  it('falls back to the default floor when the override is not a number', async () => {
    configValue = 'sixty-seconds';
    await post({
      ...courseRow,
      lastRuntimePullAt: new Date(Date.now() - 5_000),
    });
    expect(cloud.getRegistrationProgress).not.toHaveBeenCalled();
  });

  /**
   * The pull REPLACES the postback body and the two are instants apart. If the
   * pulled snapshot lags, taking its status verbatim reads as 'unknown',
   * completeOnSatisfied goes false and certification is skipped — silently,
   * because nothing throws, so Cloud gets a 200 and never retries.
   */
  it('keeps the postback completion when the pulled snapshot lags', async () => {
    cloud.getRegistrationProgress.mockResolvedValue({
      id: 'cloud-reg-1',
      registrationCompletion: 'INCOMPLETE',
      registrationSuccess: 'UNKNOWN',
      activityDetails: { id: 'B0', children: [] },
    });
    prisma.scormRegistration.findUnique.mockResolvedValue(courseRow);

    await service.handlePostback({
      ...coursePostback,
      registrationCompletion: 'COMPLETED',
      registrationSuccess: 'PASSED',
    });

    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.completionStatus).toBe('completed');
    expect(data.successStatus).toBe('passed');
  });

  it('takes the pulled status when it is the fresher one', async () => {
    cloud.getRegistrationProgress.mockResolvedValue({
      id: 'cloud-reg-1',
      registrationCompletion: 'COMPLETED',
      registrationSuccess: 'PASSED',
      activityDetails: { id: 'B0', children: [] },
    });
    prisma.scormRegistration.findUnique.mockResolvedValue(courseRow);

    await service.handlePostback(coursePostback);

    const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
    expect(data.completionStatus).toBe('completed');
    expect(data.successStatus).toBe('passed');
  });

  /**
   * `scoreScaled` is written unguarded downstream, so a pull that lags the
   * postback would otherwise discard the higher score it just carried.
   */
  it('keeps the higher score when the pulled snapshot lags', async () => {
    cloud.getRegistrationProgress.mockResolvedValue({
      id: 'cloud-reg-1',
      score: { scaled: 0.4 },
      activityDetails: { id: 'B0', children: [] },
    });
    prisma.scormRegistration.findUnique.mockResolvedValue(courseRow);

    await service.handlePostback({ ...coursePostback, score: { scaled: 0.9 } });

    expect(
      prisma.scormRegistration.update.mock.calls.at(-1)[0].data.scoreScaled,
    ).toBe(0.9);
  });

  it('falls back to the postback snapshot when the pull throws', async () => {
    cloud.getRegistrationProgress.mockRejectedValue(new Error('Cloud 503'));
    await expect(post(courseRow)).resolves.toBeUndefined();
  });

  it('falls back to the postback snapshot when the pull returns no usable body', async () => {
    cloud.getRegistrationProgress.mockResolvedValue(undefined);
    await expect(post(courseRow)).resolves.toBeUndefined();
  });

  describe('reconcile', () => {
    const queriedSql = (call: number): string =>
      String(prisma.$queryRaw.mock.calls[call]?.[0]?.sql ?? '').replace(
        /\s+/g,
        ' ',
      );

    beforeEach(() => {
      prisma.scormRegistration.findMany = jest.fn(async ({ where }: any) =>
        (where.id.in as string[]).map((id) => ({ ...courseRow, id })),
      );
      prisma.scormRegistration.findUnique.mockImplementation(
        async ({ where }: any) => ({ ...courseRow, id: where.id }),
      );
    });

    /**
     * A debounced or failed pull leaves the learner's last lessons only in
     * Cloud; without priority it waits behind the oldest-first sweep.
     */
    it('puts dirty registrations first and dedupes them against the sweep', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: 'dirty-1' }, { id: 'both' }])
        .mockResolvedValueOnce([{ id: 'both' }, { id: 'old-1' }]);

      const result = await service.reconcileCron();

      expect(queriedSql(0)).toContain(
        '"lastPostbackAt" > sr."lastRuntimeAppliedAt"',
      );
      expect(result.candidates).toBe(3);
      expect(cloud.getRegistrationProgress.mock.calls.map((c) => c[0])).toEqual(
        ['cloud-reg-1', 'cloud-reg-1', 'cloud-reg-1'],
      );
      expect(prisma.scormRegistration.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['dirty-1', 'both', 'old-1'] } },
      });
    });

    /** Dirty slots are additive: the sweep keeps all 20 of its own. */
    it('pulls the dirty rows on top of a full sweep', async () => {
      const ids = (prefix: string, n: number) =>
        Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}` }));
      prisma.$queryRaw
        .mockResolvedValueOnce(ids('dirty', 10))
        .mockResolvedValueOnce(ids('old', 20));

      const result = await service.reconcileCron();
      expect(result.candidates).toBe(30);
      expect(cloud.getRegistrationProgress).toHaveBeenCalledTimes(30);
      expect(String(prisma.$queryRaw.mock.calls[0][0].values)).toContain('10');
      expect(prisma.$queryRaw.mock.calls[1][0].values).toContain(20);
    });

    /**
     * 30 items × a 10s Cloud timeout at concurrency 5 is ~72s, past Vercel's
     * 60s. Nothing new starts after the deadline; the rest wait for next run.
     */
    it('starts no new pull after the deadline', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      try {
        prisma.$queryRaw
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(
            Array.from({ length: 12 }, (_, i) => ({ id: `r-${i}` })),
          );
        cloud.getRegistrationProgress.mockImplementation(async () => {
          // Every read takes the full Cloud timeout.
          jest.advanceTimersByTime(10_000);
          return { id: 'cloud-reg-1' };
        });

        const result = await service.reconcileCron();
        // Waves at t=0,10,20 start (15 slots ≥ 12)… but each worker's item
        // advances the clock, so only items started before 30s run.
        expect(result.deferred).toBeGreaterThan(0);
        expect(result.updated + result.deferred).toBe(12);
        expect(cloud.getRegistrationProgress.mock.calls.length).toBe(
          result.updated,
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('honours an earlier invocation deadline from the daily cron', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'r-1' }, { id: 'r-2' }]);
      const result = await service.reconcileCron(Date.now() - 1);
      expect(result).toMatchObject({ candidates: 2, updated: 0, deferred: 2 });
      expect(cloud.getRegistrationProgress).not.toHaveBeenCalled();
    });

    it('scopes the dirty query to recent dirt on live packages', async () => {
      await service.reconcileCron();
      const sql = queriedSql(0);
      expect(sql).toContain('sr."lastPostbackAt" >= ');
      expect(sql).toContain('sp."status" <> \'PRUNED\'');
      const since = prisma.$queryRaw.mock.calls[0][0].values.find(
        (v: unknown) =>
          v instanceof Date && Date.now() - v.getTime() > 13 * 86_400_000,
      );
      expect(since).toBeDefined();
      expect(queriedSql(1)).toContain('sp."status" <> \'PRUNED\'');
      // Rotates by last pull, so the same abandoned rows cannot hog the sweep.
      expect(queriedSql(1)).toContain(
        'ORDER BY sr."lastRuntimePullAt" ASC NULLS FIRST',
      );
    });

    /** Only real postbacks move lastPostbackAt; reconcile stamps the claim. */
    it('stamps the claim instant and leaves lastPostbackAt alone', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: 'reg-1' }])
        .mockResolvedValueOnce([]);
      cloud.getRegistrationProgress.mockResolvedValue({
        id: 'cloud-reg-1',
        activityDetails: { id: 'B0', children: [] },
      });

      await service.reconcileCron();

      const claimedAt =
        prisma.scormRegistration.updateMany.mock.calls[0][0].data
          .lastRuntimePullAt;
      const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
      expect(data).not.toHaveProperty('lastPostbackAt');
      expect(data.lastRuntimeAppliedAt).toEqual(claimedAt);
    });

    it('marks a registration Cloud 404s so it leaves the dirty queue', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: 'reg-1' }])
        .mockResolvedValueOnce([]);
      cloud.getRegistrationProgress.mockRejectedValue(
        new ScormCloudHttpError(404, 'gone'),
      );

      await service.reconcileCron();
      expect(prisma.scormRegistration.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { lastRuntimeAppliedAt: expect.any(Date) },
        }),
      );
    });

    it('keeps at most five Cloud reads in flight', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(
          Array.from({ length: 12 }, (_, i) => ({ id: `r-${i}` })),
        );
      let inFlight = 0;
      let peak = 0;
      cloud.getRegistrationProgress.mockImplementation(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return { id: 'cloud-reg-1' };
      });

      const result = await service.reconcileCron();
      expect(result.updated).toBe(12);
      expect(peak).toBeLessThanOrEqual(5);
      expect(peak).toBeGreaterThan(1);
    });
  });

  describe('pull-on-read', () => {
    const progressRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'reg-1',
      packageId: 'pkg-1',
      scormCloudRegistrationId: 'cloud-reg-1',
      completionStatus: 'incomplete',
      lessonsCompleted: 2,
      lastPostbackAt: new Date(Date.now() - 30_000),
      lastRuntimeAppliedAt: new Date(Date.now() - 30_000),
      ...overrides,
    });

    beforeEach(() => {
      prisma.scormRegistration.findFirst = jest.fn();
      prisma.scormPackage.findUnique.mockResolvedValue({ lessonCount: 14 });
    });

    it('answers from the DB without a Cloud call for a clean row', async () => {
      prisma.scormRegistration.findFirst.mockResolvedValue(progressRow());
      const result = await service.getLearnerProgress('user-1', 'course-1');

      expect(cloud.getRegistrationProgress).not.toHaveBeenCalled();
      expect(result.data).toMatchObject({
        lessonsCompleted: 2,
        lessonsTotal: 14,
      });
      // Bookkeeping fields stay out of the response contract.
      expect(result.data).not.toHaveProperty('scormCloudRegistrationId');
      expect(result.data).not.toHaveProperty('lastRuntimeAppliedAt');
    });

    /**
     * The learner's last commit was debounced: lastPostbackAt is newer than
     * the last applied runtime. Pull first, then answer from the fresh row.
     */
    it('pulls a dirty row first and answers from the refreshed one', async () => {
      prisma.scormRegistration.findFirst.mockResolvedValue(
        progressRow({ lastRuntimeAppliedAt: new Date(Date.now() - 90_000) }),
      );
      prisma.scormRegistration.findUnique
        .mockResolvedValueOnce({ ...courseRow })
        .mockResolvedValueOnce(progressRow({ lessonsCompleted: 5 }));

      const result = await service.getLearnerProgress('user-1', 'course-1');

      expect(cloud.getRegistrationProgress).toHaveBeenCalledWith(
        'cloud-reg-1',
        'full',
      );
      expect(result.data).toMatchObject({ lessonsCompleted: 5 });
    });

    it('respects the pull floor on the read path too', async () => {
      prisma.scormRegistration.findFirst.mockResolvedValue(
        progressRow({ lastRuntimeAppliedAt: null }),
      );
      prisma.scormRegistration.updateMany.mockResolvedValue({ count: 0 });

      await service.getLearnerProgress('user-1', 'course-1');
      expect(cloud.getRegistrationProgress).not.toHaveBeenCalled();
    });

    it('still answers when the pull fails', async () => {
      prisma.scormRegistration.findFirst.mockResolvedValue(
        progressRow({ lastRuntimeAppliedAt: null }),
      );
      cloud.getRegistrationProgress.mockRejectedValue(new Error('Cloud 503'));

      const result = await service.getLearnerProgress('user-1', 'course-1');
      expect(result.data).toMatchObject({ lessonsCompleted: 2 });
    });

    /** A hung Cloud call must not hold the page render hostage. */
    it('answers within the read budget when Cloud hangs', async () => {
      prisma.scormRegistration.findFirst.mockResolvedValue(
        progressRow({ lastRuntimeAppliedAt: null }),
      );
      // Hangs for the test, then settles so nothing outlives it.
      let release!: () => void;
      cloud.getRegistrationProgress.mockReturnValue(
        new Promise((_, reject) => {
          release = () => reject(new Error('released'));
        }),
      );

      try {
        const started = Date.now();
        const result = await service.getLearnerProgress('user-1', 'course-1');
        expect(Date.now() - started).toBeLessThan(4_000);
        expect(result.data).toMatchObject({ lessonsCompleted: 2 });
      } finally {
        release();
        await new Promise((r) => setImmediate(r));
      }
    }, 10_000);

    /** M2: a pruned package's Cloud registrations are deleted; a pull can only 404. */
    it('does not pull for a registration on a pruned package', async () => {
      prisma.scormRegistration.findFirst.mockResolvedValue(
        progressRow({ lastRuntimeAppliedAt: null }),
      );
      prisma.scormPackage.findUnique.mockResolvedValue({
        lessonCount: 14,
        status: ScormPackageStatus.PRUNED,
      });

      await service.getLearnerProgress('user-1', 'course-1');
      expect(prisma.scormRegistration.updateMany).not.toHaveBeenCalled();
      expect(cloud.getRegistrationProgress).not.toHaveBeenCalled();
    });

    it('looks the package status up when an admin caller does not pass it', async () => {
      prisma.scormPackage.findUnique.mockResolvedValue({
        status: ScormPackageStatus.PRUNED,
      });
      const refreshed = await service.refreshIfDirty(
        progressRow({ lastRuntimeAppliedAt: null }) as any,
      );
      expect(refreshed).toBe(false);
      expect(cloud.getRegistrationProgress).not.toHaveBeenCalled();
    });

    /**
     * The pull's answer can land long after the read gave up waiting. Stamped
     * with the claim instant, never with when it finally applied, and never
     * as a postback.
     */
    it('stamps the claim instant, not lastPostbackAt', async () => {
      prisma.scormRegistration.findFirst.mockResolvedValue(
        progressRow({ lastRuntimeAppliedAt: null }),
      );
      prisma.scormRegistration.findUnique.mockResolvedValue({ ...courseRow });
      cloud.getRegistrationProgress.mockResolvedValue({
        id: 'cloud-reg-1',
        activityDetails: { id: 'B0', children: [] },
      });

      await service.getLearnerProgress('user-1', 'course-1');

      const claimedAt =
        prisma.scormRegistration.updateMany.mock.calls[0][0].data
          .lastRuntimePullAt;
      const data = prisma.scormRegistration.update.mock.calls.at(-1)[0].data;
      expect(data.lastRuntimeAppliedAt).toEqual(claimedAt);
      expect(data).not.toHaveProperty('lastPostbackAt');
    });

    it('stops retrying a registration Cloud 404s', async () => {
      prisma.scormRegistration.findFirst.mockResolvedValue(
        progressRow({ lastRuntimeAppliedAt: null }),
      );
      cloud.getRegistrationProgress.mockRejectedValue(
        new ScormCloudHttpError(404, 'gone'),
      );

      await service.getLearnerProgress('user-1', 'course-1');
      expect(prisma.scormRegistration.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: { lastRuntimeAppliedAt: expect.any(Date) },
        }),
      );
    });

    /**
     * L6: the bridge stamps every section, so the percentage engine reads 100%
     * for a certified learner; "3 of 14" beside it reads as a bug.
     */
    it('reports every lesson complete once certified, keeping the decoded figure', async () => {
      prisma.scormRegistration.findFirst.mockResolvedValue(
        progressRow({ lessonsCompleted: 3, completedAt: new Date() }),
      );
      const result = await service.getLearnerProgress('user-1', 'course-1');
      expect(result.data).toMatchObject({
        lessonsCompleted: 14,
        lessonsCompletedDecoded: 3,
        lessonsTotal: 14,
      });
    });

    it('reports the decoded count before certification', async () => {
      prisma.scormRegistration.findFirst.mockResolvedValue(
        progressRow({ lessonsCompleted: 3, completedAt: null }),
      );
      const result = await service.getLearnerProgress('user-1', 'course-1');
      expect(result.data).toMatchObject({
        lessonsCompleted: 3,
        lessonsCompletedDecoded: 3,
      });
    });
  });
});

/** LZW encoder mirroring scripts/build-scorm-fixtures.ts, for ad-hoc blobs. */
function encodeSuspendData(payload: unknown): string {
  const input = JSON.stringify(payload);
  const dictionary = new Map<string, number>();
  for (let i = 0; i < 256; i += 1) dictionary.set(String.fromCharCode(i), i);
  let nextCode = 256;
  let current = '';
  const out: number[] = [];
  for (const char of input) {
    const candidate = current + char;
    if (dictionary.has(candidate)) {
      current = candidate;
    } else {
      out.push(dictionary.get(current)!);
      dictionary.set(candidate, nextCode);
      nextCode += 1;
      current = char;
    }
  }
  if (current !== '') out.push(dictionary.get(current)!);
  return JSON.stringify({ v: 3, d: out });
}
