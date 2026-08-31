import { Test, TestingModule } from '@nestjs/testing';
import { ScormPackageStatus } from '@prisma/client';
import { CourseVersionService } from '../course-version/course-version.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScormCloudClient } from '../scorm-cloud/scorm-cloud.client';
import { ScormService } from './scorm.service';
import { makeAbortAwareTransactionMock } from '../test-utils/prisma-transaction-mock';

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
      chapter: { create: jest.fn() },
      section: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
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
    prisma.$transaction = makeAbortAwareTransactionMock(prisma);

    cloud = {
      createFetchAndImportCourseJob: jest.fn().mockResolvedValue('job-1'),
      getImportJobStatus: jest.fn(),
      getCourseAsset: jest.fn(),
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

  it('surfaces a Cloud ERROR job as FAILED', async () => {
    prisma.scormPackage.findUnique.mockResolvedValue({
      id: 'pkg-1',
      status: ScormPackageStatus.PROCESSING,
      cloudImportJobId: 'job-1',
      sectionId: null,
      completeOn: 'completed',
    });
    cloud.getImportJobStatus.mockResolvedValue({
      status: 'ERROR',
      message: 'not a zip',
    });
    prisma.scormPackage.update.mockImplementation(async ({ data }) => ({
      id: 'pkg-1',
      ...data,
    }));

    const result = await service.completeImportIfReady('pkg-1', 'admin-1');
    expect(result.status).toBe(ScormPackageStatus.FAILED);
    expect(result.failureReason).toContain('not a zip');
    expect(courseVersionService.publishNewVersion).not.toHaveBeenCalled();
  });

  it('refuses completeOn passed when the probe finds zero quiz items', async () => {
    prisma.scormPackage.findUnique.mockResolvedValue({
      id: 'pkg-1',
      status: ScormPackageStatus.PROCESSING,
      cloudImportJobId: 'job-1',
      scormCloudCourseId: 'cloud-1',
      sectionId: null,
      completeOn: 'passed',
      title: 'Lifting',
    });
    cloud.getImportJobStatus.mockResolvedValue({ status: 'COMPLETE' });
    const { readFileSync } = require('fs');
    const { join } = require('path');
    cloud.getCourseAsset.mockResolvedValue(
      readFileSync(
        join(__dirname, '../utils/fixtures/rise-runtime-lifting.js'),
        'utf8',
      ),
    );
    prisma.scormPackage.update.mockImplementation(async ({ data }) => ({
      id: 'pkg-1',
      ...data,
    }));

    const result = await service.completeImportIfReady('pkg-1', 'admin-1');
    expect(result.status).toBe(ScormPackageStatus.FAILED);
    expect(result.failureReason).toMatch(/no scoreable quiz/i);
    expect(courseVersionService.publishNewVersion).not.toHaveBeenCalled();
  });

  it('publishes a version after the first successful import', async () => {
    prisma.scormPackage.findUnique.mockResolvedValue({
      id: 'pkg-1',
      courseId: 'course-1',
      versionNumber: 1,
      status: ScormPackageStatus.PROCESSING,
      cloudImportJobId: 'job-1',
      scormCloudCourseId: 'cloud-1',
      sectionId: null,
      completeOn: 'completed',
      passingScore: null,
      title: 'Lifting',
    });
    cloud.getImportJobStatus.mockResolvedValue({ status: 'COMPLETE' });
    const { readFileSync } = require('fs');
    const { join } = require('path');
    cloud.getCourseAsset.mockResolvedValue(
      readFileSync(
        join(__dirname, '../utils/fixtures/rise-runtime-lifting.js'),
        'utf8',
      ),
    );
    prisma.scormPackage.findFirst.mockResolvedValue(null);
    prisma.module.create.mockResolvedValue({ id: 'mod-1' });
    prisma.chapter.create.mockResolvedValue({ id: 'ch-1' });
    prisma.section.create.mockResolvedValue({ id: 'sec-1' });
    prisma.scormPackage.update.mockImplementation(async ({ data }) => ({
      id: 'pkg-1',
      courseId: 'course-1',
      ...data,
    }));

    await service.completeImportIfReady('pkg-1', 'admin-1');

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
    expect(prisma.section.create).not.toHaveBeenCalled();
    expect(courseVersionService.publishNewVersion).not.toHaveBeenCalled();
  });
});
