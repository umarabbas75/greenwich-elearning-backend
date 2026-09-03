import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CourseDeliveryMode,
  Prisma,
  Role,
  ScormPackageStatus,
  ScormRegistration,
  SectionType,
  User,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { CourseVersionService } from '../course-version/course-version.service';
import {
  PinnedCurriculumSection,
  PinnedCurriculumTree,
} from '../course-version/course-version.manifest';
import { PrismaService } from '../prisma/prisma.service';
import {
  ScormCloudClient,
  ScormCloudHttpError,
  ScormCloudRegistrationProgress,
} from '../scorm-cloud/scorm-cloud.client';
import { assertEnrollmentUsable } from '../utils/assert-enrollment-usable';
import { recordChapterAndModuleCompletionIfNeeded } from '../utils/chapter-progression';
import { errorMessage } from '../utils/error-message';
import { compensateCloudRegistration } from '../utils/scorm-cloud-compensate';
import { stripTrailingSlash } from '../utils/strip-trailing-slash';
import { LaunchScormDto } from './dto';
import {
  COMPLETION_RANK,
  completeOnSatisfied,
  mapRegistrationCompletion,
  mapRegistrationSuccess,
  parseScormSectionConfig,
  pickMonotonic,
  SUCCESS_RANK,
} from './scorm-status';

const RECONCILE_BATCH = 20;
const DEFAULT_RECONCILE_AGE_SECONDS = 300;
const PRUNE_SUPERSEDED_BATCH = 10;

type CertifyOutcome = 'done' | 'skipped' | 'retry';

@Injectable()
export class ScormRuntimeService {
  private readonly logger = new Logger(ScormRuntimeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cloud: ScormCloudClient,
    private readonly courseVersionService: CourseVersionService,
    private readonly courseCompletion: CourseCompletionService,
  ) {}

  async launch(user: User, body: LaunchScormDto): Promise<{ launchLink: string }> {
    if (user.deletedAt) {
      throw new ForbiddenException('Account is not available');
    }

    const frontend = this.config.get<string>('PUBLIC_FRONTEND_URL');
    if (!frontend) {
      throw new InternalServerErrorException(
        'PUBLIC_FRONTEND_URL is not configured',
      );
    }

    const isLearner = user.role === Role.user;
    const resolved = isLearner
      ? (
          await Promise.all([
            this.resolvePinnedScormTarget(user.id, body.courseId),
            assertEnrollmentUsable(
              this.prisma,
              user.id,
              body.courseId,
              Role.user,
            ),
          ])
        )[0]
      : await this.resolvePinnedScormTarget(user.id, body.courseId);

    if (
      body.packageId &&
      body.packageId !== resolved.package.id
    ) {
      throw new ConflictException(
        'packageId does not match the SCORM package on your pinned curriculum',
      );
    }

    if (isLearner && !resolved.courseIsActive) {
      throw new ForbiddenException('This course is not published yet');
    }

    const pkgStatus = resolved.package.status;
    if (
      pkgStatus !== ScormPackageStatus.READY &&
      pkgStatus !== ScormPackageStatus.SUPERSEDED
    ) {
      throw new ForbiddenException('This SCORM package is not ready to launch');
    }

    const [registration] = await Promise.all([
      this.ensureCloudRegistration({
        user,
        courseId: body.courseId,
        packageId: resolved.package.id,
        scormCloudCourseId: resolved.package.scormCloudCourseId,
        sectionId: resolved.sectionId,
        moduleId: resolved.moduleId,
        chapterId: resolved.chapterId,
        completeOn: resolved.completeOn,
      }),
      this.upsertLastSeen({
        userId: user.id,
        courseId: body.courseId,
        moduleId: resolved.moduleId,
        chapterId: resolved.chapterId,
        sectionId: resolved.sectionId,
      }),
    ]);

    const launchLink = await this.cloud.buildRegistrationLaunchLink({
      registrationId: registration.scormCloudRegistrationId,
      redirectOnExitUrl: stripTrailingSlash(frontend),
      expiry: 120,
    });

    return { launchLink };
  }

