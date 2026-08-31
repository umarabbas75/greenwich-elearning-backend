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
const scorm_status_1 = require("./scorm-status");
const RECONCILE_BATCH = 20;
const DEFAULT_RECONCILE_AGE_SECONDS = 300;
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
        const resolved = await this.resolvePinnedScormTarget(user.id, body.courseId);
        if (body.packageId &&
            body.packageId !== resolved.package.id) {
            throw new common_1.ConflictException('packageId does not match the SCORM package on your pinned curriculum');
        }
        const isLearner = user.role === client_1.Role.user;
        if (isLearner) {
            await (0, assert_enrollment_usable_1.assertEnrollmentUsable)(this.prisma, user.id, body.courseId, client_1.Role.user);
            if (!resolved.courseIsActive) {
                throw new common_1.ForbiddenException('This course is not published yet');
            }
        }
        const pkgStatus = resolved.package.status;
        if (pkgStatus !== client_1.ScormPackageStatus.READY &&
            pkgStatus !== client_1.ScormPackageStatus.SUPERSEDED) {
            throw new common_1.ForbiddenException('This SCORM package is not ready to launch');
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
        const frontend = this.config.get('PUBLIC_FRONTEND_URL');
        if (!frontend) {
            throw new common_1.InternalServerErrorException('PUBLIC_FRONTEND_URL is not configured');
        }
        const launchLink = await this.cloud.buildRegistrationLaunchLink({
            registrationId: registration.scormCloudRegistrationId,
            redirectOnExitUrl: frontend.replace(/\/$/, ''),
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
        await this.applyProgressAndMaybeCertify(row.id, parsed, {
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
        let updated = 0;
        for (const { id } of candidates) {
            try {
                const row = await this.prisma.scormRegistration.findUnique({
                    where: { id },
                });
                if (!row)
                    continue;
                const progress = await this.cloud.getRegistrationProgress(row.scormCloudRegistrationId);
                await this.applyProgressAndMaybeCertify(row.id, progress, {
                    throwIfCertifyIncomplete: false,
                });
                updated += 1;
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.logger.warn(`Reconcile failed for registration ${id}: ${message}`);
            }
        }
        return { candidates: candidates.length, updated };
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
    async applyProgressAndMaybeCertify(registrationId, payload, options) {
        const incomingCompletion = (0, scorm_status_1.mapRegistrationCompletion)(payload.registrationCompletion);
        const incomingSuccess = (0, scorm_status_1.mapRegistrationSuccess)(payload.registrationSuccess);
        const scoreScaled = typeof payload.score?.scaled === 'number' ? payload.score.scaled : null;
        const totalTimeSeconds = typeof payload.totalSecondsTracked === 'number'
            ? payload.totalSecondsTracked
            : null;
        const current = await this.prisma.scormRegistration.findUnique({
            where: { id: registrationId },
        });
        if (!current) {
            throw new common_1.InternalServerErrorException('SCORM registration disappeared');
        }
        const completionStatus = (0, scorm_status_1.pickMonotonic)(current.completionStatus, incomingCompletion, scorm_status_1.COMPLETION_RANK);
        const successStatus = (0, scorm_status_1.pickMonotonic)(current.successStatus, incomingSuccess, scorm_status_1.SUCCESS_RANK);
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
        if (!(0, scorm_status_1.completeOnSatisfied)(current.completeOn, completionStatus, successStatus)) {
            return;
        }
        const certified = await this.runCompletionBridge(current);
        if (!certified && options.throwIfCertifyIncomplete) {
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
            return false;
        }
        try {
            await (0, assert_enrollment_usable_1.assertEnrollmentUsable)(this.prisma, row.userId, row.courseId, client_1.Role.user);
        }
        catch (err) {
            this.logger.warn(`Skipping SCORM certify for registration ${row.id}: enrolment not usable`);
            return false;
        }
        const section = await this.prisma.section.findUnique({
            where: { id: row.sectionId },
            select: { chapterId: true, moduleId: true },
        });
        if (!section?.chapterId || !section.moduleId) {
            this.logger.warn(`Skipping SCORM certify for registration ${row.id}: section missing module/chapter`);
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
        await this.courseCompletion.checkContentCompletion(row.userId, row.courseId);
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
        await (0, chapter_progression_1.recordChapterAndModuleCompletionIfNeeded)(this.prisma, row.userId, section.chapterId, { courseId: row.courseId });
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
                this.logger.warn(`SCORM Cloud 409 creating registration ${registrationId} with no local row`);
            }
            else {
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
                    try {
                        await this.cloud.deleteRegistration(registrationId);
                    }
                    catch (cleanupErr) {
                        const message = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
                        this.logger.warn(`Failed to compensate Cloud registration ${registrationId}: ${message}`);
                    }
                    return raced;
                }
            }
            try {
                await this.cloud.deleteRegistration(registrationId);
            }
            catch (cleanupErr) {
                const message = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
                this.logger.warn(`Failed to compensate Cloud registration ${registrationId}: ${message}`);
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