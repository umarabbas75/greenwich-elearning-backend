"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ScormRuntimeService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScormRuntimeService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_1 = require("@prisma/client");
const crypto_1 = require("crypto");
const course_completion_service_1 = require("../course-completion/course-completion.service");
const course_version_service_1 = require("../course-version/course-version.service");
const prisma_service_1 = require("../prisma/prisma.service");
const scorm_cloud_client_1 = require("../scorm-cloud/scorm-cloud.client");
const assert_enrollment_usable_1 = require("../utils/assert-enrollment-usable");
const chapter_progression_1 = require("../utils/chapter-progression");
const error_message_1 = require("../utils/error-message");
const scorm_cloud_compensate_1 = require("../utils/scorm-cloud-compensate");
const scorm_player_url_1 = require("../utils/scorm-player-url");
const strip_trailing_slash_1 = require("../utils/strip-trailing-slash");
const scorm_status_1 = require("./scorm-status");
const RECONCILE_BATCH = 20;
const DEFAULT_RECONCILE_AGE_SECONDS = 300;
const PRUNE_SUPERSEDED_BATCH = 10;
let ScormRuntimeService = ScormRuntimeService_1 = class ScormRuntimeService {
    constructor(prisma, config, cloud, courseVersionService, courseCompletion) {
        this.prisma = prisma;
        this.config = config;
        this.cloud = cloud;
        this.courseVersionService = courseVersionService;
        this.courseCompletion = courseCompletion;
        this.logger = new common_1.Logger(ScormRuntimeService_1.name);
    }
    async launch(user, body) {
        if (user.deletedAt) {
            throw new common_1.ForbiddenException('Account is not available');
        }
        const frontend = this.config.get('PUBLIC_FRONTEND_URL');
        if (!frontend) {
            throw new common_1.InternalServerErrorException('PUBLIC_FRONTEND_URL is not configured');
        }
        const isLearner = user.role === client_1.Role.user;
        const resolved = isLearner
            ? (await Promise.all([
                this.resolvePinnedScormTarget(user.id, body.courseId),
                (0, assert_enrollment_usable_1.assertEnrollmentUsable)(this.prisma, user.id, body.courseId, client_1.Role.user),
            ]))[0]
            : await this.resolvePinnedScormTarget(user.id, body.courseId);
        if (body.packageId &&
            body.packageId !== resolved.package.id) {
            throw new common_1.ConflictException('packageId does not match the SCORM package on your pinned curriculum');
        }
        if (isLearner && !resolved.courseIsActive) {
            throw new common_1.ForbiddenException('This course is not published yet');
        }
        const pkgStatus = resolved.package.status;
        if (pkgStatus !== client_1.ScormPackageStatus.READY &&
            pkgStatus !== client_1.ScormPackageStatus.SUPERSEDED) {
            throw new common_1.ForbiddenException('This SCORM package is not ready to launch');
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
            redirectOnExitUrl: (0, scorm_player_url_1.scormPlayerReturnUrl)(frontend, body.courseId),
            expiry: 120,
        });
        return { launchLink };
    }
    async handlePostback(payload) {
        const parsed = this.parseProgressPayload(payload);
        if (!parsed.id) {
            throw new common_1.InternalServerErrorException('Postback payload is missing id');
        }
        const row = await this.prisma.scormRegistration.findUnique({
            where: { scormCloudRegistrationId: parsed.id },
        });
        if (!row) {
            throw new common_1.InternalServerErrorException('Unknown SCORM registration (dummy TestRegistrationPostback ids are expected to 5xx after auth)');
        }
        await this.applyProgressAndMaybeCertify(row, parsed, {
            throwIfCertifyIncomplete: true,
        });
    }
    async reconcileCron() {
        const ageSeconds = Number(this.config.get('SCORM_RECONCILE_AGE_SECONDS') ??
            DEFAULT_RECONCILE_AGE_SECONDS);
        const cutoff = new Date(Date.now() - ageSeconds * 1000);
        const candidates = await this.prisma.$queryRaw(client_1.Prisma.sql `
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
      `);
        if (candidates.length === 0) {
            return { candidates: 0, updated: 0 };
        }
        const rows = await this.prisma.scormRegistration.findMany({
            where: { id: { in: candidates.map((c) => c.id) } },
        });
        const byId = new Map(rows.map((row) => [row.id, row]));
        const results = await Promise.all(candidates.map(async ({ id }) => {
            try {
                const row = byId.get(id);
                if (!row)
                    return false;
                const progress = await this.cloud.getRegistrationProgress(row.scormCloudRegistrationId);
                const fresh = await this.prisma.scormRegistration.findUnique({
                    where: { id },
                });
                if (!fresh)
                    return false;
                await this.applyProgressAndMaybeCertify(fresh, progress, {
                    throwIfCertifyIncomplete: false,
                });
                return true;
            }
            catch (err) {
                this.logger.warn(`Reconcile failed for registration ${id}: ${(0, error_message_1.errorMessage)(err)}`);
                return false;
            }
        }));
        return {
            candidates: candidates.length,
            updated: results.filter(Boolean).length,
        };
    }
    async pruneSupersededPackagesCron() {
        const superseded = await this.prisma.scormPackage.findMany({
            where: {
                status: client_1.ScormPackageStatus.SUPERSEDED,
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
                if (!canPrune)
                    continue;
                const registrations = await this.prisma.scormRegistration.findMany({
                    where: { packageId: pkg.id },
                    select: { scormCloudRegistrationId: true },
                });
                for (const reg of registrations) {
                    await (0, scorm_cloud_compensate_1.compensateCloudRegistration)(this.cloud, reg.scormCloudRegistrationId, this.logger);
                }
                try {
                    await this.cloud.deleteCourse(pkg.scormCloudCourseId);
                }
                catch (err) {
                    this.logger.warn(`Failed SCORM Cloud DeleteCourse ${pkg.scormCloudCourseId}: ${(0, error_message_1.errorMessage)(err)}`);
                    continue;
                }
                await this.prisma.scormPackage.update({
                    where: { id: pkg.id },
                    data: { status: client_1.ScormPackageStatus.PRUNED },
                });
                pruned += 1;
            }
            catch (err) {
                this.logger.warn(`Prune check failed for package ${pkg.id}: ${(0, error_message_1.errorMessage)(err)}`);
            }
        }
        return { candidates: superseded.length, pruned };
    }
    async getLearnerProgress(userId, courseId) {
        if (!courseId) {
            throw new common_1.BadRequestException('courseId is required');
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
    async applyProgressAndMaybeCertify(current, payload, options) {
        const incomingCompletion = (0, scorm_status_1.mapRegistrationCompletion)(payload.registrationCompletion);
        const incomingSuccess = (0, scorm_status_1.mapRegistrationSuccess)(payload.registrationSuccess);
        const scoreScaled = typeof payload.score?.scaled === 'number' ? payload.score.scaled : null;
        const totalTimeSeconds = typeof payload.totalSecondsTracked === 'number'
            ? payload.totalSecondsTracked
            : null;
        const completionStatus = (0, scorm_status_1.pickMonotonic)(current.completionStatus, incomingCompletion, scorm_status_1.COMPLETION_RANK);
        const successStatus = (0, scorm_status_1.pickMonotonic)(current.successStatus, incomingSuccess, scorm_status_1.SUCCESS_RANK);
        await this.prisma.scormRegistration.update({
            where: { id: current.id },
            data: {
                completionStatus,
                successStatus,
                ...(scoreScaled != null ? { scoreScaled } : {}),
                ...(totalTimeSeconds != null
                    ? {
                        totalTimeSeconds: current.totalTimeSeconds != null
                            ? Math.max(totalTimeSeconds, current.totalTimeSeconds)
                            : totalTimeSeconds,
                    }
                    : {}),
                lastPostbackAt: new Date(),
            },
        });
        if (!(0, scorm_status_1.completeOnSatisfied)(current.completeOn, completionStatus, successStatus)) {
            return;
        }
        const outcome = await this.runCompletionBridge({ ...current, completionStatus, successStatus });
        if (outcome === 'skipped') {
            return;
        }
        if (outcome === 'done') {
            return;
        }
        if (options.throwIfCertifyIncomplete) {
            throw new common_1.InternalServerErrorException('SCORM snapshot saved but course certification is not complete yet');
        }
    }
    async runCompletionBridge(row) {
        const user = await this.prisma.user.findUnique({
            where: { id: row.userId },
            select: { id: true, role: true, deletedAt: true },
        });
        if (!user || user.deletedAt) {
            this.logger.warn(`Skipping SCORM certify for registration ${row.id}: user missing or deleted`);
            return 'skipped';
        }
        try {
            await (0, assert_enrollment_usable_1.assertEnrollmentUsable)(this.prisma, row.userId, row.courseId, client_1.Role.user);
        }
        catch (err) {
            if (err instanceof common_1.ForbiddenException) {
                this.logger.warn(`Skipping SCORM certify for registration ${row.id}: enrolment not usable (${(0, error_message_1.errorMessage)(err)})`);
                return 'skipped';
            }
            throw err;
        }
        const course = await this.prisma.course.findUnique({
            where: { id: row.courseId },
            select: { isActive: true },
        });
        if (!course?.isActive) {
            this.logger.warn(`Skipping SCORM certify for registration ${row.id}: course is not published`);
            return 'skipped';
        }
        const pkg = await this.prisma.scormPackage.findUnique({
            where: { id: row.packageId },
            select: { sectionId: true },
        });
        let sectionId = pkg?.sectionId ?? row.sectionId;
        if (!sectionId) {
            this.logger.warn(`Skipping SCORM certify for registration ${row.id}: package has no section`);
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
            this.logger.warn(`Skipping SCORM certify for registration ${row.id}: could not resolve a certify section`);
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
        await this.courseCompletion.checkContentCompletion(row.userId, row.courseId);
        let completion = await this.prisma.courseCompletion.findUnique({
            where: {
                userId_courseId: { userId: row.userId, courseId: row.courseId },
            },
            select: { courseCompletedAt: true, isPassed: true },
        });
        if (!completion?.courseCompletedAt) {
            return 'retry';
        }
        const certifyPassed = row.completeOn === 'passed'
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
        await (0, chapter_progression_1.recordChapterAndModuleCompletionIfNeeded)(this.prisma, row.userId, certifySection.chapterId, { courseId: row.courseId });
        const done = !!(completion?.courseCompletedAt && completion.isPassed);
        if (done) {
            await this.prisma.scormRegistration.update({
                where: { id: row.id },
                data: { completedAt: new Date() },
            });
        }
        return done ? 'done' : 'retry';
    }
    async resolveCertifySection(args) {
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
                type: client_1.SectionType.SCORM,
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
    async canPruneSupersededPackage(pkg) {
        if (!pkg.sectionId)
            return false;
        const inProgress = await this.prisma.scormRegistration.count({
            where: {
                packageId: pkg.id,
                completedAt: null,
                OR: [{ firstLaunchAt: { not: null } }, { lastPostbackAt: { not: null } }],
            },
        });
        if (inProgress > 0)
            return false;
        const versions = await this.prisma.courseVersion.findMany({
            where: { courseId: pkg.courseId, status: 'PUBLISHED' },
            select: { id: true, manifest: true },
        });
        for (const version of versions) {
            const manifest = version.manifest;
            const modules = manifest?.modules ?? [];
            const sectionIds = new Set();
            for (const mod of modules) {
                const chapters = mod.chapters ?? [];
                for (const chapter of chapters) {
                    const sections = chapter.sections ?? [];
                    for (const section of sections) {
                        if (typeof section.id === 'string')
                            sectionIds.add(section.id);
                    }
                }
            }
            if (!sectionIds.has(pkg.sectionId))
                continue;
            const pinned = await this.prisma.userCourse.count({
                where: { courseId: pkg.courseId, enrolledVersionId: version.id },
            });
            if (pinned > 0)
                return false;
        }
        return true;
    }
    async ensureCloudRegistration(args) {
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
        const publicApp = this.config.get('PUBLIC_APP_URL');
        const postUser = this.config.get('SCORM_POSTBACK_AUTH_USER');
        const postPass = this.config.get('SCORM_POSTBACK_AUTH_PASSWORD');
        if (!publicApp || !postUser || !postPass) {
            throw new common_1.InternalServerErrorException('SCORM postback URL or credentials are not configured');
        }
        const registrationId = (0, crypto_1.randomUUID)();
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
                    url: `${(0, strip_trailing_slash_1.stripTrailingSlash)(publicApp)}/api/v1/scorm/postback`,
                    authType: 'HTTPBASIC',
                    userName: postUser,
                    password: postPass,
                    resultsFormat: 'COURSE',
                },
            });
            cloudCreated = true;
        }
        catch (err) {
            if (err instanceof scorm_cloud_client_1.ScormCloudHttpError && err.cloudStatus === 409) {
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
                throw new common_1.InternalServerErrorException(`SCORM Cloud 409 creating registration ${registrationId} with no local row — refusing to persist an unverified id`);
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
        }
        catch (err) {
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002') {
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
                        await (0, scorm_cloud_compensate_1.compensateCloudRegistration)(this.cloud, registrationId, this.logger);
                    }
                    return raced;
                }
            }
            if (cloudCreated) {
                await (0, scorm_cloud_compensate_1.compensateCloudRegistration)(this.cloud, registrationId, this.logger);
            }
            throw err;
        }
    }
    async upsertLastSeen(args) {
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
    async resolvePinnedScormTarget(userId, courseId) {
        const course = await this.prisma.course.findUnique({
            where: { id: courseId },
            select: { id: true, isActive: true, deliveryMode: true },
        });
        if (!course)
            throw new common_1.NotFoundException('Course not found');
        if (course.deliveryMode !== client_1.CourseDeliveryMode.IMPORTED_SCORM) {
            throw new common_1.BadRequestException('Course is not an imported SCORM course');
        }
        const curriculum = await this.courseVersionService.resolveCurriculumTree(userId, courseId);
        let section = null;
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
        }
        else {
            section = await this.prisma.section.findFirst({
                where: {
                    type: client_1.SectionType.SCORM,
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
            throw new common_1.NotFoundException('No SCORM section on this curriculum');
        }
        if (!section.moduleId) {
            throw new common_1.InternalServerErrorException('SCORM section is missing moduleId');
        }
        const config = (0, scorm_status_1.parseScormSectionConfig)(section.config);
        if (!config) {
            throw new common_1.InternalServerErrorException('SCORM section is missing package config');
        }
        const pkg = await this.prisma.scormPackage.findUnique({
            where: { id: config.packageId },
        });
        if (!pkg) {
            throw new common_1.NotFoundException('SCORM package not found');
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
    parseProgressPayload(payload) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new common_1.InternalServerErrorException('Postback body must be JSON');
        }
        return payload;
    }
};
exports.ScormRuntimeService = ScormRuntimeService;
exports.ScormRuntimeService = ScormRuntimeService = ScormRuntimeService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        scorm_cloud_client_1.ScormCloudClient,
        course_version_service_1.CourseVersionService,
        course_completion_service_1.CourseCompletionService])
], ScormRuntimeService);
function findScormSection(tree) {
    for (const mod of tree.modules) {
        for (const chapter of mod.chapters) {
            for (const section of chapter.sections) {
                if (section.type === client_1.SectionType.SCORM)
                    return section;
            }
        }
    }
    return null;
}
//# sourceMappingURL=scorm-runtime.service.js.map