  /**
   * Persist Cloud snapshot first. Then, if completeOn is satisfied, run the
   * D1 certify bridge. Missing row or incomplete certify → 5xx so Cloud retries.
   */
  async handlePostback(payload: unknown): Promise<void> {
    const parsed = this.parseProgressPayload(payload);
    if (!parsed.id) {
      throw new InternalServerErrorException('Postback payload is missing id');
    }

    const row = await this.prisma.scormRegistration.findUnique({
      where: { scormCloudRegistrationId: parsed.id },
    });
    if (!row) {
      throw new InternalServerErrorException(
        'Unknown SCORM registration (dummy TestRegistrationPostback ids are expected to 5xx after auth)',
      );
    }

    await this.applyProgressAndMaybeCertify(row, parsed, {
      throwIfCertifyIncomplete: true,
    });
  }

  async reconcileCron() {
    const ageSeconds = Number(
      this.config.get('SCORM_RECONCILE_AGE_SECONDS') ??
        DEFAULT_RECONCILE_AGE_SECONDS,
    );
    const cutoff = new Date(Date.now() - ageSeconds * 1000);

    const candidates = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT sr.id
          FROM "scorm_registrations" sr
          LEFT JOIN "course_completions" cc
            ON cc."userId" = sr."userId" AND cc."courseId" = sr."courseId"
         WHERE COALESCE(sr."lastPostbackAt", sr."firstLaunchAt", sr."createdAt") < ${cutoff}
           AND (
             (sr."completeOn" = 'passed' AND sr."successStatus" <> 'passed')
             OR (sr."completeOn" <> 'passed' AND sr."completionStatus" <> 'completed')
             OR (
               (
                 (sr."completeOn" = 'passed' AND sr."successStatus" = 'passed')
                 OR (sr."completeOn" <> 'passed' AND sr."completionStatus" = 'completed')
               )
               AND (cc."courseCompletedAt" IS NULL OR cc."isPassed" = false)
             )
           )
         ORDER BY COALESCE(sr."lastPostbackAt", sr."firstLaunchAt", sr."createdAt") ASC
         LIMIT ${RECONCILE_BATCH}
      `,
    );

    if (candidates.length === 0) {
      return { candidates: 0, updated: 0 };
    }

    const rows = await this.prisma.scormRegistration.findMany({
      where: { id: { in: candidates.map((c) => c.id) } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));

    const results = await Promise.all(
      candidates.map(async ({ id }) => {
        try {
          const row = byId.get(id);
          if (!row) return false;
          const progress = await this.cloud.getRegistrationProgress(
            row.scormCloudRegistrationId,
          );
          const fresh = await this.prisma.scormRegistration.findUnique({
            where: { id },
          });
          if (!fresh) return false;
          await this.applyProgressAndMaybeCertify(fresh, progress, {
            throwIfCertifyIncomplete: false,
          });
          return true;
        } catch (err) {
          this.logger.warn(
            `Reconcile failed for registration ${id}: ${errorMessage(err)}`,
          );
          return false;
        }
      }),
    );

    return {
      candidates: candidates.length,
      updated: results.filter(Boolean).length,
    };
  }

  /**
   * Best-effort prune of SUPERSEDED packages whose Cloud course is no longer
   * referenced by in-progress registrations or pinned enrollments on the old
   * section's version.
   */
  async pruneSupersededPackagesCron() {
    const superseded = await this.prisma.scormPackage.findMany({
      where: {
        status: ScormPackageStatus.SUPERSEDED,
        sectionId: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      take: PRUNE_SUPERSEDED_BATCH,
      select: {
        id: true,
        courseId: true,
        sectionId: true,
        scormCloudCourseId: true,
      },
    });

    let pruned = 0;
    for (const pkg of superseded) {
      try {
        const canPrune = await this.canPruneSupersededPackage(pkg);
        if (!canPrune) continue;

        const registrations = await this.prisma.scormRegistration.findMany({
          where: { packageId: pkg.id },
          select: { scormCloudRegistrationId: true },
        });
        for (const reg of registrations) {
          await compensateCloudRegistration(
            this.cloud,
            reg.scormCloudRegistrationId,
            this.logger,
          );
        }
        try {
          await this.cloud.deleteCourse(pkg.scormCloudCourseId);
        } catch (err) {
          this.logger.warn(
            `Failed SCORM Cloud DeleteCourse ${pkg.scormCloudCourseId}: ${errorMessage(err)}`,
          );
          continue;
        }
        await this.prisma.scormPackage.update({
          where: { id: pkg.id },
          data: { status: ScormPackageStatus.PRUNED },
        });
        pruned += 1;
      } catch (err) {
        this.logger.warn(
          `Prune check failed for package ${pkg.id}: ${errorMessage(err)}`,
        );
      }
    }

    return { candidates: superseded.length, pruned };
  }

  async getLearnerProgress(userId: string, courseId: string) {
    if (!courseId) {
      throw new BadRequestException('courseId is required');
    }
    const row = await this.prisma.scormRegistration.findFirst({
      where: { userId, courseId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        packageId: true,
        completionStatus: true,
        successStatus: true,
        scoreScaled: true,
        totalTimeSeconds: true,
        firstLaunchAt: true,
        lastPostbackAt: true,
        completedAt: true,
      },
    });
    return { message: 'ok', statusCode: 200, data: row };
  }

  async applyProgressAndMaybeCertify(
    current: ScormRegistration,
    payload: ScormCloudRegistrationProgress,
    options: { throwIfCertifyIncomplete: boolean },
  ): Promise<void> {
    const incomingCompletion = mapRegistrationCompletion(
      payload.registrationCompletion,
    );
    const incomingSuccess = mapRegistrationSuccess(payload.registrationSuccess);
    const scoreScaled =
      typeof payload.score?.scaled === 'number' ? payload.score.scaled : null;
    const totalTimeSeconds =
      typeof payload.totalSecondsTracked === 'number'
        ? payload.totalSecondsTracked
        : null;

    const completionStatus = pickMonotonic(
      current.completionStatus,
      incomingCompletion,
      COMPLETION_RANK,
    );
    const successStatus = pickMonotonic(
      current.successStatus,
      incomingSuccess,
      SUCCESS_RANK,
    );

    await this.prisma.scormRegistration.update({
      where: { id: current.id },
      data: {
        completionStatus,
        successStatus,
        ...(scoreScaled != null ? { scoreScaled } : {}),
        ...(totalTimeSeconds != null
          ? {
              totalTimeSeconds:
                current.totalTimeSeconds != null
                  ? Math.max(totalTimeSeconds, current.totalTimeSeconds)
                  : totalTimeSeconds,
            }
          : {}),
        lastPostbackAt: new Date(),
      },
    });

    if (
      !completeOnSatisfied(current.completeOn, completionStatus, successStatus)
    ) {
      return;
    }

    const outcome = await this.runCompletionBridge(
      { ...current, completionStatus, successStatus },
    );
    if (outcome === 'skipped') {
      return;
    }
    if (outcome === 'done') {
      return;
    }
    if (options.throwIfCertifyIncomplete) {
      throw new InternalServerErrorException(
        'SCORM snapshot saved but course certification is not complete yet',
      );
    }
  }

  private async runCompletionBridge(row: {
    id: string;
    userId: string;
    courseId: string;
    packageId: string;
    sectionId: string;
    completeOn: string;
    completionStatus: string;
    successStatus: string;
  }): Promise<CertifyOutcome> {
    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      this.logger.warn(
        `Skipping SCORM certify for registration ${row.id}: user missing or deleted`,
      );
      return 'skipped';
    }

    try {
      await assertEnrollmentUsable(
        this.prisma,
        row.userId,
        row.courseId,
        Role.user,
      );
    } catch (err) {
      if (err instanceof ForbiddenException) {
        this.logger.warn(
          `Skipping SCORM certify for registration ${row.id}: enrolment not usable (${errorMessage(err)})`,
        );
        return 'skipped';
      }
      throw err;
    }

    const course = await this.prisma.course.findUnique({
      where: { id: row.courseId },
      select: { isActive: true },
    });
    if (!course?.isActive) {
      this.logger.warn(
        `Skipping SCORM certify for registration ${row.id}: course is not published`,
      );
      return 'skipped';
    }

    const pkg = await this.prisma.scormPackage.findUnique({
      where: { id: row.packageId },
      select: { sectionId: true },
    });
    let sectionId = pkg?.sectionId ?? row.sectionId;
    if (!sectionId) {
      this.logger.warn(
        `Skipping SCORM certify for registration ${row.id}: package has no section`,
      );
      return 'retry';
    }
    if (pkg?.sectionId && pkg.sectionId !== row.sectionId) {
      await this.prisma.scormRegistration.update({
        where: { id: row.id },
        data: { sectionId: pkg.sectionId },
      });
      sectionId = pkg.sectionId;
    }

    const certifySection = await this.resolveCertifySection({
      registrationId: row.id,
      userId: row.userId,
      courseId: row.courseId,
      sectionId,
    });
    if (!certifySection) {
      this.logger.warn(
        `Skipping SCORM certify for registration ${row.id}: could not resolve a certify section`,
      );
      return 'retry';
    }

    const existingProgress = await this.prisma.userCourseProgress.findFirst({
      where: {
        userId: row.userId,
        courseId: row.courseId,
        chapterId: certifySection.chapterId,
        sectionId: certifySection.sectionId,
      },
    });
    if (!existingProgress) {
      await this.prisma.userCourseProgress.create({
        data: {
          userId: row.userId,
          courseId: row.courseId,
          chapterId: certifySection.chapterId,
          sectionId: certifySection.sectionId,
          moduleId: certifySection.moduleId,
        },
      });
    }

    await this.courseCompletion.checkContentCompletion(
      row.userId,
      row.courseId,
    );

    let completion = await this.prisma.courseCompletion.findUnique({
      where: {
        userId_courseId: { userId: row.userId, courseId: row.courseId },
      },
      select: { courseCompletedAt: true, isPassed: true },
    });
    if (!completion?.courseCompletedAt) {
      return 'retry';
    }

    // completeOn "completed" certifies on completion status only (not SCORM success).
    const certifyPassed =
      row.completeOn === 'passed'
        ? row.successStatus === 'passed'
        : row.completionStatus === 'completed';

    if (certifyPassed && !completion.isPassed) {
      await this.prisma.courseCompletion.update({
        where: {
          userId_courseId: { userId: row.userId, courseId: row.courseId },
        },
        data: {
          isPassed: true,
          assessmentPassedAt: new Date(),
        },
      });
      completion = await this.prisma.courseCompletion.findUnique({
        where: {
          userId_courseId: { userId: row.userId, courseId: row.courseId },
        },
        select: { courseCompletedAt: true, isPassed: true },
      });
    }

    await recordChapterAndModuleCompletionIfNeeded(
      this.prisma,
      row.userId,
      certifySection.chapterId,
      { courseId: row.courseId },
    );

    const done = !!(completion?.courseCompletedAt && completion.isPassed);
    if (done) {
      await this.prisma.scormRegistration.update({
        where: { id: row.id },
        data: { completedAt: new Date() },
      });
    }
    return done ? 'done' : 'retry';
  }

  /**
   * Resolve which section row to stamp for certification. When a superseded
   * package's section is archived, pinned learners keep it; unpinned floaters
   * remap to the live SCORM section so checkContentCompletion's denominator matches.
   */
  private async resolveCertifySection(args: {
    registrationId: string;
    userId: string;
    courseId: string;
    sectionId: string;
  }): Promise<{ sectionId: string; chapterId: string; moduleId: string } | null> {
    const section = await this.prisma.section.findUnique({
      where: { id: args.sectionId },
      select: { id: true, chapterId: true, moduleId: true, isArchived: true },
    });
    if (!section?.chapterId || !section.moduleId) {
      return null;
    }

    if (!section.isArchived) {
      return {
        sectionId: section.id,
        chapterId: section.chapterId,
        moduleId: section.moduleId,
      };
    }

    const enrollment = await this.prisma.userCourse.findFirst({
      where: { userId: args.userId, courseId: args.courseId },
      select: { enrolledVersionId: true },
    });
    if (enrollment?.enrolledVersionId) {
      return {
        sectionId: section.id,
        chapterId: section.chapterId,
        moduleId: section.moduleId,
      };
    }

    const live = await this.prisma.section.findFirst({
      where: {
        type: SectionType.SCORM,
        isArchived: false,
        chapter: {
          isArchived: false,
          module: { courseId: args.courseId, isArchived: false },
        },
      },
      select: { id: true, chapterId: true, moduleId: true },
    });
    if (!live?.chapterId || !live.moduleId) {
      return null;
    }

    await this.prisma.scormRegistration.update({
      where: { id: args.registrationId },
      data: { sectionId: live.id },
    });

    return {
      sectionId: live.id,
      chapterId: live.chapterId,
      moduleId: live.moduleId,
    };
  }

  private async canPruneSupersededPackage(pkg: {
    id: string;
    courseId: string;
    sectionId: string | null;
  }): Promise<boolean> {
    if (!pkg.sectionId) return false;

    const inProgress = await this.prisma.scormRegistration.count({
      where: {
        packageId: pkg.id,
        completedAt: null,
        OR: [{ firstLaunchAt: { not: null } }, { lastPostbackAt: { not: null } }],
      },
    });
    if (inProgress > 0) return false;

    const versions = await this.prisma.courseVersion.findMany({
      where: { courseId: pkg.courseId, status: 'PUBLISHED' },
      select: { id: true, manifest: true },
    });
    for (const version of versions) {
      const manifest = version.manifest as Record<string, unknown> | null;
      const modules = (manifest?.modules as Array<Record<string, unknown>>) ?? [];
      const sectionIds = new Set<string>();
      for (const mod of modules) {
        const chapters = (mod.chapters as Array<Record<string, unknown>>) ?? [];
        for (const chapter of chapters) {
          const sections =
            (chapter.sections as Array<Record<string, unknown>>) ?? [];
          for (const section of sections) {
            if (typeof section.id === 'string') sectionIds.add(section.id);
          }
        }
      }
      if (!sectionIds.has(pkg.sectionId)) continue;

      const pinned = await this.prisma.userCourse.count({
        where: { courseId: pkg.courseId, enrolledVersionId: version.id },
      });
      if (pinned > 0) return false;
    }

    return true;
  }

  private async ensureCloudRegistration(args: {
    user: User;
    courseId: string;
    packageId: string;
    scormCloudCourseId: string;
    sectionId: string;
    moduleId: string;
    chapterId: string;
    completeOn: string;
  }) {
    const existing = await this.prisma.scormRegistration.findUnique({
      where: {
        userId_packageId: {
          userId: args.user.id,
          packageId: args.packageId,
        },
      },
    });
    if (existing) {
      if (!existing.firstLaunchAt) {
        return this.prisma.scormRegistration.update({
          where: { id: existing.id },
          data: { firstLaunchAt: new Date() },
        });
      }
      return existing;
    }

    const publicApp = this.config.get<string>('PUBLIC_APP_URL');
    const postUser = this.config.get<string>('SCORM_POSTBACK_AUTH_USER');
    const postPass = this.config.get<string>('SCORM_POSTBACK_AUTH_PASSWORD');
    if (!publicApp || !postUser || !postPass) {
      throw new InternalServerErrorException(
        'SCORM postback URL or credentials are not configured',
      );
    }

    const registrationId = randomUUID();
    let cloudCreated = false;
    try {
      await this.cloud.createRegistration({
        courseId: args.scormCloudCourseId,
        registrationId,
        learner: {
          id: args.user.id,
          firstName: args.user.firstName,
          lastName: args.user.lastName,
        },
        postBack: {
          url: `${stripTrailingSlash(publicApp)}/api/v1/scorm/postback`,
          authType: 'HTTPBASIC',
          userName: postUser,
          password: postPass,
          resultsFormat: 'COURSE',
        },
      });
      cloudCreated = true;
    } catch (err) {
      if (err instanceof ScormCloudHttpError && err.cloudStatus === 409) {
        const raced = await this.prisma.scormRegistration.findUnique({
          where: {
            userId_packageId: {
              userId: args.user.id,
              packageId: args.packageId,
            },
          },
        });
        if (raced) {
          if (!raced.firstLaunchAt) {
            return this.prisma.scormRegistration.update({
              where: { id: raced.id },
              data: { firstLaunchAt: new Date() },
            });
          }
          return raced;
        }
        throw new InternalServerErrorException(
          `SCORM Cloud 409 creating registration ${registrationId} with no local row — refusing to persist an unverified id`,
        );
      }
      throw err;
    }

    try {
      return await this.prisma.scormRegistration.create({
        data: {
          id: registrationId,
          userId: args.user.id,
          courseId: args.courseId,
          packageId: args.packageId,
          sectionId: args.sectionId,
          completeOn: args.completeOn,
          scormCloudRegistrationId: registrationId,
          firstLaunchAt: new Date(),
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const raced = await this.prisma.scormRegistration.findUnique({
          where: {
            userId_packageId: {
              userId: args.user.id,
              packageId: args.packageId,
            },
          },
        });
        if (raced) {
          if (cloudCreated) {
            await compensateCloudRegistration(
              this.cloud,
              registrationId,
              this.logger,
            );
          }
          return raced;
        }
      }
      if (cloudCreated) {
        await compensateCloudRegistration(
          this.cloud,
          registrationId,
          this.logger,
        );
      }
      throw err;
    }
  }

  private async upsertLastSeen(args: {
    userId: string;
    courseId: string;
    moduleId: string;
    chapterId: string;
    sectionId: string;
  }) {
    await this.prisma.lastSeenSection.upsert({
      where: {
        userId_chapterId: {
          userId: args.userId,
          chapterId: args.chapterId,
        },
      },
      update: { sectionId: args.sectionId },
      create: {
        userId: args.userId,
        chapterId: args.chapterId,
        sectionId: args.sectionId,
        moduleId: args.moduleId,
        courseId: args.courseId,
      },
    });
  }

  private async resolvePinnedScormTarget(userId: string, courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, isActive: true, deliveryMode: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.deliveryMode !== CourseDeliveryMode.IMPORTED_SCORM) {
      throw new BadRequestException('Course is not an imported SCORM course');
    }

    const curriculum =
      await this.courseVersionService.resolveCurriculumTree(userId, courseId);

    let section: {
      id: string;
      chapterId: string;
      moduleId: string | null;
      config: unknown;
    } | null = null;

    if (curriculum.mode === 'versioned') {
      const found = findScormSection(curriculum.tree);
      if (found) {
        section = {
          id: found.id,
          chapterId: found.chapterId,
          moduleId: found.moduleId,
          config: found.config,
        };
      }
    } else {
      section = await this.prisma.section.findFirst({
        where: {
          type: SectionType.SCORM,
          isArchived: false,
          chapter: {
            isArchived: false,
            module: { courseId, isArchived: false },
          },
        },
        select: { id: true, chapterId: true, moduleId: true, config: true },
      });
    }

    if (!section) {
      throw new NotFoundException('No SCORM section on this curriculum');
    }
    if (!section.moduleId) {
      throw new InternalServerErrorException(
        'SCORM section is missing moduleId',
      );
    }

    const config = parseScormSectionConfig(section.config);
    if (!config) {
      throw new InternalServerErrorException(
        'SCORM section is missing package config',
      );
    }

    const pkg = await this.prisma.scormPackage.findUnique({
      where: { id: config.packageId },
    });
    if (!pkg) {
      throw new NotFoundException('SCORM package not found');
    }

    return {
      courseIsActive: course.isActive,
      package: pkg,
      sectionId: section.id,
      chapterId: section.chapterId,
      moduleId: section.moduleId,
      completeOn: config.completeOn,
    };
  }

  private parseProgressPayload(payload: unknown): ScormCloudRegistrationProgress {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new InternalServerErrorException('Postback body must be JSON');
    }
    return payload as ScormCloudRegistrationProgress;
  }
}

function findScormSection(
  tree: PinnedCurriculumTree,
): PinnedCurriculumSection | null {
  for (const mod of tree.modules) {
    for (const chapter of mod.chapters) {
      for (const section of chapter.sections) {
        if (section.type === SectionType.SCORM) return section;
      }
    }
  }
  return null;
}
