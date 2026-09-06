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
var ScormService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScormService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const crypto_1 = require("crypto");
const course_version_service_1 = require("../course-version/course-version.service");
const prisma_service_1 = require("../prisma/prisma.service");
const scorm_cloud_client_1 = require("../scorm-cloud/scorm-cloud.client");
const error_message_1 = require("../utils/error-message");
const rise_probe_1 = require("../utils/rise-probe");
const scorm_status_1 = require("./scorm-status");
const TREE_LOCK_SEED = 1;
const IMPORT_CRON_BATCH = 8;
const PLACEHOLDER_IMAGE = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';
let ScormService = ScormService_1 = class ScormService {
    constructor(prisma, cloud, courseVersionService) {
        this.prisma = prisma;
        this.cloud = cloud;
        this.courseVersionService = courseVersionService;
        this.logger = new common_1.Logger(ScormService_1.name);
    }
    async createPackage(adminId, body) {
        const contentUrl = body.contentUrl.trim();
        if (!contentUrl.startsWith('https://')) {
            throw new common_1.BadRequestException('contentUrl must be a durable public HTTPS URL (the zip never enters this API)');
        }
        const course = body.courseId
            ? await this.prepareExistingCourse(body.courseId)
            : await this.createImportedCourse(body);
        const inFlight = await this.prisma.scormPackage.findFirst({
            where: { courseId: course.id, status: client_1.ScormPackageStatus.PROCESSING },
        });
        if (inFlight) {
            throw new common_1.ConflictException('An import is already in progress for this course. Wait for it to finish (or fail) before starting another.');
        }
        const latest = await this.prisma.scormPackage.findFirst({
            where: { courseId: course.id },
            orderBy: { versionNumber: 'desc' },
            select: { versionNumber: true },
        });
        const versionNumber = (latest?.versionNumber ?? 0) + 1;
        const scormCloudCourseId = (0, crypto_1.randomUUID)();
        const title = (body.title?.trim() || course.title).trim();
        let pkg;
        try {
            pkg = await this.prisma.scormPackage.create({
                data: {
                    courseId: course.id,
                    versionNumber,
                    title,
                    scormCloudCourseId,
                    zipSha256: body.zipSha256 ?? null,
                    completeOn: body.completeOn,
                    passingScore: body.passingScore ?? null,
                    status: client_1.ScormPackageStatus.PROCESSING,
                },
            });
        }
        catch (err) {
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002') {
                throw new common_1.ConflictException('A concurrent package import created the same version number. Retry shortly.');
            }
            throw err;
        }
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
        }
        catch (err) {
            const reason = cloudErrorMessage(err);
            await this.prisma.scormPackage.update({
                where: { id: pkg.id },
                data: { status: client_1.ScormPackageStatus.FAILED, failureReason: reason },
            });
            throw err instanceof common_1.HttpException
                ? err
                : new common_1.HttpException(reason, common_1.HttpStatus.BAD_GATEWAY);
        }
    }
    async getPackage(id) {
        const pkg = await this.prisma.scormPackage.findUnique({ where: { id } });
        if (!pkg)
            throw new common_1.NotFoundException('SCORM package not found');
        return { message: 'ok', statusCode: 200, data: pkg };
    }
    async listPackages(courseId) {
        const packages = await this.prisma.scormPackage.findMany({
            where: { courseId },
            orderBy: { versionNumber: 'desc' },
        });
        return { message: 'ok', statusCode: 200, data: packages };
    }
    async getImportStatus(id, adminId) {
        const result = await this.completeImportIfReady(id, adminId ?? null);
        return { message: 'ok', statusCode: 200, data: result };
    }
    async processImportJobsCron() {
        const pending = await this.prisma.scormPackage.findMany({
            where: {
                status: client_1.ScormPackageStatus.PROCESSING,
                cloudImportJobId: { not: null },
            },
            orderBy: { createdAt: 'asc' },
            take: IMPORT_CRON_BATCH,
        });
        const results = await Promise.all(pending.map(async (pkg) => {
            try {
                const data = await this.completeImportIfReady(pkg.id, null);
                return { id: pkg.id, status: String(data.status) };
            }
            catch (err) {
                this.logger.warn(`Import-job cron failed for package ${pkg.id}: ${(0, error_message_1.errorMessage)(err)}`);
                return { id: pkg.id, status: 'error' };
            }
        }));
        return { processed: results.length, results };
    }
    async replacePreview(courseId) {
        const course = await this.prisma.course.findUnique({
            where: { id: courseId },
            select: { id: true, deliveryMode: true },
        });
        if (!course)
            throw new common_1.NotFoundException('Course not found');
        if (course.deliveryMode !== client_1.CourseDeliveryMode.IMPORTED_SCORM) {
            throw new common_1.BadRequestException('Course is not an imported SCORM course');
        }
        const current = await this.prisma.scormPackage.findFirst({
            where: { courseId, status: client_1.ScormPackageStatus.READY },
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
        const completedOnOldPackage = registrations.filter((row) => row.completeOn === 'passed'
            ? row.successStatus === 'passed'
            : row.completionStatus === 'completed').length;
        const latest = await this.courseVersionService.getLatestPublishedVersion(courseId);
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
    async completeImportIfReady(packageId, adminId) {
        const pkg = await this.prisma.scormPackage.findUnique({
            where: { id: packageId },
        });
        if (!pkg)
            throw new common_1.NotFoundException('SCORM package not found');
        if (pkg.status === client_1.ScormPackageStatus.FAILED)
            return pkg;
        if (pkg.status === client_1.ScormPackageStatus.SUPERSEDED)
            return pkg;
        if (pkg.status === client_1.ScormPackageStatus.READY && pkg.sectionId)
            return pkg;
        if (pkg.status === client_1.ScormPackageStatus.READY && !pkg.sectionId) {
            this.logger.error(`Package ${pkg.id} is READY but sectionId is null — data invariant violated`);
            throw new common_1.InternalServerErrorException('SCORM package is READY but has no linked section');
        }
        if (pkg.sectionId && pkg.status === client_1.ScormPackageStatus.PROCESSING) {
            return this.finishPublishAndReady(pkg.id, pkg.courseId, adminId);
        }
        if (!pkg.cloudImportJobId) {
            this.logger.warn(`Package ${pkg.id} is PROCESSING without cloudImportJobId — cannot complete import`);
            return pkg;
        }
        const job = await this.cloud.getImportJobStatus(pkg.cloudImportJobId);
        if ((0, scorm_status_1.isImportJobRunning)(job.status) || !job.status) {
            return pkg;
        }
        if ((0, scorm_status_1.isImportJobError)(job.status)) {
            return this.prisma.scormPackage.update({
                where: { id: pkg.id },
                data: {
                    status: client_1.ScormPackageStatus.FAILED,
                    failureReason: job.message || 'SCORM Cloud import job failed',
                },
            });
        }
        if (!(0, scorm_status_1.isImportJobComplete)(job.status)) {
            this.logger.warn(`Import job ${pkg.cloudImportJobId} has unrecognised status "${job.status}" — leaving PROCESSING`);
            return pkg;
        }
        try {
            await this.cloud.setCourseConfiguration(pkg.scormCloudCourseId, scorm_cloud_client_1.SCORM_EMBEDDED_LAUNCH_SETTINGS);
        }
        catch (err) {
            const message = (0, error_message_1.errorMessage)(err);
            this.logger.error(`FRAMESET launch configuration failed for package ${pkg.id}: ${message}`);
            return this.prisma.scormPackage.update({
                where: { id: pkg.id },
                data: {
                    status: client_1.ScormPackageStatus.FAILED,
                    failureReason: `SCORM Cloud launch configuration failed: ${message}`,
                },
            });
        }
        let probe = null;
        try {
            const asset = await this.cloud.getCourseAsset(pkg.scormCloudCourseId, 'scormcontent/runtime-data.js');
            probe = (0, rise_probe_1.parseRiseRuntimeData)(asset);
        }
        catch (err) {
            const message = (0, error_message_1.errorMessage)(err);
            this.logger.warn(`Rise probe failed for package ${pkg.id}: ${message}`);
        }
        const gate = this.policyGate(pkg.completeOn, probe);
        if (gate.refuse) {
            return this.prisma.scormPackage.update({
                where: { id: pkg.id },
                data: {
                    status: client_1.ScormPackageStatus.FAILED,
                    failureReason: gate.reason,
                    riseProbeJson: probe ? probe : undefined,
                },
            });
        }
        if (gate.warn) {
            this.logger.warn(`Package ${pkg.id}: ${gate.warn}`);
        }
        const chapterTitle = (0, rise_probe_1.unescapeRiseTitle)(probe?.title || pkg.title);
        let treeBuilt = false;
        try {
            await this.prisma.$transaction(async (tx) => {
                const [{ locked }] = await tx.$queryRaw(client_1.Prisma.sql `SELECT pg_try_advisory_xact_lock(hashtextextended(${pkg.id}, ${TREE_LOCK_SEED})) AS locked`);
                if (!locked) {
                    throw new common_1.ConflictException(`Another complete-import is already in progress for package ${pkg.id}`);
                }
                const fresh = await tx.scormPackage.findUnique({
                    where: { id: pkg.id },
                });
                if (!fresh)
                    return;
                if (fresh.sectionId)
                    return;
                await this.buildOrReplaceTree(tx, {
                    courseId: pkg.courseId,
                    packageId: pkg.id,
                    versionNumber: pkg.versionNumber,
                    chapterTitle,
                    completeOn: pkg.completeOn,
                    passingScore: pkg.passingScore ?? probe?.passingScore ?? null,
                    riseProbeJson: probe,
                });
                treeBuilt = true;
            }, { timeout: 20000 });
        }
        catch (err) {
            if (err instanceof common_1.ConflictException)
                throw err;
            this.logger.error(`Synthetic tree failed for package ${pkg.id}: ${(0, error_message_1.errorMessage)(err)}`);
            return this.prisma.scormPackage.update({
                where: { id: pkg.id },
                data: {
                    status: client_1.ScormPackageStatus.FAILED,
                    failureReason: (0, error_message_1.errorMessage)(err),
                    riseProbeJson: probe ? probe : undefined,
                },
            });
        }
        const after = await this.prisma.scormPackage.findUnique({
            where: { id: pkg.id },
        });
        if (!after)
            throw new common_1.NotFoundException('SCORM package not found');
        if (after.status === client_1.ScormPackageStatus.READY)
            return after;
        if (!after.sectionId)
            return after;
        if (!treeBuilt) {
            return after;
        }
        return this.finishPublishAndReady(pkg.id, pkg.courseId, adminId, gate.warn ?? null);
    }
    async finishPublishAndReady(packageId, courseId, adminId, importWarning = null) {
        const current = await this.prisma.scormPackage.findUnique({
            where: { id: packageId },
        });
        if (current?.status === client_1.ScormPackageStatus.READY) {
            return current;
        }
        const published = await this.courseVersionService.publishNewVersion(adminId, courseId, 'Imported SCORM package');
        return this.prisma.scormPackage.update({
            where: { id: packageId },
            data: {
                status: client_1.ScormPackageStatus.READY,
                failureReason: null,
                importWarning,
            },
        }).then((pkg) => ({ ...pkg, publishedVersion: published }));
    }
    policyGate(completeOn, probe) {
        const quizItemCount = probe?.quizItemCount ?? 0;
        const reporting = probe?.reporting ?? null;
        if (completeOn === 'passed') {
            if (!probe) {
                return {
                    refuse: true,
                    reason: 'completeOn is "passed" but the Rise probe could not run, so quiz/reporting cannot be verified',
                };
            }
            if (quizItemCount === 0) {
                return {
                    refuse: true,
                    reason: 'completeOn is "passed" but this package has no scoreable quiz items',
                };
            }
            if (!reporting || !reporting.startsWith('passed-')) {
                return {
                    refuse: true,
                    reason: `completeOn is "passed" but Rise reporting is "${reporting ?? 'unknown'}" (expected passed-*)`,
                };
            }
        }
        if (completeOn === 'completed' && !probe) {
            return {
                refuse: false,
                warn: 'Rise probe unavailable; completion gate could not be verified (non-Rise packages may still import with completeOn "completed")',
            };
        }
        if (completeOn === 'completed' && quizItemCount === 0) {
            return {
                refuse: false,
                warn: 'Package has no quiz items; completeOn "completed" will fire when the SCO reports completed',
            };
        }
        return { refuse: false };
    }
    async buildOrReplaceTree(tx, args) {
        const config = {
            packageId: args.packageId,
            completeOn: args.completeOn,
            ...(args.passingScore != null ? { passingScore: args.passingScore } : {}),
        };
        const previousReady = await tx.scormPackage.findFirst({
            where: {
                courseId: args.courseId,
                status: client_1.ScormPackageStatus.READY,
                id: { not: args.packageId },
            },
            orderBy: { versionNumber: 'desc' },
        });
        let moduleId;
        let chapterId;
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
                data: { status: client_1.ScormPackageStatus.SUPERSEDED },
            });
        }
        else {
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
                type: client_1.SectionType.SCORM,
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
                    ? args.riseProbeJson
                    : undefined,
            },
        });
    }
    async prepareExistingCourse(courseId) {
        const course = await this.prisma.course.findUnique({
            where: { id: courseId },
        });
        if (!course)
            throw new common_1.NotFoundException('Course not found');
        if (course.deliveryMode === client_1.CourseDeliveryMode.NATIVE) {
            const liveModules = await this.prisma.module.count({
                where: { courseId, isArchived: false },
            });
            if (liveModules > 0) {
                throw new common_1.BadRequestException('Cannot import SCORM over a native course that already has modules');
            }
        }
        return this.prisma.course.update({
            where: { id: courseId },
            data: {
                deliveryMode: client_1.CourseDeliveryMode.IMPORTED_SCORM,
                isActive: false,
            },
        });
    }
    async createImportedCourse(body) {
        const title = body.title?.trim();
        if (!title) {
            throw new common_1.BadRequestException('title is required when creating a course with the package');
        }
        const existing = await this.prisma.course.findUnique({
            where: { title },
        });
        if (existing) {
            throw new common_1.ConflictException('Course already exists with that title');
        }
        try {
            return await this.prisma.course.create({
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
                    deliveryMode: client_1.CourseDeliveryMode.IMPORTED_SCORM,
                    isActive: false,
                },
            });
        }
        catch (err) {
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002') {
                throw new common_1.ConflictException('Course already exists with that title');
            }
            throw err;
        }
    }
};
exports.ScormService = ScormService;
exports.ScormService = ScormService = ScormService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        scorm_cloud_client_1.ScormCloudClient,
        course_version_service_1.CourseVersionService])
], ScormService);
function cloudErrorMessage(err) {
    if (err instanceof scorm_cloud_client_1.ScormCloudHttpError) {
        return `SCORM Cloud HTTP ${err.cloudStatus}: ${err.cloudBody.slice(0, 300)}`;
    }
    return (0, error_message_1.errorMessage)(err);
}
//# sourceMappingURL=scorm.service.js.map