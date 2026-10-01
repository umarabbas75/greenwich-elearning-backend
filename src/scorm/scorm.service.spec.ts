import { readFileSync } from 'fs';
import { join } from 'path';
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, ScormPackageStatus } from '@prisma/client';
import { CourseVersionService } from '../course-version/course-version.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ScormCloudClient,
  ScormCloudHttpError,
  ScormCloudTimeoutError,
} from '../scorm-cloud/scorm-cloud.client';
import {
  IMPORT_START_LOCK_SEED,
  riseIndexSpaceWarning,
  ScormService,
} from './scorm.service';
import { makeAbortAwareTransactionMock } from '../test-utils/prisma-transaction-mock';

/**
 * $queryRaw for the advisory try-locks ([{ locked: true }]) and the tree tx's
 * `SELECT status, "sectionId" ... FOR UPDATE`, which answers from the
 * findUnique mock so each test's row state drives both reads.
 */
const rawQueryMock = (prisma: Record<string, any>) =>
  jest.fn(async (sql: any) => {
    if (/FOR UPDATE/.test(sql?.sql ?? '')) {
      const row = await prisma.scormPackage.findUnique({
        where: { id: sql.values[0] },
      });
      return row ? [{ status: row.status, sectionId: row.sectionId }] : [];
    }
    return [{ locked: true }];
  });

/** Conditional writes go through `update` so tests observe one write log. */
const updateManyViaUpdate = (prisma: Record<string, any>) =>
  jest.fn(async (args: any) => {
    await prisma.scormPackage.update(args);
    return { count: 1 };
  });

