import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseDeliveryMode,
  Prisma,
  ScormPackageStatus,
  SectionType,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { CourseVersionService } from '../course-version/course-version.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScormCloudClient, ScormCloudHttpError } from '../scorm-cloud/scorm-cloud.client';
import {
  parseRiseRuntimeData,
  RiseProbeResult,
  unescapeRiseTitle,
} from '../utils/rise-probe';
import { CreateScormPackageDto } from './dto';
import { isImportJobComplete, isImportJobError, isImportJobRunning } from './scorm-status';

const TREE_LOCK_SEED = 1;
const IMPORT_CRON_BATCH = 8;
const PLACEHOLDER_IMAGE =
  'https://res.cloudinary.com/demo/image/upload/sample.jpg';

@Injectable()
export class ScormService {
  private readonly logger = new Logger(ScormService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloud: ScormCloudClient,
    private readonly courseVersionService: CourseVersionService,
  ) {}

  async createPackage(adminId: string, body: CreateScormPackageDto) {
    const contentUrl = body.contentUrl.trim();
    if (!contentUrl.startsWith('https://')) {
      throw new BadRequestException(
        'contentUrl must be a durable public HTTPS URL (the zip never enters this API)',
      );
    }

    const course = body.courseId
      ? await this.prepareExistingCourse(body.courseId)
      : await this.createImportedCourse(body);

    const inFlight = await this.prisma.scormPackage.findFirst({
      where: { courseId: course.id, status: ScormPackageStatus.PROCESSING },
    });
    if (inFlight) {
      throw new ConflictException(
        'An import is already in progress for this course. Wait for it to finish (or fail) before starting another.',
      );
    }

    const latest = await this.prisma.scormPackage.findFirst({
      where: { courseId: course.id },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    const scormCloudCourseId = randomUUID();
    const title = (body.title?.trim() || course.title).trim();

    const pkg = await this.prisma.scormPackage.create({
      data: {
        courseId: course.id,
        versionNumber,
        title,
        scormCloudCourseId,
        zipSha256: body.zipSha256 ?? null,
        completeOn: body.completeOn,
        passingScore: body.passingScore ?? null,
        status: ScormPackageStatus.PROCESSING,
      },
    });

    try {
      const jobId = await this.cloud.createFetchAndImportCourseJob({
        courseId: scormCloudCourseId,
        url: contentUrl,
      });
      const updated = await this.prisma.scormPackage.update({
        where: { id: pkg.id },
        data: { cloudImportJobId: jobId },
      });
      return {
        message: 'SCORM import job started',
        statusCode: 200,
        data: updated,
      };
    } catch (err) {
      const reason = cloudErrorMessage(err);
      await this.prisma.scormPackage.update({
        where: { id: pkg.id },
        data: { status: ScormPackageStatus.FAILED, failureReason: reason },
      });
      throw err instanceof HttpException
        ? err
        : new HttpException(reason, HttpStatus.BAD_GATEWAY);
    }
  }

  async getPackage(id: string) {
    const pkg = await this.prisma.scormPackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('SCORM package not found');
    return { message: 'ok', statusCode: 200, data: pkg };
  }

  async listPackages(courseId: string) {
    const packages = await this.prisma.scormPackage.findMany({
      where: { courseId },
      orderBy: { versionNumber: 'desc' },
    });
    return { message: 'ok', statusCode: 200, data: packages };
  }

  async getImportStatus(id: string, adminId?: string | null) {
    const result = await this.completeImportIfReady(id, adminId ?? null);
    return { message: 'ok', statusCode: 200, data: result };
  }

  async processImportJobsCron() {
    const pending = await this.prisma.scormPackage.findMany({
      where: {
        status: ScormPackageStatus.PROCESSING,
        cloudImportJobId: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      take: IMPORT_CRON_BATCH,
    });
    const results: Array<{ id: string; status: string }> = [];
    for (const pkg of pending) {
      try {
        const data = await this.completeImportIfReady(pkg.id, null);
        results.push({ id: pkg.id, status: String(data.status) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Import-job cron failed for package ${pkg.id}: ${message}`);
        results.push({ id: pkg.id, status: 'error' });
      }
    }
    return { processed: results.length, results };
  }

  async replacePreview(courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, deliveryMode: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.deliveryMode !== CourseDeliveryMode.IMPORTED_SCORM) {
      throw new BadRequestException('Course is not an imported SCORM course');
    }

    const current = await this.prisma.scormPackage.findFirst({
      where: { courseId, status: ScormPackageStatus.READY },
      orderBy: { versionNumber: 'desc' },
    });
    if (!current) {
      return {
        message: 'ok',
        statusCode: 200,
        data: {
          completedOnOldPackage: 0,
          pinnedEnrollments: 0,
          floatingEnrollments: 0,
          packageId: null,
        },
      };
    }

    const registrations = await this.prisma.scormRegistration.findMany({
      where: { packageId: current.id },
      select: {
        completeOn: true,
        completionStatus: true,
        successStatus: true,
      },
    });
    const completedOnOldPackage = registrations.filter((row) =>
      row.completeOn === 'passed'
        ? row.successStatus === 'passed'
        : row.completionStatus === 'completed',
    ).length;

    const latest = await this.courseVersionService.getLatestPublishedVersion(
      courseId,
    );
    const [pinnedEnrollments, floatingEnrollments] = await Promise.all([
      latest
        ? this.prisma.userCourse.count({
            where: { courseId, enrolledVersionId: latest.id },
          })
        : Promise.resolve(0),
      this.prisma.userCourse.count({
        where: { courseId, enrolledVersionId: null },
      }),
    ]);

    return {
      message: 'ok',
      statusCode: 200,
      data: {
        packageId: current.id,
        versionNumber: current.versionNumber,
        completedOnOldPackage,
        pinnedEnrollments,
        floatingEnrollments,
      },
    };
  }

  /**
   * Poll Cloud, then (once) build the synthetic tree in its own locked
   * transaction, commit, then publishNewVersion in its own tx.
   */
  async completeImportIfReady(packageId: string, adminId: string | null) {
    const pkg = await this.prisma.scormPackage.findUnique({
      where: { id: packageId },
    });
    if (!pkg) throw new NotFoundException('SCORM package not found');
    if (pkg.status === ScormPackageStatus.FAILED) return pkg;
    if (pkg.status === ScormPackageStatus.SUPERSEDED) return pkg;
    if (pkg.status === ScormPackageStatus.READY && pkg.sectionId) return pkg;

    if (pkg.sectionId && pkg.status === ScormPackageStatus.PROCESSING) {
      return this.finishPublishAndReady(pkg.id, pkg.courseId, adminId);
    }

    if (!pkg.cloudImportJobId) {
      return pkg;
    }

    const job = await this.cloud.getImportJobStatus(pkg.cloudImportJobId);
    if (isImportJobRunning(job.status) || !job.status) {
      return pkg;
    }
    if (isImportJobError(job.status)) {
      return this.prisma.scormPackage.update({
        where: { id: pkg.id },
        data: {
          status: ScormPackageStatus.FAILED,
          failureReason: job.message || 'SCORM Cloud import job failed',
        },
      });
    }
    if (!isImportJobComplete(job.status)) {
      this.logger.warn(
        `Import job ${pkg.cloudImportJobId} has unrecognised status "${job.status}" — leaving PROCESSING`,
      );
      return pkg;
    }

    let probe: RiseProbeResult | null = null;
    try {
      const asset = await this.cloud.getCourseAsset(
        pkg.scormCloudCourseId,
        'scormcontent/runtime-data.js',
      );
      probe = parseRiseRuntimeData(asset);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Rise probe failed for package ${pkg.id}: ${message}`,
      );
    }

    const gate = this.policyGate(pkg.completeOn, probe);
    if (gate.refuse) {
      return this.prisma.scormPackage.update({
        where: { id: pkg.id },
        data: {
          status: ScormPackageStatus.FAILED,
          failureReason: gate.reason,
          riseProbeJson: probe ? (probe as unknown as Prisma.InputJsonValue) : undefined,
        },
      });
    }
    if (gate.warn) {
      this.logger.warn(`Package ${pkg.id}: ${gate.warn}`);
    }

    const chapterTitle = unescapeRiseTitle(probe?.title || pkg.title);

    try {
      await this.prisma.$transaction(
        async (tx) => {
          const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>(
            Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${pkg.id}, ${TREE_LOCK_SEED})) AS locked`,
          );
          if (!locked) {
            throw new ConflictException(
              `Another complete-import is already in progress for package ${pkg.id}`,
            );
          }

          const fresh = await tx.scormPackage.findUnique({
            where: { id: pkg.id },
          });
          if (!fresh) return;
          if (fresh.sectionId) return;

          await this.buildOrReplaceTree(tx, {
            courseId: pkg.courseId,
            packageId: pkg.id,
            versionNumber: pkg.versionNumber,
            chapterTitle,
            completeOn: pkg.completeOn,
            passingScore: pkg.passingScore ?? probe?.passingScore ?? null,
            riseProbeJson: probe,
          });
        },
        { timeout: 20000 },
      );
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Synthetic tree failed for package ${pkg.id}: ${message}`);
      return this.prisma.scormPackage.update({
        where: { id: pkg.id },
        data: {
          status: ScormPackageStatus.FAILED,
          failureReason: message,
          riseProbeJson: probe ? (probe as unknown as Prisma.InputJsonValue) : undefined,
        },
      });
    }

    return this.finishPublishAndReady(pkg.id, pkg.courseId, adminId);
  }

  private async finishPublishAndReady(
    packageId: string,
    courseId: string,
    adminId: string | null,
  ) {
    const published = await this.courseVersionService.publishNewVersion(
      adminId,
      courseId,
      'Imported SCORM package',
    );
    return this.prisma.scormPackage.update({
      where: { id: packageId },
      data: {
        status: ScormPackageStatus.READY,
        failureReason: null,
      },
    }).then((pkg) => ({ ...pkg, publishedVersion: published }));
  }

  private policyGate(
    completeOn: string,
    probe: RiseProbeResult | null,
  ): { refuse: boolean; reason?: string; warn?: string } {
    const quizItemCount = probe?.quizItemCount ?? 0;
    const reporting = probe?.reporting ?? null;

    if (completeOn === 'passed') {
      if (!probe) {
        return {
          refuse: true,
          reason:
            'completeOn is "passed" but the Rise probe could not run, so quiz/reporting cannot be verified',
        };
      }
      if (quizItemCount === 0) {
        return {
          refuse: true,
          reason:
            'completeOn is "passed" but this package has no scoreable quiz items',
        };
      }
      if (!reporting || !reporting.startsWith('passed-')) {
        return {
          refuse: true,
          reason: `completeOn is "passed" but Rise reporting is "${reporting ?? 'unknown'}" (expected passed-*)`,
        };
      }
    }

    if (completeOn === 'completed' && quizItemCount === 0) {
      return {
        refuse: false,
        warn: 'Package has no quiz items; completeOn "completed" will fire when the SCO reports completed',
      };
    }
    return { refuse: false };
  }

  private async buildOrReplaceTree(
    tx: Prisma.TransactionClient,
    args: {
      courseId: string;
      packageId: string;
      versionNumber: number;
      chapterTitle: string;
      completeOn: string;
      passingScore: number | null;
      riseProbeJson: RiseProbeResult | null;
    },
  ) {
    const config: Prisma.InputJsonValue = {
      packageId: args.packageId,
      completeOn: args.completeOn,
      ...(args.passingScore != null ? { passingScore: args.passingScore } : {}),
    };

    const previousReady = await tx.scormPackage.findFirst({
      where: {
        courseId: args.courseId,
        status: ScormPackageStatus.READY,
        id: { not: args.packageId },
      },
      orderBy: { versionNumber: 'desc' },
    });

    let moduleId: string;
    let chapterId: string;

    if (previousReady?.sectionId) {
      const oldSection = await tx.section.findUnique({
        where: { id: previousReady.sectionId },
        select: { chapterId: true, moduleId: true },
      });
      if (!oldSection?.chapterId || !oldSection.moduleId) {
        throw new Error('Previous SCORM section is missing chapter/module');
      }
      moduleId = oldSection.moduleId;
      chapterId = oldSection.chapterId;
      await tx.section.update({
        where: { id: previousReady.sectionId },
        data: { isArchived: true, archivedAt: new Date() },
      });
      await tx.scormPackage.update({
        where: { id: previousReady.id },
        data: { status: ScormPackageStatus.SUPERSEDED },
      });
    } else {
      const mod = await tx.module.create({
        data: {
          title: 'Course content',
          description: '',
          courseId: args.courseId,
        },
      });
      const chapter = await tx.chapter.create({
        data: {
          title: args.chapterTitle,
          description: '',
          pdfFile: '',
          moduleId: mod.id,
        },
      });
      moduleId = mod.id;
      chapterId = chapter.id;
    }

    const section = await tx.section.create({
      data: {
        title: args.chapterTitle,
        description: '',
        chapterId,
        moduleId,
        type: SectionType.SCORM,
        orderIndex: 1,
        config,
      },
    });

    await tx.scormPackage.update({
      where: { id: args.packageId },
      data: {
        sectionId: section.id,
        title: args.chapterTitle,
        riseProbeJson: args.riseProbeJson
          ? (args.riseProbeJson as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  private async prepareExistingCourse(courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) throw new NotFoundException('Course not found');

    if (course.deliveryMode === CourseDeliveryMode.NATIVE) {
      const liveModules = await this.prisma.module.count({
        where: { courseId, isArchived: false },
      });
      if (liveModules > 0) {
        throw new BadRequestException(
          'Cannot import SCORM over a native course that already has modules',
        );
      }
    }

    return this.prisma.course.update({
      where: { id: courseId },
      data: {
        deliveryMode: CourseDeliveryMode.IMPORTED_SCORM,
        isActive: false,
      },
    });
  }

  private async createImportedCourse(body: CreateScormPackageDto) {
    const title = body.title?.trim();
    if (!title) {
      throw new BadRequestException(
        'title is required when creating a course with the package',
      );
    }
    const existing = await this.prisma.course.findUnique({
      where: { title },
    });
    if (existing) {
      throw new ConflictException('Course already exists with that title');
    }

    return this.prisma.course.create({
      data: {
        title,
        description: body.description?.trim() || '',
        image: body.image?.trim() || PLACEHOLDER_IMAGE,
        overview: body.overview?.trim() || '',
        duration: body.duration?.trim() || '',
        assessment: body.assessment?.trim() || '',
        syllabusOverview: body.syllabusOverview?.trim() || '',
        resourcesOverview: body.resourcesOverview?.trim() || '',
        assessments: [],
        resources: [],
        syllabus: [],
        deliveryMode: CourseDeliveryMode.IMPORTED_SCORM,
        isActive: false,
      },
    });
  }
}

function cloudErrorMessage(err: unknown): string {
  if (err instanceof ScormCloudHttpError) {
    return `SCORM Cloud HTTP ${err.cloudStatus}: ${err.cloudBody.slice(0, 300)}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
