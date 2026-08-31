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

    const resolved = await this.resolvePinnedScormTarget(user.id, body.courseId);
    if (
      body.packageId &&
      body.packageId !== resolved.package.id
    ) {
      throw new ConflictException(
        'packageId does not match the SCORM package on your pinned curriculum',
      );
    }

    const isLearner = user.role === Role.user;
    if (isLearner) {
      await assertEnrollmentUsable(
        this.prisma,
        user.id,
        body.courseId,
        Role.user,
      );
      if (!resolved.courseIsActive) {
        throw new ForbiddenException('This course is not published yet');
      }
    }

    const pkgStatus = resolved.package.status;
    if (
      pkgStatus !== ScormPackageStatus.READY &&
      pkgStatus !== ScormPackageStatus.SUPERSEDED
    ) {
      throw new ForbiddenException('This SCORM package is not ready to launch');
    }

    const registration = await this.ensureCloudRegistration({
      user,
      courseId: body.courseId,
      packageId: resolved.package.id,
      scormCloudCourseId: resolved.package.scormCloudCourseId,
      sectionId: resolved.sectionId,
      moduleId: resolved.moduleId,
      chapterId: resolved.chapterId,
      completeOn: resolved.completeOn,
    });

    await this.upsertLastSeen({
      userId: user.id,
      courseId: body.courseId,
      moduleId: resolved.moduleId,
      chapterId: resolved.chapterId,
      sectionId: resolved.sectionId,
    });

    const frontend = this.config.get<string>('PUBLIC_FRONTEND_URL');
    if (!frontend) {
      throw new InternalServerErrorException(
        'PUBLIC_FRONTEND_URL is not configured',
      );
    }
    const launchLink = await this.cloud.buildRegistrationLaunchLink({
      registrationId: registration.scormCloudRegistrationId,
      redirectOnExitUrl: frontend.replace(/\/$/, ''),
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

    await this.applyProgressAndMaybeCertify(row.id, parsed, {
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

    let updated = 0;
    for (const { id } of candidates) {
      try {
        const row = await this.prisma.scormRegistration.findUnique({
          where: { id },
        });
        if (!row) continue;
        const progress = await this.cloud.getRegistrationProgress(
          row.scormCloudRegistrationId,
        );
        await this.applyProgressAndMaybeCertify(row.id, progress, {
          throwIfCertifyIncomplete: false,
        });
        updated += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Reconcile failed for registration ${id}: ${message}`);
      }
    }

    return { candidates: candidates.length, updated };
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
    registrationId: string,
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

    const current = await this.prisma.scormRegistration.findUnique({
      where: { id: registrationId },
    });
    if (!current) {
      throw new InternalServerErrorException('SCORM registration disappeared');
    }

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
      where: { id: registrationId },
      data: {
        completionStatus,
        successStatus,
        scoreScaled: scoreScaled ?? current.scoreScaled,
        totalTimeSeconds: totalTimeSeconds ?? current.totalTimeSeconds,
        lastPostbackAt: new Date(),
      },
    });

    if (
      !completeOnSatisfied(current.completeOn, completionStatus, successStatus)
    ) {
      return;
    }

    const certified = await this.runCompletionBridge(current);
    if (!certified && options.throwIfCertifyIncomplete) {
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
  }): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      this.logger.warn(
        `Skipping SCORM certify for registration ${row.id}: user missing or deleted`,
      );
      return false;
    }

    try {
      await assertEnrollmentUsable(
        this.prisma,
        row.userId,
        row.courseId,
        Role.user,
      );
    } catch (err) {
      this.logger.warn(
        `Skipping SCORM certify for registration ${row.id}: enrolment not usable`,
      );
      return false;
    }

    const section = await this.prisma.section.findUnique({
      where: { id: row.sectionId },
      select: { chapterId: true, moduleId: true },
    });
    if (!section?.chapterId || !section.moduleId) {
      this.logger.warn(
        `Skipping SCORM certify for registration ${row.id}: section missing module/chapter`,
      );
      return false;
    }

    const existingProgress = await this.prisma.userCourseProgress.findFirst({
      where: {
        userId: row.userId,
        courseId: row.courseId,
        chapterId: section.chapterId,
        sectionId: row.sectionId,
      },
    });
    if (!existingProgress) {
      await this.prisma.userCourseProgress.create({
        data: {
          userId: row.userId,
          courseId: row.courseId,
          chapterId: section.chapterId,
          sectionId: row.sectionId,
          moduleId: section.moduleId,
        },
      });
    }

    await this.courseCompletion.checkContentCompletion(
      row.userId,
      row.courseId,
    );

    await this.prisma.courseCompletion.upsert({
      where: {
        userId_courseId: { userId: row.userId, courseId: row.courseId },
      },
      create: {
        userId: row.userId,
        courseId: row.courseId,
        isPassed: true,
        assessmentPassedAt: new Date(),
      },
      update: {
        isPassed: true,
        assessmentPassedAt: new Date(),
      },
    });

    await recordChapterAndModuleCompletionIfNeeded(
      this.prisma,
      row.userId,
      section.chapterId,
      { courseId: row.courseId },
    );

    const completion = await this.prisma.courseCompletion.findUnique({
      where: {
        userId_courseId: { userId: row.userId, courseId: row.courseId },
      },
      select: { courseCompletedAt: true, isPassed: true },
    });

    const done = !!(completion?.courseCompletedAt && completion.isPassed);
    if (done) {
      await this.prisma.scormRegistration.update({
        where: { id: row.id },
        data: { completedAt: new Date() },
      });
    }
    return done;
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
          url: `${publicApp.replace(/\/$/, '')}/api/v1/scorm/postback`,
          authType: 'HTTPBASIC',
          userName: postUser,
          password: postPass,
          resultsFormat: 'COURSE',
        },
      });
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
        // Cloud has a registration we don't. Continue using the id we sent
        // if the 409 is for this id; otherwise fail closed.
        this.logger.warn(
          `SCORM Cloud 409 creating registration ${registrationId} with no local row`,
        );
      } else {
        throw err;
      }
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
          try {
            await this.cloud.deleteRegistration(registrationId);
          } catch (cleanupErr) {
            const message =
              cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
            this.logger.warn(
              `Failed to compensate Cloud registration ${registrationId}: ${message}`,
            );
          }
          return raced;
        }
      }
      try {
        await this.cloud.deleteRegistration(registrationId);
      } catch (cleanupErr) {
        const message =
          cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
        this.logger.warn(
          `Failed to compensate Cloud registration ${registrationId}: ${message}`,
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