describe('ScormService', () => {
  let service: ScormService;
  let prisma: Record<string, any>;
  let cloud: Record<string, jest.Mock>;
  let courseVersionService: Record<string, jest.Mock>;

  beforeEach(async () => {
    prisma = {
      course: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      module: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
      chapter: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      section: {
        createMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      scormPackage: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      $transaction: undefined as any,
    };
    prisma.$queryRaw = rawQueryMock(prisma);
    prisma.scormPackage.updateMany = updateManyViaUpdate(prisma);
    prisma.$transaction = makeAbortAwareTransactionMock(prisma);

    cloud = {
      createFetchAndImportCourseJob: jest.fn().mockResolvedValue('job-1'),
      createUploadAndImportCourseJob: jest
        .fn()
        .mockResolvedValue('job-upload-1'),
      getImportJobStatus: jest.fn(),
      getCourseAsset: jest.fn(),
      setCourseConfiguration: jest.fn().mockResolvedValue(undefined),
    };

    courseVersionService = {
      publishNewVersion: jest.fn().mockResolvedValue({
        versionNumber: 1,
        id: 'ver-1',
      }),
      getLatestPublishedVersion: jest.fn().mockResolvedValue(null),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ScormService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScormCloudClient, useValue: cloud },
        { provide: CourseVersionService, useValue: courseVersionService },
      ],
    }).compile();

    service = moduleRef.get(ScormService);
  });

  it('rolls back a course it created when Cloud rejects the import job', async () => {
    // Without this, a rejected import leaves a permanently broken catalogue
    // row: no tree, no version, "0 units", and setCourseActive refuses it
    // forever — with nothing on screen saying why.
    prisma.course.create.mockResolvedValue({ id: 'course-1', title: 'New' });
    prisma.course.findUnique.mockResolvedValue(null);
    prisma.scormPackage.findFirst.mockResolvedValue(null);
    prisma.scormPackage.create.mockResolvedValue({ id: 'pkg-1' });
    prisma.scormPackage.delete = jest.fn().mockResolvedValue({});
    prisma.course.delete = jest.fn().mockResolvedValue({});
    cloud.createFetchAndImportCourseJob.mockRejectedValue(
      new Error(
        'The maximum number of courses for this account type has been reached.',
      ),
    );

    await expect(
      service.createPackage('admin-1', {
        contentUrl: 'https://example.com/course.zip',
        completeOn: 'completed',
        title: 'New',
      } as any),
    ).rejects.toThrow();

    expect(prisma.scormPackage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ScormPackageStatus.FAILED }),
      }),
    );
    expect(prisma.scormPackage.delete).toHaveBeenCalledWith({
      where: { id: 'pkg-1' },
    });
    expect(prisma.course.delete).toHaveBeenCalledWith({
      where: { id: 'course-1' },
    });
  });

  describe('when the import-start POST times out', () => {
    // The POST may have reached Cloud, and Cloud can go on creating the
    // course after we stop waiting — so the Cloud course is deleted best
    // effort, but the row pointing at it is never rolled back.
    beforeEach(() => {
      prisma.course.create.mockResolvedValue({ id: 'course-1', title: 'New' });
      prisma.course.findUnique.mockResolvedValue(null);
      prisma.scormPackage.findFirst.mockResolvedValue(null);
      prisma.scormPackage.create.mockResolvedValue({ id: 'pkg-1' });
      prisma.scormPackage.delete = jest.fn().mockResolvedValue({});
      prisma.course.delete = jest.fn().mockResolvedValue({});
      cloud.deleteCourse = jest.fn().mockResolvedValue(undefined);
      cloud.createFetchAndImportCourseJob.mockRejectedValue(
        new ScormCloudTimeoutError('POST /courses/importJobs', 10_000),
      );
    });

    const start = () =>
      service.createPackage('admin-1', {
        contentUrl: 'https://example.com/course.zip',
        completeOn: 'completed',
        title: 'New',
      } as any);

    const expectRowKept = () => {
      const cloudCourseId =
        prisma.scormPackage.create.mock.calls[0][0].data.scormCloudCourseId;
      // The row's scormCloudCourseId is the only pointer to the Cloud course.
      expect(prisma.scormPackage.delete).not.toHaveBeenCalled();
      expect(prisma.course.delete).not.toHaveBeenCalled();
      expect(prisma.scormPackage.update).toHaveBeenCalledWith({
        where: { id: 'pkg-1' },
        data: {
          status: ScormPackageStatus.FAILED,
          failureReason: expect.stringContaining(cloudCourseId),
        },
      });
    };

    it('deletes the Cloud course on a short budget but keeps the FAILED row and course', async () => {
      await expect(start()).rejects.toBeInstanceOf(ScormCloudTimeoutError);
      const cloudCourseId =
        prisma.scormPackage.create.mock.calls[0][0].data.scormCloudCourseId;
      expect(cloud.deleteCourse).toHaveBeenCalledWith(cloudCourseId, {
        timeoutMs: 5000,
      });
      expectRowKept();
    });

    it('keeps the row even when the delete 404s (Cloud may still create it)', async () => {
      cloud.deleteCourse.mockRejectedValue(new ScormCloudHttpError(404, ''));
      await expect(start()).rejects.toBeInstanceOf(ScormCloudTimeoutError);
      expectRowKept();
    });

    it('keeps the row when the cleanup delete fails too', async () => {
      cloud.deleteCourse.mockRejectedValue(
        new ScormCloudTimeoutError('DELETE /courses/x', 5_000),
      );
      await expect(start()).rejects.toBeInstanceOf(ScormCloudTimeoutError);
      expectRowKept();
    });
  });

  it('starts upload import via SCORM Cloud multipart', async () => {
    prisma.course.create.mockResolvedValue({
      id: 'course-up',
      title: 'Upload',
    });
    prisma.course.findUnique.mockResolvedValue(null);
    prisma.scormPackage.findFirst.mockResolvedValue(null);
    prisma.scormPackage.create.mockResolvedValue({
      id: 'pkg-up',
      courseId: 'course-up',
      status: ScormPackageStatus.PROCESSING,
    });
    prisma.scormPackage.update.mockResolvedValue({
      id: 'pkg-up',
      cloudImportJobId: 'job-upload-1',
      createdAt: new Date(),
    });

    const res = await service.createPackageFromUpload(
      'admin-1',
      Buffer.from('fake-zip'),
      {
        completeOn: 'completed',
        title: 'Upload',
        filename: 'test.zip',
      },
    );

    expect(cloud.createUploadAndImportCourseJob).toHaveBeenCalled();
    expect(res.data).toMatchObject({ id: 'pkg-up' });
  });

  it('keeps an existing course when Cloud rejects the import job', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-9',
      title: 'Existing',
      deliveryMode: 'IMPORTED_SCORM',
    });
    prisma.course.update.mockResolvedValue({
      id: 'course-9',
      title: 'Existing',
    });
    prisma.scormPackage.findFirst.mockResolvedValue(null);
    prisma.scormPackage.create.mockResolvedValue({ id: 'pkg-9' });
    prisma.scormPackage.delete = jest.fn().mockResolvedValue({});
    prisma.course.delete = jest.fn().mockResolvedValue({});
    cloud.createFetchAndImportCourseJob.mockRejectedValue(new Error('nope'));

    await expect(
      service.createPackage('admin-1', {
        courseId: 'course-9',
        contentUrl: 'https://example.com/course.zip',
        completeOn: 'completed',
      } as any),
    ).rejects.toThrow();

    // The FAILED package stays as history and the course is untouched.
    expect(prisma.course.delete).not.toHaveBeenCalled();
    expect(prisma.scormPackage.delete).not.toHaveBeenCalled();
  });

  describe('starting an import', () => {
    const existingCourse = () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'course-9',
        title: 'Existing',
        deliveryMode: 'IMPORTED_SCORM',
      });
      prisma.course.update.mockResolvedValue({
        id: 'course-9',
        title: 'Existing',
      });
    };

    /**
     * Two concurrent starts could both pass the in-flight check and, with
     * different version numbers, both create a PROCESSING row.
     */
    it('answers 409 without creating a row when another start holds the course lock', async () => {
      existingCourse();
      prisma.$queryRaw.mockResolvedValueOnce([{ locked: false }]);

      await expect(
        service.createPackage('admin-1', {
          courseId: 'course-9',
          contentUrl: 'https://example.com/course.zip',
          completeOn: 'completed',
        } as any),
      ).rejects.toThrow(/import is starting/);

      const lockSql = prisma.$queryRaw.mock.calls[0][0];
      expect(lockSql.values).toEqual(['course-9', IMPORT_START_LOCK_SEED]);
      // Only the pre-lock look for a day-old in-flight row to poll; the
      // in-flight check itself never ran.
      expect(prisma.scormPackage.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.scormPackage.create).not.toHaveBeenCalled();
      expect(cloud.createFetchAndImportCourseJob).not.toHaveBeenCalled();
    });

    it('runs the in-flight check and the create inside the locked transaction', async () => {
      existingCourse();
      prisma.scormPackage.findFirst.mockResolvedValue(null);
      prisma.scormPackage.create.mockResolvedValue({ id: 'pkg-9' });
      prisma.scormPackage.update.mockResolvedValue({ id: 'pkg-9' });

      await service.createPackage('admin-1', {
        courseId: 'course-9',
        contentUrl: 'https://example.com/course.zip',
        completeOn: 'completed',
      } as any);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const lockOrder = prisma.$queryRaw.mock.invocationCallOrder[0];
      // [0] is the pre-lock stale-row lookup; [1] the in-flight check.
      expect(lockOrder).toBeLessThan(
        prisma.scormPackage.findFirst.mock.invocationCallOrder[1],
      );
      expect(lockOrder).toBeLessThan(
        prisma.scormPackage.create.mock.invocationCallOrder[0],
      );
    });

    /**
     * Cloud accepted the job, so a Cloud course exists. Rolling back the new
     * course+package here would delete the only pointer to it.
     */
    it('keeps the rows (FAILED, naming the Cloud course) when only the job-id write fails', async () => {
      prisma.course.create.mockResolvedValue({ id: 'course-1', title: 'New' });
      prisma.course.findUnique.mockResolvedValue(null);
      prisma.scormPackage.findFirst.mockResolvedValue(null);
      prisma.scormPackage.create.mockResolvedValue({ id: 'pkg-1' });
      prisma.scormPackage.delete = jest.fn().mockResolvedValue({});
      prisma.course.delete = jest.fn().mockResolvedValue({});
      cloud.deleteCourse = jest.fn();
      const dbErr = new Error('connection reset');
      prisma.scormPackage.update.mockRejectedValue(dbErr);
      prisma.scormPackage.updateMany = jest
        .fn()
        .mockResolvedValue({ count: 1 });

      await expect(
        service.createPackage('admin-1', {
          contentUrl: 'https://example.com/course.zip',
          completeOn: 'completed',
          title: 'New',
        } as any),
      ).rejects.toBe(dbErr);

      const cloudCourseId =
        prisma.scormPackage.create.mock.calls[0][0].data.scormCloudCourseId;
      expect(prisma.scormPackage.delete).not.toHaveBeenCalled();
      expect(prisma.course.delete).not.toHaveBeenCalled();
      expect(cloud.deleteCourse).not.toHaveBeenCalled();
      expect(prisma.scormPackage.updateMany).toHaveBeenCalledWith({
        where: { id: 'pkg-1', status: ScormPackageStatus.PROCESSING },
        data: {
          status: ScormPackageStatus.FAILED,
          failureReason: expect.stringContaining(cloudCourseId),
        },
      });
    });
  });

  describe('a Cloud timeout after the import job completed', () => {
    const processing = {
      id: 'pkg-1',
      courseId: 'course-1',
      versionNumber: 1,
      status: ScormPackageStatus.PROCESSING,
      cloudImportJobId: 'job-1',
      createdAt: new Date(),
      scormCloudCourseId: 'cloud-1',
      sectionId: null,
      completeOn: 'passed',
      passingScore: null,
      title: 'Lifting',
    };

    beforeEach(() => {
      prisma.scormPackage.findUnique.mockResolvedValue(processing);
      cloud.getImportJobStatus.mockResolvedValue({ status: 'COMPLETE' });
    });

    it('leaves the package PROCESSING when setCourseConfiguration times out', async () => {
      cloud.setCourseConfiguration.mockRejectedValue(
        new ScormCloudTimeoutError(
          'POST /courses/cloud-1/configuration',
          10_000,
        ),
      );
      const result = await service.completeImportIfReady('pkg-1', 'admin-1');
      expect(result.status).toBe(ScormPackageStatus.PROCESSING);
      expect(prisma.scormPackage.update).not.toHaveBeenCalled();
      expect(cloud.getCourseAsset).not.toHaveBeenCalled();
    });

    it('still FAILs on a real Cloud error from setCourseConfiguration', async () => {
      cloud.setCourseConfiguration.mockRejectedValue(
        new ScormCloudHttpError(400, 'bad setting'),
      );
      let written = {};
      prisma.scormPackage.findUnique.mockImplementation(async () => ({
        ...processing,
        ...written,
      }));
      prisma.scormPackage.update.mockImplementation(async ({ data }) => {
        written = data;
        return { ...processing, ...data };
      });
      const result = await service.completeImportIfReady('pkg-1', 'admin-1');
      expect(result.status).toBe(ScormPackageStatus.FAILED);
      expect(prisma.scormPackage.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'pkg-1',
          status: ScormPackageStatus.PROCESSING,
          sectionId: null,
        },
        data: expect.objectContaining({ status: ScormPackageStatus.FAILED }),
      });
    });

    /**
     * A concurrent poll built the tree while this one was out at Cloud. Its
     * FAILED write must match nothing, and the answer is the row as it now
     * stands — not a FAILED row stranding live sections.
     */
    describe('never FAILs over a tree a concurrent poll just built', () => {
      const built = {
        ...processing,
        sectionId: 'sec-other',
        chapterId: 'ch-1',
      };
      beforeEach(() => {
        prisma.scormPackage.findUnique
          .mockReset()
          .mockResolvedValueOnce(processing)
          .mockResolvedValue(built);
        prisma.scormPackage.updateMany = jest
          .fn()
          .mockResolvedValue({ count: 0 });
      });

      const expectUntouched = (result: any) => {
        expect(prisma.scormPackage.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: 'pkg-1',
              status: ScormPackageStatus.PROCESSING,
              sectionId: null,
            },
          }),
        );
        expect(prisma.scormPackage.update).not.toHaveBeenCalled();
        expect(result.status).toBe(ScormPackageStatus.PROCESSING);
        expect(result.sectionId).toBe('sec-other');
      };

      it('on a launch-configuration error', async () => {
        cloud.setCourseConfiguration.mockRejectedValue(
          new ScormCloudHttpError(400, 'bad setting'),
        );
        expectUntouched(
          await service.completeImportIfReady('pkg-1', 'admin-1'),
        );
      });

      it('on a gate refusal (probe unavailable, completeOn passed)', async () => {
        cloud.getCourseAsset.mockRejectedValue(new Error('asset missing'));
        expectUntouched(
          await service.completeImportIfReady('pkg-1', 'admin-1'),
        );
      });

      it('on a tree-transaction failure', async () => {
        cloud.getCourseAsset.mockResolvedValue(
          readFileSync(
            join(__dirname, '../utils/fixtures/rise-runtime-lifting.js'),
            'utf8',
          ),
        );
        // completeOn 'completed' so the gate lets it reach the tree tx.
        const completed = { ...processing, completeOn: 'completed' };
        prisma.scormPackage.findUnique
          .mockReset()
          .mockResolvedValueOnce(completed)
          .mockResolvedValueOnce(completed) // the tree tx's FOR UPDATE read
          .mockResolvedValue({ ...built, completeOn: 'completed' });
        prisma.scormPackage.findFirst.mockResolvedValue(null);
        prisma.module.create.mockResolvedValue({ id: 'mod-1' });
        prisma.chapter.create.mockResolvedValue({ id: 'ch-1' });
        prisma.section.createMany.mockRejectedValue(new Error('boom'));
        expectUntouched(
          await service.completeImportIfReady('pkg-1', 'admin-1'),
        );
      });
    });

    it('leaves the package PROCESSING when the Rise probe times out (no binary fallback, no passed-refusal)', async () => {
      cloud.getCourseAsset.mockRejectedValue(
        new ScormCloudTimeoutError('GET /courses/cloud-1/asset', 10_000),
      );
      const result = await service.completeImportIfReady('pkg-1', 'admin-1');
      expect(result.status).toBe(ScormPackageStatus.PROCESSING);
      expect(prisma.scormPackage.update).not.toHaveBeenCalled();
      expect(prisma.section.createMany).not.toHaveBeenCalled();
      expect(courseVersionService.publishNewVersion).not.toHaveBeenCalled();
    });
  });

  it('surfaces a Cloud ERROR job as FAILED', async () => {
    const row = {
      id: 'pkg-1',
      status: ScormPackageStatus.PROCESSING,
      cloudImportJobId: 'job-1',
      createdAt: new Date(),
      sectionId: null,
      completeOn: 'completed',
    };
    prisma.scormPackage.findUnique
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({
        ...row,
        status: ScormPackageStatus.FAILED,
        failureReason: 'not a zip',
      });
    cloud.getImportJobStatus.mockResolvedValue({
      status: 'ERROR',
      message: 'not a zip',
    });

    const result = await service.completeImportIfReady('pkg-1', 'admin-1');
    expect(result.status).toBe(ScormPackageStatus.FAILED);
    expect(result.failureReason).toContain('not a zip');
    // Conditional, like failIfStale: never overwrites a row another poll moved.
    expect(prisma.scormPackage.updateMany).toHaveBeenCalledWith({
      where: { id: 'pkg-1', status: ScormPackageStatus.PROCESSING },
      data: {
        status: ScormPackageStatus.FAILED,
        failureReason: 'not a zip',
      },
    });
    expect(courseVersionService.publishNewVersion).not.toHaveBeenCalled();
  });

  it('refuses completeOn passed when the probe finds zero quiz items', async () => {
    prisma.scormPackage.findUnique.mockResolvedValue({
      id: 'pkg-1',
      status: ScormPackageStatus.PROCESSING,
      cloudImportJobId: 'job-1',
      createdAt: new Date(),
      scormCloudCourseId: 'cloud-1',
      sectionId: null,
      completeOn: 'passed',
      title: 'Lifting',
    });
    cloud.getImportJobStatus.mockResolvedValue({ status: 'COMPLETE' });
    cloud.getCourseAsset.mockResolvedValue(
      readFileSync(
        join(__dirname, '../utils/fixtures/rise-runtime-lifting.js'),
        'utf8',
      ),
    );
    let written = {};
    const base = prisma.scormPackage.findUnique.getMockImplementation()!;
    prisma.scormPackage.findUnique.mockImplementation(async (args: any) => ({
      ...(await base(args)),
      ...written,
    }));
    prisma.scormPackage.update.mockImplementation(async ({ data }) => {
      written = data;
      return { id: 'pkg-1', ...data };
    });

    const result = await service.completeImportIfReady('pkg-1', 'admin-1');
    expect(result.status).toBe(ScormPackageStatus.FAILED);
    expect(result.failureReason).toMatch(/no scoreable quiz/i);
    expect(courseVersionService.publishNewVersion).not.toHaveBeenCalled();
  });

  it('persists importWarning when completeOn completed but the Rise probe is unavailable', async () => {
    let treeExists = false;
    let written: Record<string, unknown> = {};
    prisma.scormPackage.findUnique.mockImplementation(async () => ({
      id: 'pkg-1',
      courseId: 'course-1',
      versionNumber: 1,
      completeOn: 'completed',
      passingScore: null,
      title: 'Storyline export',
      scormCloudCourseId: 'cloud-1',
      cloudImportJobId: 'job-1',
      createdAt: new Date(),
      status: ScormPackageStatus.PROCESSING,
      sectionId: treeExists ? 'sec-1' : null,
      ...written,
    }));
    cloud.getImportJobStatus.mockResolvedValue({ status: 'COMPLETE' });
    cloud.getCourseAsset.mockRejectedValue(new Error('asset missing'));
    prisma.scormPackage.findFirst.mockResolvedValue(null);
    prisma.module.create.mockResolvedValue({ id: 'mod-1' });
    prisma.chapter.create.mockResolvedValue({ id: 'ch-1' });
    prisma.section.createMany.mockImplementation(async () => {
      treeExists = true;
      return { count: 1 };
    });
    prisma.scormPackage.update.mockImplementation(async ({ data }) => {
      if (data.status === ScormPackageStatus.READY) written = data;
      return { id: 'pkg-1', courseId: 'course-1', ...data };
    });

    const result = await service.completeImportIfReady('pkg-1', 'admin-1');

    expect(cloud.setCourseConfiguration).toHaveBeenCalledWith(
      'cloud-1',
      expect.arrayContaining([
        expect.objectContaining({
          settingId: 'PlayerLaunchType',
          value: 'FRAMESET',
        }),
        expect.objectContaining({
          settingId: 'PlayerScoLaunchType',
          value: 'FRAMESET',
        }),
      ]),
    );
    expect(result.status).toBe(ScormPackageStatus.READY);
    expect(result.importWarning).toMatch(/probe unavailable/i);
    expect(courseVersionService.publishNewVersion).toHaveBeenCalled();
  });

  it('publishes a version after the first successful import', async () => {
    let treeExists = false;
    let published = false;
    prisma.scormPackage.findUnique.mockImplementation(async () => {
      const common = {
        id: 'pkg-1',
        courseId: 'course-1',
        versionNumber: 1,
        completeOn: 'completed',
        passingScore: null,
        title: 'Lifting',
        scormCloudCourseId: 'cloud-1',
        cloudImportJobId: 'job-1',
        createdAt: new Date(),
      };
      if (published) {
        return {
          ...common,
          status: ScormPackageStatus.READY,
          sectionId: 'sec-1',
        };
      }
      if (!treeExists) {
        return {
          ...common,
          status: ScormPackageStatus.PROCESSING,
          sectionId: null,
        };
      }
      return {
        ...common,
        status: ScormPackageStatus.PROCESSING,
        sectionId: 'sec-1',
      };
    });
    cloud.getImportJobStatus.mockResolvedValue({ status: 'COMPLETE' });
    cloud.getCourseAsset.mockResolvedValue(
      readFileSync(
        join(__dirname, '../utils/fixtures/rise-runtime-lifting.js'),
        'utf8',
      ),
    );
    prisma.scormPackage.findFirst.mockResolvedValue(null);
    prisma.module.create.mockResolvedValue({ id: 'mod-1' });
    prisma.chapter.create.mockResolvedValue({ id: 'ch-1' });
    prisma.section.createMany.mockImplementation(async () => {
      treeExists = true;
      return { count: 1 };
    });
    prisma.scormPackage.update.mockImplementation(async ({ data }) => {
      if (data.status === ScormPackageStatus.READY) {
        published = true;
      }
      return {
        id: 'pkg-1',
        courseId: 'course-1',
        ...data,
      };
    });

    await service.completeImportIfReady('pkg-1', 'admin-1');

    expect(cloud.setCourseConfiguration).toHaveBeenCalled();
    expect(courseVersionService.publishNewVersion).toHaveBeenCalledWith(
      'admin-1',
      'course-1',
      expect.any(String),
    );
  });

  it('does not create a second section on a later import-status poll', async () => {
    prisma.scormPackage.findUnique.mockResolvedValue({
      id: 'pkg-1',
      courseId: 'course-1',
      status: ScormPackageStatus.READY,
      sectionId: 'sec-1',
    });

    const result = await service.completeImportIfReady('pkg-1', 'admin-1');
    expect(result.sectionId).toBe('sec-1');
    expect(prisma.section.createMany).not.toHaveBeenCalled();
    expect(courseVersionService.publishNewVersion).not.toHaveBeenCalled();
  });

  it('does not double-publish when a concurrent import already built the tree', async () => {
    prisma.scormPackage.findUnique.mockImplementation(async (args: any) => {
      if (args?.where?.id !== 'pkg-1') {
        return { id: 'pkg-1', sectionId: 'sec-1' };
      }
      const prior = prisma.scormPackage.findUnique.mock.calls.length;
      if (prior <= 2) {
        return {
          id: 'pkg-1',
          courseId: 'course-1',
          versionNumber: 1,
          status: ScormPackageStatus.PROCESSING,
          cloudImportJobId: 'job-1',
          createdAt: new Date(),
          scormCloudCourseId: 'cloud-1',
          sectionId: null,
          completeOn: 'completed',
          passingScore: null,
          title: 'Lifting',
        };
      }
      return {
        id: 'pkg-1',
        courseId: 'course-1',
        status: ScormPackageStatus.PROCESSING,
        sectionId: 'sec-1',
      };
    });

    cloud.getImportJobStatus.mockResolvedValue({ status: 'COMPLETE' });
    cloud.getCourseAsset.mockResolvedValue(
      readFileSync(
        join(__dirname, '../utils/fixtures/rise-runtime-lifting.js'),
        'utf8',
      ),
    );

    prisma.scormPackage.findFirst.mockResolvedValue(null);
    prisma.scormPackage.update.mockImplementation(async ({ data }) => ({
      id: 'pkg-1',
      courseId: 'course-1',
      ...data,
    }));

    const txFindUnique = prisma.scormPackage.findUnique;
    prisma.$transaction = jest.fn(async (fn: (tx: any) => Promise<void>) => {
      const tx = {
        $queryRaw: prisma.$queryRaw,
        scormPackage: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'pkg-1',
            sectionId: 'sec-1',
          }),
          findFirst: prisma.scormPackage.findFirst,
          update: prisma.scormPackage.update,
        },
        module: prisma.module,
        chapter: prisma.chapter,
        section: prisma.section,
      };
      await fn(tx);
    });

    await service.completeImportIfReady('pkg-1', 'admin-1');
    expect(courseVersionService.publishNewVersion).not.toHaveBeenCalled();
    prisma.scormPackage.findUnique = txFindUnique;
  });
});

describe('ScormService — lesson materialisation', () => {
  let service: ScormService;
  let prisma: Record<string, any>;
  let cloud: Record<string, jest.Mock>;
  let courseVersionService: Record<string, jest.Mock>;
  let sectionsCreated: any[];
  let packageUpdates: any[];

  const loadFixture = (name: string) =>
    readFileSync(join(__dirname, '../utils/fixtures', name), 'utf8');

  beforeEach(async () => {
    sectionsCreated = [];
    packageUpdates = [];

    prisma = {
      course: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      module: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
      chapter: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      section: {
        createMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      scormPackage: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      $transaction: undefined as any,
    };
    prisma.$queryRaw = rawQueryMock(prisma);
    prisma.scormPackage.updateMany = updateManyViaUpdate(prisma);
    prisma.$transaction = makeAbortAwareTransactionMock(prisma);

    prisma.section.createMany.mockImplementation(async ({ data }: any) => {
      sectionsCreated.push(...data);
      return { count: data.length };
    });
    prisma.scormPackage.update.mockImplementation(async ({ data }: any) => {
      packageUpdates.push(data);
      return { id: 'pkg-1', courseId: 'course-1', ...data };
    });
    prisma.module.create.mockResolvedValue({ id: 'mod-1' });
    prisma.chapter.create.mockResolvedValue({ id: 'ch-1' });

    cloud = {
      createFetchAndImportCourseJob: jest.fn(),
      createUploadAndImportCourseJob: jest.fn(),
      getImportJobStatus: jest.fn().mockResolvedValue({ status: 'COMPLETE' }),
      getCourseAsset: jest.fn(),
      setCourseConfiguration: jest.fn().mockResolvedValue(undefined),
    };
    courseVersionService = {
      publishNewVersion: jest
        .fn()
        .mockResolvedValue({ versionNumber: 1, id: 'ver-1' }),
      getLatestPublishedVersion: jest.fn().mockResolvedValue(null),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ScormService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScormCloudClient, useValue: cloud },
        { provide: CourseVersionService, useValue: courseVersionService },
      ],
    }).compile();
    service = moduleRef.get(ScormService);
  });

  /** Drives completeImportIfReady from PROCESSING through to the tree build. */
  const runImport = async () => {
    let treeBuilt = false;
    prisma.scormPackage.findUnique.mockImplementation(async () => ({
      id: 'pkg-1',
      courseId: 'course-1',
      versionNumber: 1,
      scormCloudCourseId: 'cloud-1',
      cloudImportJobId: 'job-1',
      createdAt: new Date(),
      completeOn: 'completed',
      passingScore: null,
      title: 'Imported',
      status: treeBuilt
        ? ScormPackageStatus.READY
        : ScormPackageStatus.PROCESSING,
      sectionId: treeBuilt ? 'sec-1' : null,
    }));
    prisma.section.createMany.mockImplementation(async ({ data }: any) => {
      sectionsCreated.push(...data);
      treeBuilt = true;
      return { count: data.length };
    });
    await service.completeImportIfReady('pkg-1', 'admin-1');
  };

  it('creates one ordered section per lesson for a Rise package', async () => {
    cloud.getCourseAsset.mockResolvedValue(loadFixture('rise-runtime-hira.js'));
    await runImport();

    expect(sectionsCreated).toHaveLength(14);
    expect(sectionsCreated.map((s) => s.orderIndex)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
    expect(sectionsCreated[0].title).toContain('Key Terms');
    expect(sectionsCreated[13].title).toBe('Quiz');
    expect(sectionsCreated.every((s) => s.type === 'SCORM')).toBe(true);
    expect(new Set(sectionsCreated.map((s) => s.chapterId))).toEqual(
      new Set(['ch-1']),
    );
  });

  /**
   * The launch path reads packageId/completeOn off whichever SCORM section it
   * finds first, so every lesson section must carry a config that
   * parseScormSectionConfig accepts — not just the first.
   */
  it('puts a launchable config on every lesson section', async () => {
    cloud.getCourseAsset.mockResolvedValue(loadFixture('rise-runtime-hira.js'));
    await runImport();

    for (const section of sectionsCreated) {
      expect(section.config.packageId).toBe('pkg-1');
      expect(section.config.completeOn).toBe('completed');
      expect(typeof section.config.scormLessonId).toBe('string');
      expect(typeof section.config.scormLessonIndex).toBe('number');
    }
    expect(sectionsCreated.map((s) => s.config.scormLessonIndex)).toEqual(
      Array.from({ length: 14 }, (_, i) => i),
    );
  });

  it('writes the lesson manifest with each section id back onto the package', async () => {
    cloud.getCourseAsset.mockResolvedValue(loadFixture('rise-runtime-hira.js'));
    await runImport();

    const withManifest = packageUpdates.find((u) => u.lessons);
    expect(withManifest).toBeDefined();
    expect(withManifest.lessonCount).toBe(14);
    expect(withManifest.chapterId).toBe('ch-1');
    // Ids are pre-generated for createMany, so the manifest must carry the
    // exact ids the rows were inserted with — in order.
    expect(withManifest.sectionId).toBe(sectionsCreated[0].id);

    const manifest = withManifest.lessons as any[];
    expect(manifest).toHaveLength(14);
    expect(manifest.map((l) => l.index)).toEqual(
      Array.from({ length: 14 }, (_, i) => i),
    );
    // Every lesson resolves to a distinct section — the JSON read the progress
    // path depends on.
    expect(new Set(manifest.map((l) => l.sectionId)).size).toBe(14);
    expect(manifest.map((l) => l.sectionId)).toEqual(
      sectionsCreated.map((s) => s.id),
    );
  });

  /**
   * D5: a package with no readable lesson manifest keeps today's behaviour
   * exactly — one section, binary progress.
   */
  it('falls back to a single section when no lesson manifest parses', async () => {
    cloud.getCourseAsset.mockResolvedValue('not a rise manifest at all');
    await runImport();

    expect(sectionsCreated).toHaveLength(1);
    expect(sectionsCreated[0].orderIndex).toBe(1);
    expect(sectionsCreated[0].config.scormLessonId).toBeUndefined();

    const update = packageUpdates.find((u) => 'lessonCount' in u);
    expect(update.lessonCount).toBeNull();
  });

  it('falls back to a single section when the probe cannot run at all', async () => {
    cloud.getCourseAsset.mockRejectedValue(new Error('404 asset missing'));
    await runImport();

    expect(sectionsCreated).toHaveLength(1);
  });

  /** Every live SCORM section of the course, whichever package made it. */
  const courseWideArchive = {
    where: {
      type: 'SCORM',
      isArchived: false,
      chapter: { module: { courseId: 'course-1' } },
    },
    data: { isArchived: true, archivedAt: expect.any(Date) },
  };

  describe('replacing a previous READY package', () => {
    beforeEach(() => {
      cloud.getCourseAsset.mockResolvedValue(
        loadFixture('rise-runtime-hira.js'),
      );
      prisma.section.findUnique.mockResolvedValue({
        chapterId: 'ch-old',
        moduleId: 'mod-old',
      });
      prisma.chapter.findFirst.mockResolvedValue({
        id: 'ch-old',
        moduleId: 'mod-old',
      });
    });

    const expectReusedOldTree = () => {
      expect(prisma.module.create).not.toHaveBeenCalled();
      expect(prisma.chapter.create).not.toHaveBeenCalled();
      expect(sectionsCreated).toHaveLength(14);
      expect(
        sectionsCreated.every(
          (s) => s.chapterId === 'ch-old' && s.moduleId === 'mod-old',
        ),
      ).toBe(true);
      expect(prisma.section.updateMany).toHaveBeenCalledWith(courseWideArchive);
      // Archived before this package's sections exist, so none of them.
      expect(
        prisma.section.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.section.createMany.mock.invocationCallOrder[0]);
      expect(packageUpdates.find((u) => u.lessons)?.chapterId).toBe('ch-old');
    };

    /**
     * A partial destroy marks the READY package PRUNED but leaves its tree
     * live. Treating only READY as a predecessor grew a second chapter and
     * left the old sections live — "extra" to the gate, and locked against a
     * manual archive, so the course could never be published.
     */
    it('re-import after a partial destroy reuses the PRUNED package tree and archives its sections', async () => {
      prisma.scormPackage.findFirst.mockImplementation(
        async ({ where }: any) =>
          where.status === ScormPackageStatus.READY
            ? null
            : { chapterId: 'ch-old' },
      );
      await runImport();

      expect(prisma.scormPackage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: {
              in: [ScormPackageStatus.READY, ScormPackageStatus.PRUNED],
            },
          }),
        }),
      );
      expectReusedOldTree();
      // SUPERSEDED is for a READY predecessor only; PRUNED stays PRUNED.
      expect(prisma.scormPackage.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: ScormPackageStatus.SUPERSEDED },
        }),
      );
    });

    it('re-import after a FAILED package with live sections reuses their chapter and archives them', async () => {
      prisma.scormPackage.findFirst.mockResolvedValue(null);
      prisma.section.findFirst.mockResolvedValue({
        chapterId: 'ch-old',
        chapter: { moduleId: 'mod-old' },
      });
      await runImport();

      expect(prisma.section.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            type: 'SCORM',
            isArchived: false,
            chapter: {
              isArchived: false,
              module: { courseId: 'course-1', isArchived: false },
            },
          },
        }),
      );
      expectReusedOldTree();
      expect(prisma.scormPackage.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: ScormPackageStatus.SUPERSEDED },
        }),
      );
    });

    /**
     * A multi-lesson predecessor owns N sections but `sectionId` names only
     * the first. Archiving by that id alone would leave N-1 live beside the
     * new package's lessons and setCourseActive would refuse the course.
     */
    it('archives the whole chapter of a multi-lesson predecessor and supersedes it', async () => {
      prisma.scormPackage.findFirst.mockResolvedValue({
        id: 'pkg-0',
        status: ScormPackageStatus.READY,
        sectionId: 'old-sec-1',
        chapterId: 'ch-old',
        lessonCount: 14,
      });
      await runImport();

      expect(prisma.section.updateMany).toHaveBeenCalledWith(courseWideArchive);
      expect(prisma.scormPackage.update).toHaveBeenCalledWith({
        where: { id: 'pkg-0' },
        data: { status: ScormPackageStatus.SUPERSEDED },
      });
      // Reuses the chapter/module rather than growing a second tree…
      expect(prisma.module.create).not.toHaveBeenCalled();
      expect(prisma.chapter.create).not.toHaveBeenCalled();
      expect(sectionsCreated).toHaveLength(14);
      expect(
        sectionsCreated.every(
          (s) => s.chapterId === 'ch-old' && s.moduleId === 'mod-old',
        ),
      ).toBe(true);
      // …and does not rename it: the chapter is shared with earlier
      // versions and manifests read titles live, so pinned learners would see
      // the rename.
      expect(prisma.chapter.update).not.toHaveBeenCalled();
      expect(packageUpdates.find((u) => u.lessons)?.chapterId).toBe('ch-old');
    });

    /**
     * A package imported before `chapterId` existed has it null; the chapter
     * then comes from its single section, and the archive is still by chapter.
     */
    it('falls back to the section chapter for a legacy predecessor with chapterId null', async () => {
      prisma.scormPackage.findFirst.mockResolvedValue({
        id: 'pkg-legacy',
        status: ScormPackageStatus.READY,
        sectionId: 'old-sec-1',
        chapterId: null,
        lessonCount: null,
      });
      await runImport();

      expect(prisma.section.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'old-sec-1' } }),
      );
      expect(prisma.section.updateMany).toHaveBeenCalledWith(courseWideArchive);
      expect(prisma.scormPackage.update).toHaveBeenCalledWith({
        where: { id: 'pkg-legacy' },
        data: { status: ScormPackageStatus.SUPERSEDED },
      });
      expect(packageUpdates.find((u) => u.lessons)?.chapterId).toBe('ch-old');
    });
  });

  /**
   * The backfill script (or another import on the same course) holds the
   * course tree lock. An import landing then must back off WITHOUT marking
   * its package FAILED and WITHOUT an error a poller would stop on — it
   * answers like any other in-progress poll and the next poll retries.
   */
  it('answers as still PROCESSING (no error) when the course tree lock is held', async () => {
    cloud.getCourseAsset.mockResolvedValue(loadFixture('rise-runtime-hira.js'));
    prisma.$queryRaw
      .mockResolvedValueOnce([{ locked: true }]) // package lock
      .mockResolvedValueOnce([
        { status: ScormPackageStatus.PROCESSING, sectionId: null },
      ]) // row lock
      .mockResolvedValueOnce([{ locked: false }]); // course lock
    prisma.scormPackage.findUnique.mockResolvedValue({
      id: 'pkg-1',
      courseId: 'course-1',
      versionNumber: 1,
      scormCloudCourseId: 'cloud-1',
      cloudImportJobId: 'job-1',
      createdAt: new Date(),
      completeOn: 'completed',
      passingScore: null,
      title: 'Imported',
      status: ScormPackageStatus.PROCESSING,
      sectionId: null,
    });

    const res = await service.getImportStatus('pkg-1', 'admin-1');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    expect(res.statusCode).toBe(200);
    expect(res.data.status).toBe(ScormPackageStatus.PROCESSING);
    expect(sectionsCreated).toHaveLength(0);
    expect(packageUpdates).toHaveLength(0);
    expect(courseVersionService.publishNewVersion).not.toHaveBeenCalled();
  });

  it('answers as still PROCESSING when another complete-import holds the package lock', async () => {
    cloud.getCourseAsset.mockResolvedValue(loadFixture('rise-runtime-hira.js'));
    prisma.$queryRaw.mockResolvedValueOnce([{ locked: false }]);
    prisma.scormPackage.findUnique.mockResolvedValue({
      id: 'pkg-1',
      courseId: 'course-1',
      versionNumber: 1,
      scormCloudCourseId: 'cloud-1',
      cloudImportJobId: 'job-1',
      createdAt: new Date(),
      completeOn: 'completed',
      passingScore: null,
      title: 'Imported',
      status: ScormPackageStatus.PROCESSING,
      sectionId: null,
    });

    const result = await service.completeImportIfReady('pkg-1', null);
    expect(result.status).toBe(ScormPackageStatus.PROCESSING);
    expect(packageUpdates).toHaveLength(0);
  });

  it('reports a busy package as PROCESSING (not "error") from the import cron', async () => {
    cloud.getCourseAsset.mockResolvedValue(loadFixture('rise-runtime-hira.js'));
    prisma.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([
        { status: ScormPackageStatus.PROCESSING, sectionId: null },
      ])
      .mockResolvedValueOnce([{ locked: false }]);
    const row = {
      id: 'pkg-1',
      courseId: 'course-1',
      versionNumber: 1,
      scormCloudCourseId: 'cloud-1',
      cloudImportJobId: 'job-1',
      createdAt: new Date(),
      completeOn: 'completed',
      passingScore: null,
      title: 'Imported',
      status: ScormPackageStatus.PROCESSING,
      sectionId: null,
    };
    prisma.scormPackage.findMany.mockResolvedValue([row]);
    prisma.scormPackage.findUnique.mockResolvedValue(row);

    const res = await service.processImportJobsCron();
    expect(res.results).toEqual([
      { id: 'pkg-1', status: ScormPackageStatus.PROCESSING },
    ]);
  });

  const HOUR = 60 * 60 * 1000;
  const processingRow = (over: Record<string, unknown> = {}) => ({
    id: 'pkg-1',
    courseId: 'course-1',
    versionNumber: 1,
    scormCloudCourseId: 'cloud-1',
    cloudImportJobId: 'job-1',
    createdAt: new Date(),
    completeOn: 'completed',
    passingScore: null,
    title: 'Imported',
    status: ScormPackageStatus.PROCESSING,
    sectionId: null,
    riseProbeJson: null,
    ...over,
  });

  /**
   * One pooled connection: a second tree $transaction waits past maxWait and
   * Prisma throws P2028. Contention, not a broken package.
   */
  it('answers PROCESSING (not FAILED) when the tree transaction cannot start (P2028)', async () => {
    cloud.getCourseAsset.mockResolvedValue(loadFixture('rise-runtime-hira.js'));
    prisma.scormPackage.findUnique.mockResolvedValue(processingRow());
    prisma.$transaction = jest
      .fn()
      .mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Transaction API error: Unable to start a transaction in the given time.',
          { code: 'P2028', clientVersion: 'test' },
        ),
      );
    const result = await service.completeImportIfReady('pkg-1', null);
    expect(result.status).toBe(ScormPackageStatus.PROCESSING);
    expect(packageUpdates).toHaveLength(0);
  });

  it('answers PROCESSING (not a 504) when the job-status read times out', async () => {
    prisma.scormPackage.findUnique.mockResolvedValue(processingRow());
    cloud.getImportJobStatus.mockRejectedValue(
      new ScormCloudTimeoutError('GET /courses/importJobs/job-1', 10_000),
    );
    const result = await service.completeImportIfReady('pkg-1', null);
    expect(result.status).toBe(ScormPackageStatus.PROCESSING);
    expect(packageUpdates).toHaveLength(0);
  });

  describe('stale PROCESSING rows', () => {
    beforeEach(() => {
      prisma.scormPackage.updateMany = jest
        .fn()
        .mockResolvedValue({ count: 1 });
    });

    const expectStaleFail = () =>
      expect(prisma.scormPackage.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'pkg-1',
          status: ScormPackageStatus.PROCESSING,
          sectionId: null,
        },
        data: {
          status: ScormPackageStatus.FAILED,
          failureReason: expect.stringContaining('within 24h'),
        },
      });

    it.each([
      [
        'Cloud says still running',
        () => cloud.getImportJobStatus.mockResolvedValue({ status: 'RUNNING' }),
      ],
      [
        'the status read times out',
        () =>
          cloud.getImportJobStatus.mockRejectedValue(
            new ScormCloudTimeoutError('GET /courses/importJobs/job-1', 10_000),
          ),
      ],
    ])(
      'FAILs a day-old row only after asking Cloud: %s',
      async (_l, arrange) => {
        arrange();
        const row = processingRow({
          createdAt: new Date(Date.now() - 25 * HOUR),
        });
        prisma.scormPackage.findUnique
          .mockResolvedValueOnce(row)
          .mockResolvedValueOnce({ ...row, status: ScormPackageStatus.FAILED });
        const result = await service.completeImportIfReady('pkg-1', null);
        expect(cloud.getImportJobStatus).toHaveBeenCalledWith('job-1');
        expect(
          cloud.getImportJobStatus.mock.invocationCallOrder[0],
        ).toBeLessThan(
          prisma.scormPackage.updateMany.mock.invocationCallOrder[0],
        );
        expectStaleFail();
        expect(result.status).toBe(ScormPackageStatus.FAILED);
      },
    );

    /**
     * Daily cron + a closed admin tab: the first poll after the job finished
     * can land past the 24h mark. The import is good — never fail it.
     */
    it('never FAILs a day-old row whose Cloud job is COMPLETE (builds the tree)', async () => {
      cloud.getCourseAsset.mockResolvedValue(
        loadFixture('rise-runtime-hira.js'),
      );
      prisma.scormPackage.findUnique.mockResolvedValue(
        processingRow({ createdAt: new Date(Date.now() - 48 * HOUR) }),
      );
      await service.completeImportIfReady('pkg-1', null);
      expect(prisma.scormPackage.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ScormPackageStatus.FAILED }),
        }),
      );
      expect(cloud.setCourseConfiguration).toHaveBeenCalled();
      expect(sectionsCreated).toHaveLength(14);
    });

    it('FAILs a job-less row once the start request is long dead (10 min)', async () => {
      const row = processingRow({
        cloudImportJobId: null,
        createdAt: new Date(Date.now() - 11 * 60 * 1000),
      });
      prisma.scormPackage.findUnique.mockResolvedValue(row);
      await service.completeImportIfReady('pkg-1', null);
      expect(prisma.scormPackage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            failureReason: expect.stringContaining('never started'),
          }),
        }),
      );
    });

    it('leaves a young job-less row alone (its start may still be running)', async () => {
      prisma.scormPackage.findUnique.mockResolvedValue(
        processingRow({ cloudImportJobId: null }),
      );
      const result = await service.completeImportIfReady('pkg-1', null);
      expect(result.status).toBe(ScormPackageStatus.PROCESSING);
      expect(prisma.scormPackage.updateMany).not.toHaveBeenCalled();
    });

    it('never fails a row whose tree is built (only the publish is left)', async () => {
      prisma.scormPackage.findUnique.mockResolvedValue(
        processingRow({
          sectionId: 'sec-1',
          createdAt: new Date(Date.now() - 48 * HOUR),
        }),
      );
      await service.completeImportIfReady('pkg-1', null);
      expect(prisma.scormPackage.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ScormPackageStatus.FAILED }),
        }),
      );
      expect(courseVersionService.publishNewVersion).toHaveBeenCalled();
    });

    const expectHardCapFail = () =>
      expect(prisma.scormPackage.updateMany).toHaveBeenCalledWith({
        where: { id: 'pkg-1', status: ScormPackageStatus.PROCESSING },
        data: {
          status: ScormPackageStatus.FAILED,
          failureReason: expect.stringContaining('within 72h'),
        },
      });

    /**
     * A tree-built row whose publish keeps failing would otherwise stay
     * PROCESSING forever. Failing it is safe: the next import archives every
     * live SCORM section of the course.
     */
    it('FAILs a tree-built row past the 72h hard cap without publishing', async () => {
      const row = processingRow({
        sectionId: 'sec-1',
        createdAt: new Date(Date.now() - 73 * HOUR),
      });
      prisma.scormPackage.findUnique
        .mockResolvedValueOnce(row)
        .mockResolvedValue({ ...row, status: ScormPackageStatus.FAILED });
      const result = await service.completeImportIfReady('pkg-1', null);
      expectHardCapFail();
      expect(result.status).toBe(ScormPackageStatus.FAILED);
      expect(courseVersionService.publishNewVersion).not.toHaveBeenCalled();
    });

    it('FAILs a COMPLETE-job row past the 72h hard cap before any Cloud call', async () => {
      const row = processingRow({
        createdAt: new Date(Date.now() - 73 * HOUR),
      });
      prisma.scormPackage.findUnique
        .mockResolvedValueOnce(row)
        .mockResolvedValue({ ...row, status: ScormPackageStatus.FAILED });
      cloud.getImportJobStatus.mockResolvedValue({ status: 'COMPLETE' });
      const result = await service.completeImportIfReady('pkg-1', null);
      expectHardCapFail();
      expect(result.status).toBe(ScormPackageStatus.FAILED);
      expect(cloud.getImportJobStatus).not.toHaveBeenCalled();
      expect(cloud.setCourseConfiguration).not.toHaveBeenCalled();
    });

    it('leaves a COMPLETE-but-config-timeout row under 72h PROCESSING', async () => {
      prisma.scormPackage.findUnique.mockResolvedValue(
        processingRow({ createdAt: new Date(Date.now() - 71 * HOUR) }),
      );
      cloud.getImportJobStatus.mockResolvedValue({ status: 'COMPLETE' });
      cloud.setCourseConfiguration.mockRejectedValue(
        new ScormCloudTimeoutError('POST /courses/cloud-1/configuration', 1),
      );
      const result = await service.completeImportIfReady('pkg-1', null);
      expect(result.status).toBe(ScormPackageStatus.PROCESSING);
      expect(prisma.scormPackage.updateMany).not.toHaveBeenCalled();
    });

    const existingCourse1 = () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'course-1',
        title: 'C',
        deliveryMode: 'IMPORTED_SCORM',
      });
      prisma.course.update.mockResolvedValue({ id: 'course-1', title: 'C' });
    };
    const reimport = () =>
      service.createPackage('admin-1', {
        contentUrl: 'https://example.com/c.zip',
        completeOn: 'completed',
        courseId: 'course-1',
      } as any);

    /**
     * A day-old in-flight row is polled first, outside the start tx — never
     * failed unasked — and the start proceeds once that poll failed it.
     */
    it('polls a day-old in-flight row before a re-import, and proceeds once the poll fails it', async () => {
      existingCourse1();
      const stale = processingRow({
        createdAt: new Date(Date.now() - 25 * HOUR),
      });
      cloud.getImportJobStatus.mockResolvedValue({ status: 'RUNNING' });
      prisma.scormPackage.findUnique
        .mockResolvedValueOnce(stale)
        .mockResolvedValue({ ...stale, status: ScormPackageStatus.FAILED });
      prisma.scormPackage.findFirst
        .mockResolvedValueOnce(stale) // pre-lock stale lookup
        .mockResolvedValueOnce(null) // in-flight check: the poll failed it
        .mockResolvedValueOnce({ versionNumber: 1 });
      prisma.scormPackage.create.mockResolvedValue({ id: 'pkg-2' });
      cloud.createFetchAndImportCourseJob.mockResolvedValue('job-2');

      const res = await reimport();

      expect(res.statusCode).toBe(200);
      expect(prisma.scormPackage.findFirst.mock.calls[0][0].where).toEqual({
        courseId: 'course-1',
        status: ScormPackageStatus.PROCESSING,
        cloudImportJobId: { not: null },
        sectionId: null,
        createdAt: { lt: expect.any(Date) },
      });
      expect(cloud.getImportJobStatus).toHaveBeenCalledWith('job-1');
      expectStaleFail();
      // Polled before the start tx, not inside it.
      expect(cloud.getImportJobStatus.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$transaction.mock.invocationCallOrder.at(-1)!,
      );
      expect(prisma.scormPackage.create).toHaveBeenCalled();
    });

    it('never fails a day-old in-flight row inside the start tx (its job was COMPLETE) — answers 409', async () => {
      existingCourse1();
      const stale = processingRow({
        createdAt: new Date(Date.now() - 25 * HOUR),
      });
      // The job is COMPLETE; the next step times out, so the poll leaves it
      // PROCESSING for the next poll to finish.
      cloud.setCourseConfiguration.mockRejectedValue(
        new ScormCloudTimeoutError('POST /courses/cloud-1/configuration', 1),
      );
      prisma.scormPackage.findUnique.mockResolvedValue(stale);
      prisma.scormPackage.findFirst.mockResolvedValue(stale);

      await expect(reimport()).rejects.toThrow(/already in progress/);
      expect(cloud.getImportJobStatus).toHaveBeenCalled();
      expect(prisma.scormPackage.updateMany).not.toHaveBeenCalled();
      expect(prisma.scormPackage.create).not.toHaveBeenCalled();
    });

    it('lets a re-import proceed past a COMPLETE-but-config-timeout row older than 72h', async () => {
      existingCourse1();
      const stale = processingRow({
        createdAt: new Date(Date.now() - 73 * HOUR),
      });
      cloud.getImportJobStatus.mockResolvedValue({ status: 'COMPLETE' });
      cloud.setCourseConfiguration.mockRejectedValue(
        new ScormCloudTimeoutError('POST /courses/cloud-1/configuration', 1),
      );
      prisma.scormPackage.findUnique
        .mockResolvedValueOnce(stale)
        .mockResolvedValue({ ...stale, status: ScormPackageStatus.FAILED });
      prisma.scormPackage.findFirst
        .mockResolvedValueOnce(stale) // pre-lock stale lookup
        .mockResolvedValueOnce(null) // in-flight check: the poll failed it
        .mockResolvedValueOnce({ versionNumber: 1 });
      prisma.scormPackage.create.mockResolvedValue({ id: 'pkg-2' });
      cloud.createFetchAndImportCourseJob.mockResolvedValue('job-2');

      const res = await reimport();

      expect(res.statusCode).toBe(200);
      expectHardCapFail();
      expect(cloud.setCourseConfiguration).not.toHaveBeenCalled();
      expect(prisma.scormPackage.create).toHaveBeenCalled();
    });

    it('fails a >72h tree-built in-flight row in the start tx and proceeds', async () => {
      existingCourse1();
      prisma.scormPackage.findFirst
        .mockResolvedValueOnce(null) // pre-lock lookup skips tree-built rows
        .mockResolvedValueOnce(
          processingRow({
            sectionId: 'sec-1',
            createdAt: new Date(Date.now() - 73 * HOUR),
          }),
        )
        .mockResolvedValueOnce({ versionNumber: 1 });
      prisma.scormPackage.create.mockResolvedValue({ id: 'pkg-2' });
      cloud.createFetchAndImportCourseJob.mockResolvedValue('job-2');

      const res = await reimport();

      expect(res.statusCode).toBe(200);
      expectHardCapFail();
      expect(prisma.scormPackage.create).toHaveBeenCalled();
    });

    it('still refuses a re-import over a tree-built in-flight row under 72h', async () => {
      existingCourse1();
      prisma.scormPackage.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          processingRow({
            sectionId: 'sec-1',
            createdAt: new Date(Date.now() - 71 * HOUR),
          }),
        );
      await expect(reimport()).rejects.toThrow(/already in progress/);
      expect(prisma.scormPackage.updateMany).not.toHaveBeenCalled();
    });

    it('lets a re-import proceed past a stale job-less in-flight row (and fails it in the start tx)', async () => {
      existingCourse1();
      prisma.scormPackage.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          processingRow({
            cloudImportJobId: null,
            createdAt: new Date(Date.now() - 11 * 60 * 1000),
          }),
        )
        .mockResolvedValueOnce({ versionNumber: 1 });
      prisma.scormPackage.create.mockResolvedValue({ id: 'pkg-2' });
      cloud.createFetchAndImportCourseJob.mockResolvedValue('job-2');
      const res = await reimport();
      expect(res.statusCode).toBe(200);
      expect(prisma.scormPackage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            failureReason: expect.stringContaining('never started'),
          }),
        }),
      );
      expect(cloud.getImportJobStatus).not.toHaveBeenCalled();
    });

    it('still refuses a re-import over a fresh in-flight row', async () => {
      existingCourse1();
      prisma.scormPackage.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(processingRow());
      await expect(reimport()).rejects.toThrow(/already in progress/);
      expect(prisma.scormPackage.updateMany).not.toHaveBeenCalled();
      expect(cloud.getImportJobStatus).not.toHaveBeenCalled();
    });

    /** A refused re-import must not take a live course offline. */
    it('leaves the course untouched (still active) when a re-import is refused with 409', async () => {
      existingCourse1();
      prisma.scormPackage.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(processingRow());
      await expect(reimport()).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.course.update).not.toHaveBeenCalled();
    });

    it('deactivates the course inside the start tx once a re-import is accepted', async () => {
      existingCourse1();
      prisma.scormPackage.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ versionNumber: 1 });
      prisma.scormPackage.create.mockResolvedValue({ id: 'pkg-2' });
      cloud.createFetchAndImportCourseJob.mockResolvedValue('job-2');
      await reimport();
      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        data: { deliveryMode: 'IMPORTED_SCORM', isActive: false },
      });
      expect(prisma.course.update.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.scormPackage.create.mock.invocationCallOrder[0],
      );
    });

    it('lets the cron pick up stale job-less rows', async () => {
      prisma.scormPackage.findMany.mockResolvedValue([]);
      await service.processImportJobsCron();
      expect(prisma.scormPackage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: ScormPackageStatus.PROCESSING,
            OR: [
              { cloudImportJobId: { not: null } },
              { createdAt: { lt: expect.any(Date) } },
            ],
          },
        }),
      );
    });
  });

  it('runs the import cron one package at a time and defers past the deadline', async () => {
    let active = 0;
    let maxActive = 0;
    const rows = [
      processingRow({ id: 'a' }),
      processingRow({ id: 'b' }),
      processingRow({ id: 'c' }),
    ];
    prisma.scormPackage.findMany.mockResolvedValue(rows);
    prisma.scormPackage.findUnique.mockImplementation(async ({ where }: any) =>
      rows.find((r) => r.id === where.id),
    );
    let calls = 0;
    const deadline = Date.now() + 60_000;
    const realNow = Date.now;
    cloud.getImportJobStatus.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setImmediate(r));
      active -= 1;
      calls += 1;
      // The second package runs past the deadline: the third must not start.
      if (calls === 2) Date.now = () => deadline + 1;
      return { status: 'RUNNING' };
    });
    try {
      const res = await service.processImportJobsCron(deadline);
      expect(maxActive).toBe(1);
      expect(res.processed).toBe(2);
      expect(res.deferred).toBe(1);
    } finally {
      Date.now = realNow;
    }
  });

  /**
   * failIfStale (cron or a re-import) FAILs the row while this poll was out at
   * Cloud. The tree tx must see that under its row lock and write nothing —
   * otherwise it archives the live chapter for a package nothing retries.
   */
  describe('a row that left PROCESSING mid-poll', () => {
    const previousReady = {
      id: 'pkg-0',
      status: ScormPackageStatus.READY,
      sectionId: 'old-sec-1',
      chapterId: 'ch-old',
      lessonCount: 14,
    };

    beforeEach(() => {
      cloud.getCourseAsset.mockResolvedValue(
        loadFixture('rise-runtime-hira.js'),
      );
      prisma.scormPackage.findFirst.mockResolvedValue(previousReady);
      prisma.section.findUnique.mockResolvedValue({
        chapterId: 'ch-old',
        moduleId: 'mod-old',
      });
      prisma.chapter.findFirst.mockResolvedValue({
        id: 'ch-old',
        moduleId: 'mod-old',
      });
    });

    it('takes the row lock and builds nothing once the row is FAILED', async () => {
      prisma.scormPackage.findUnique
        .mockResolvedValueOnce(processingRow())
        .mockResolvedValue(
          processingRow({ status: ScormPackageStatus.FAILED }),
        );

      const result = await service.completeImportIfReady('pkg-1', null);

      const rowLock = prisma.$queryRaw.mock.calls[1][0];
      expect(rowLock.sql).toMatch(
        /SELECT status, "sectionId" FROM "scorm_packages" WHERE id = .* FOR UPDATE/,
      );
      expect(result.status).toBe(ScormPackageStatus.FAILED);
      expect(prisma.section.updateMany).not.toHaveBeenCalled();
      expect(sectionsCreated).toHaveLength(0);
      expect(packageUpdates).toHaveLength(0);
      expect(courseVersionService.publishNewVersion).not.toHaveBeenCalled();
    });

    it('rolls the tree back (no FAILED write of its own) when the final package write matches no PROCESSING row', async () => {
      prisma.scormPackage.findUnique.mockResolvedValue(processingRow());
      prisma.scormPackage.updateMany = jest
        .fn()
        .mockResolvedValue({ count: 0 });

      await service.completeImportIfReady('pkg-1', null);

      expect(prisma.scormPackage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pkg-1', status: ScormPackageStatus.PROCESSING },
          data: expect.objectContaining({ chapterId: 'ch-old' }),
        }),
      );
      expect(
        packageUpdates.some((u) => u.status === ScormPackageStatus.FAILED),
      ).toBe(false);
      expect(courseVersionService.publishNewVersion).not.toHaveBeenCalled();
    });
  });

  it('never resurrects a row FAILED during the publish to READY', async () => {
    prisma.scormPackage.findUnique
      .mockResolvedValueOnce(processingRow({ sectionId: 'sec-1' }))
      .mockResolvedValueOnce(processingRow({ sectionId: 'sec-1' }))
      .mockResolvedValue(
        processingRow({
          sectionId: 'sec-1',
          status: ScormPackageStatus.FAILED,
        }),
      );
    prisma.scormPackage.updateMany = jest.fn().mockResolvedValue({ count: 0 });

    const result = await service.completeImportIfReady('pkg-1', null);

    expect(prisma.scormPackage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pkg-1', status: ScormPackageStatus.PROCESSING },
        data: expect.objectContaining({ status: ScormPackageStatus.READY }),
      }),
    );
    expect(courseVersionService.publishNewVersion).toHaveBeenCalled();
    expect(result.status).toBe(ScormPackageStatus.FAILED);
  });

  it('does not publish for a row that is no longer PROCESSING', async () => {
    prisma.scormPackage.findUnique
      .mockResolvedValueOnce(processingRow({ sectionId: 'sec-1' }))
      .mockResolvedValue(
        processingRow({
          sectionId: 'sec-1',
          status: ScormPackageStatus.FAILED,
        }),
      );

    const result = await service.completeImportIfReady('pkg-1', null);
    expect(result.status).toBe(ScormPackageStatus.FAILED);
    expect(courseVersionService.publishNewVersion).not.toHaveBeenCalled();
  });

  it.each([
    ScormPackageStatus.PRUNED,
    ScormPackageStatus.FAILED,
    ScormPackageStatus.SUPERSEDED,
  ])('returns a %s row unchanged without touching Cloud', async (status) => {
    // PRUNED especially: its Cloud course is deleted, so configuring it
    // would rewrite it FAILED with a misleading reason.
    const row = processingRow({ status, sectionId: 'sec-1' });
    prisma.scormPackage.findUnique.mockResolvedValue(row);
    const result = await service.completeImportIfReady('pkg-1', null);
    expect(result).toBe(row);
    expect(cloud.getImportJobStatus).not.toHaveBeenCalled();
    expect(cloud.setCourseConfiguration).not.toHaveBeenCalled();
    expect(packageUpdates).toHaveLength(0);
  });

  it('answers PROCESSING (not a 409) when the publish lock is busy', async () => {
    const row = processingRow({ sectionId: 'sec-1' });
    prisma.scormPackage.findUnique.mockResolvedValue(row);
    courseVersionService.publishNewVersion.mockRejectedValue(
      new ConflictException(
        'Another publish is already in progress for course course-1; retry',
      ),
    );
    const result = await service.completeImportIfReady('pkg-1', null);
    expect(result.status).toBe(ScormPackageStatus.PROCESSING);
    expect(result.sectionId).toBe('sec-1');
    expect(packageUpdates).toHaveLength(0);
  });

  it('recomputes importWarning on a publish retry instead of nulling it', async () => {
    prisma.scormPackage.findUnique.mockResolvedValue(
      processingRow({
        sectionId: 'sec-1',
        riseProbeJson: {
          quizItemCount: 2,
          reporting: 'completed-incomplete',
          riseIndexSpaceRisk: 'lesson 3 is soft-deleted',
        },
      }),
    );
    await service.completeImportIfReady('pkg-1', null);
    expect(packageUpdates).toHaveLength(1);
    expect(packageUpdates[0]).toMatchObject({
      status: ScormPackageStatus.READY,
      importWarning: riseIndexSpaceWarning('lesson 3 is soft-deleted'),
    });
  });
});

describe('riseIndexSpaceWarning', () => {
  it('is null when the manifest carries no index-space risk', () => {
    expect(riseIndexSpaceWarning(null)).toBeNull();
  });

  it('tells the admin progress is binary until verified, and how to verify', () => {
    const warning = riseIndexSpaceWarning('lesson 3 is soft-deleted');
    expect(warning).toContain('(lesson 3 is soft-deleted)');
    // The runtime holds the package on binary progress until the flag is set;
    // the warning is the only place an admin learns that, so it must say so.
    expect(warning).toContain('complete/incomplete only (no per-lesson %)');
    expect(warning).toContain(
      'yarn script:backfill-scorm-lessons --verify-index-space=<packageId>',
    );
  });
});
