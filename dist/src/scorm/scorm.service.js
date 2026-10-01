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
exports.riseIndexSpaceWarning = exports.ScormService = exports.IMPORT_START_LOCK_SEED = exports.COURSE_TREE_LOCK_SEED = exports.TREE_LOCK_SEED = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const crypto_1 = require("crypto");
const course_version_service_1 = require("../course-version/course-version.service");
const prisma_service_1 = require("../prisma/prisma.service");
const scorm_cloud_client_1 = require("../scorm-cloud/scorm-cloud.client");
const error_message_1 = require("../utils/error-message");
const rise_probe_1 = require("../utils/rise-probe");
const scorm_publish_gate_1 = require("../utils/scorm-publish-gate");
const scorm_status_1 = require("./scorm-status");
exports.TREE_LOCK_SEED = 1;
exports.COURSE_TREE_LOCK_SEED = 2;
exports.IMPORT_START_LOCK_SEED = 3;
const IMPORT_CRON_BATCH = 8;
const STALE_PROCESSING_MS = 24 * 60 * 60 * 1000;
const STALE_PROCESSING_HARD_MS = 72 * 60 * 60 * 1000;
const STALE_UNSTARTED_MS = 10 * 60 * 1000;
const CLEANUP_DELETE_TIMEOUT_MS = 5000;
class TreeLockBusyError extends Error {
}
class PackageNotProcessingError extends Error {
}
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
        return this.startPackageImport(adminId, body, async (scormCloudCourseId) => this.cloud.createFetchAndImportCourseJob({
            courseId: scormCloudCourseId,
            url: contentUrl,
        }));
    }
    async createPackageFromUpload(adminId, file, body) {
        if (!file.length) {
            throw new common_1.BadRequestException('SCORM zip file is empty');
        }
        const filename = body.filename?.trim() || 'package.zip';
        return this.startPackageImport(adminId, body, async (scormCloudCourseId) => this.cloud.createUploadAndImportCourseJob({
            courseId: scormCloudCourseId,
            file,
            filename,
        }));
    }
    async startPackageImport(adminId, body, startCloudJob) {
        const createdCourseHere = !body.courseId;
        const course = body.courseId
            ? await this.prepareExistingCourse(body.courseId)
            : await this.createImportedCourse(body);
        const scormCloudCourseId = (0, crypto_1.randomUUID)();
        const title = (body.title?.trim() || course.title).trim();
        await this.pollStaleInFlightImport(course.id, adminId);
        let pkg;
        try {
            pkg = await this.prisma.$transaction(async (tx) => {
                const [{ locked }] = await tx.$queryRaw(client_1.Prisma.sql `SELECT pg_try_advisory_xact_lock(hashtextextended(${course.id}, ${exports.IMPORT_START_LOCK_SEED})) AS locked`);
                if (!locked) {
                    throw new common_1.ConflictException('An import is starting for this course. Wait a moment and retry.');
                }
                const inFlight = await tx.scormPackage.findFirst({
                    where: {
                        courseId: course.id,
                        status: client_1.ScormPackageStatus.PROCESSING,
                    },
                });
                if (inFlight &&
                    !(await this.failIfPastHardCap(inFlight, tx)) &&
                    (inFlight.cloudImportJobId ||
                        !(await this.failIfStale(inFlight, tx)))) {
                    throw new common_1.ConflictException('An import is already in progress for this course. Wait for it to finish (or fail) before starting another.');
                }
                if (!createdCourseHere) {
                    await tx.course.update({
                        where: { id: course.id },
                        data: {
                            deliveryMode: client_1.CourseDeliveryMode.IMPORTED_SCORM,
                            isActive: false,
                        },
                    });
                }
                const latest = await tx.scormPackage.findFirst({
                    where: { courseId: course.id },
                    orderBy: { versionNumber: 'desc' },
                    select: { versionNumber: true },
                });
                return tx.scormPackage.create({
                    data: {
                        courseId: course.id,
                        versionNumber: (latest?.versionNumber ?? 0) + 1,
                        title,
                        scormCloudCourseId,
                        zipSha256: body.zipSha256 ?? null,
                        completeOn: body.completeOn,
                        passingScore: body.passingScore ?? null,
                        status: client_1.ScormPackageStatus.PROCESSING,
                    },
                });
            }, { timeout: 10000 });
        }
        catch (err) {
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002') {
                throw new common_1.ConflictException('A concurrent package import created the same version number. Retry shortly.');
            }
            if (isTransactionTimeout(err)) {
                throw new common_1.ConflictException('An import is starting for this course. Wait a moment and retry.');
            }
            throw err;
        }
        let jobId;
        try {
            jobId = await startCloudJob(scormCloudCourseId);
        }
        catch (err) {
            const reason = cloudErrorMessage(err);
            const timedOut = err instanceof scorm_cloud_client_1.ScormCloudTimeoutError;
            await this.prisma.scormPackage.update({
                where: { id: pkg.id },
                data: {
                    status: client_1.ScormPackageStatus.FAILED,
                    failureReason: timedOut
                        ? `${reason} — SCORM Cloud may still create course ${scormCloudCourseId}; delete this course to clean it up`
                        : reason,
                },
            });
            if (timedOut) {
                await this.deleteCloudCourseAfterTimeout(scormCloudCourseId);
                throw err;
            }
            if (createdCourseHere) {
                try {
                    await this.prisma.scormPackage.delete({ where: { id: pkg.id } });
                    await this.prisma.course.delete({ where: { id: course.id } });
                }
                catch (cleanupErr) {
                    this.logger.warn(`Failed to roll back course ${course.id} after a rejected SCORM ` +
                        `import: ${(0, error_message_1.errorMessage)(cleanupErr)}`);
                }
            }
            throw err instanceof common_1.HttpException
                ? err
                : new common_1.HttpException(reason, common_1.HttpStatus.BAD_GATEWAY);
        }
        try {
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
            this.logger.error(`Package ${pkg.id}: Cloud import job ${jobId} started but recording it ` +
                `failed: ${(0, error_message_1.errorMessage)(err)}`);
            try {
                await this.prisma.scormPackage.updateMany({
                    where: { id: pkg.id, status: client_1.ScormPackageStatus.PROCESSING },
                    data: {
                        status: client_1.ScormPackageStatus.FAILED,
                        failureReason: `SCORM Cloud import job ${jobId} started but could not be recorded — SCORM Cloud course ${scormCloudCourseId} exists; delete this course to clean it up`,
                    },
                });
            }
            catch (markErr) {
                this.logger.warn(`Could not mark package ${pkg.id} FAILED: ${(0, error_message_1.errorMessage)(markErr)}`);
            }
            throw err;
        }
    }
    async pollStaleInFlightImport(courseId, adminId) {
        const inFlight = await this.prisma.scormPackage.findFirst({
            where: {
                courseId,
                status: client_1.ScormPackageStatus.PROCESSING,
                cloudImportJobId: { not: null },
                sectionId: null,
                createdAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) },
            },
        });
        if (!inFlight)
            return;
        try {
            await this.completeImportIfReady(inFlight.id, adminId);
        }
        catch (err) {
            this.logger.warn(`Could not poll stale in-flight package ${inFlight.id} before a ` +
                `re-import: ${(0, error_message_1.errorMessage)(err)}`);
        }
    }
    async deleteCloudCourseAfterTimeout(scormCloudCourseId) {
        try {
            await this.cloud.deleteCourse(scormCloudCourseId, {
                timeoutMs: CLEANUP_DELETE_TIMEOUT_MS,
            });
        }
        catch (err) {
            if (err instanceof scorm_cloud_client_1.ScormCloudHttpError && err.cloudStatus === 404) {
                return;
            }
            this.logger.warn(`Could not delete SCORM Cloud course ${scormCloudCourseId} after a ` +
                `timed-out import start: ${(0, error_message_1.errorMessage)(err)}`);
        }
    }
    async failIfStale(pkg, db = this.prisma) {
        const reason = staleProcessingReason(pkg, Date.now());
        if (!reason)
            return false;
        const { count } = await db.scormPackage.updateMany({
            where: {
                id: pkg.id,
                status: client_1.ScormPackageStatus.PROCESSING,
                sectionId: null,
            },
            data: { status: client_1.ScormPackageStatus.FAILED, failureReason: reason },
        });
        if (count > 0) {
            this.logger.warn(`Package ${pkg.id} marked FAILED: ${reason}`);
        }
        return count > 0;
    }
    async failIfPastHardCap(pkg, db = this.prisma) {
        if (pkg.status !== client_1.ScormPackageStatus.PROCESSING ||
            Date.now() - pkg.createdAt.getTime() < STALE_PROCESSING_HARD_MS) {
            return false;
        }
        const reason = 'SCORM import did not finish within 72h — re-import';
        const { count } = await db.scormPackage.updateMany({
            where: { id: pkg.id, status: client_1.ScormPackageStatus.PROCESSING },
            data: { status: client_1.ScormPackageStatus.FAILED, failureReason: reason },
        });
        if (count > 0) {
            this.logger.warn(`Package ${pkg.id} marked FAILED: ${reason}`);
        }
        return count > 0;
    }
    async failIfStaleAfterPoll(pkg) {
        return (await this.failIfStale(pkg)) ? this.reread(pkg) : pkg;
    }
    async failIfUnbuilt(pkg, data) {
        await this.prisma.scormPackage.updateMany({
            where: {
                id: pkg.id,
                status: client_1.ScormPackageStatus.PROCESSING,
                sectionId: null,
            },
            data,
        });
        return this.reread(pkg);
    }
    async reread(pkg) {
        return ((await this.prisma.scormPackage.findUnique({ where: { id: pkg.id } })) ??
            pkg);
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
    async processImportJobsCron(deadline) {
        const pending = await this.prisma.scormPackage.findMany({
            where: {
                status: client_1.ScormPackageStatus.PROCESSING,
                OR: [
                    { cloudImportJobId: { not: null } },
                    { createdAt: { lt: new Date(Date.now() - STALE_UNSTARTED_MS) } },
                ],
            },
            orderBy: { createdAt: 'asc' },
            take: IMPORT_CRON_BATCH,
        });
        const results = [];
        let deferred = 0;
        for (const pkg of pending) {
            if (deadline !== undefined && Date.now() >= deadline) {
                deferred += 1;
                continue;
            }
            try {
                const data = await this.completeImportIfReady(pkg.id, null);
                results.push({ id: pkg.id, status: String(data.status) });
            }
            catch (err) {
                this.logger.warn(`Import-job cron failed for package ${pkg.id}: ${(0, error_message_1.errorMessage)(err)}`);
                results.push({ id: pkg.id, status: 'error' });
            }
        }
        return { processed: results.length, deferred, results };
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
        if (pkg.status === client_1.ScormPackageStatus.READY && !pkg.sectionId) {
            this.logger.error(`Package ${pkg.id} is READY but sectionId is null — data invariant violated`);
            throw new common_1.InternalServerErrorException('SCORM package is READY but has no linked section');
        }
        if (pkg.status !== client_1.ScormPackageStatus.PROCESSING)
            return pkg;
        if (await this.failIfPastHardCap(pkg))
            return this.reread(pkg);
        if (pkg.sectionId && pkg.status === client_1.ScormPackageStatus.PROCESSING) {
            const storedProbe = pkg.riseProbeJson;
            return this.finishPublishAndReady(pkg.id, pkg.courseId, adminId, this.importWarningFor(pkg.completeOn, storedProbe));
        }
        if (!pkg.cloudImportJobId) {
            if (await this.failIfStale(pkg))
                return this.reread(pkg);
            this.logger.warn(`Package ${pkg.id} is PROCESSING without cloudImportJobId — cannot complete import`);
            return pkg;
        }
        let job;
        try {
            job = await this.cloud.getImportJobStatus(pkg.cloudImportJobId);
        }
        catch (err) {
            if (err instanceof scorm_cloud_client_1.ScormCloudTimeoutError) {
                this.logger.warn(`Import job status timed out for package ${pkg.id} — leaving PROCESSING`);
                return this.failIfStaleAfterPoll(pkg);
            }
            throw err;
        }
        if ((0, scorm_status_1.isImportJobRunning)(job.status) || !job.status) {
            return this.failIfStaleAfterPoll(pkg);
        }
        if ((0, scorm_status_1.isImportJobError)(job.status)) {
            await this.prisma.scormPackage.updateMany({
                where: { id: pkg.id, status: client_1.ScormPackageStatus.PROCESSING },
                data: {
                    status: client_1.ScormPackageStatus.FAILED,
                    failureReason: job.message || 'SCORM Cloud import job failed',
                },
            });
            return this.reread(pkg);
        }
        if (!(0, scorm_status_1.isImportJobComplete)(job.status)) {
            this.logger.warn(`Import job ${pkg.cloudImportJobId} has unrecognised status "${job.status}" — leaving PROCESSING`);
            return this.failIfStaleAfterPoll(pkg);
        }
        try {
            await this.cloud.setCourseConfiguration(pkg.scormCloudCourseId, scorm_cloud_client_1.SCORM_EMBEDDED_LAUNCH_SETTINGS);
        }
        catch (err) {
            const message = (0, error_message_1.errorMessage)(err);
            if (err instanceof scorm_cloud_client_1.ScormCloudTimeoutError) {
                this.logger.warn(`FRAMESET launch configuration timed out for package ${pkg.id} — leaving PROCESSING`);
                return pkg;
            }
            this.logger.error(`FRAMESET launch configuration failed for package ${pkg.id}: ${message}`);
            return this.failIfUnbuilt(pkg, {
                status: client_1.ScormPackageStatus.FAILED,
                failureReason: `SCORM Cloud launch configuration failed: ${message}`,
            });
        }
        let probe = null;
        try {
            const asset = await this.cloud.getCourseAsset(pkg.scormCloudCourseId, 'scormcontent/runtime-data.js');
            probe = (0, rise_probe_1.parseRiseRuntimeData)(asset);
        }
        catch (err) {
            const message = (0, error_message_1.errorMessage)(err);
            if (err instanceof scorm_cloud_client_1.ScormCloudTimeoutError) {
                this.logger.warn(`Rise probe timed out for package ${pkg.id} — leaving PROCESSING`);
                return pkg;
            }
            this.logger.warn(`Rise probe failed for package ${pkg.id}: ${message}`);
        }
        if (probe?.riseIndexSpaceRisk) {
            this.logger.warn(`Package ${pkg.id} has a lesson manifest where the suspendData index space is unverified ` +
                `(${probe.riseIndexSpaceRisk}) — confirm a learner's decoded lessons map to the right sections`);
        }
        const gate = this.policyGate(pkg.completeOn, probe);
        if (gate.refuse) {
            return this.failIfUnbuilt(pkg, {
                status: client_1.ScormPackageStatus.FAILED,
                failureReason: gate.reason,
                riseProbeJson: probe
                    ? probe
                    : undefined,
            });
        }
        if (gate.warn) {
            this.logger.warn(`Package ${pkg.id}: ${gate.warn}`);
        }
        const chapterTitle = (0, rise_probe_1.unescapeRiseTitle)(probe?.title || pkg.title);
        let treeBuilt = false;
        try {
            await this.prisma.$transaction(async (tx) => {
                const [{ locked }] = await tx.$queryRaw(client_1.Prisma.sql `SELECT pg_try_advisory_xact_lock(hashtextextended(${pkg.id}, ${exports.TREE_LOCK_SEED})) AS locked`);
                if (!locked) {
                    throw new TreeLockBusyError(`Another complete-import is already in progress for package ${pkg.id}`);
                }
                const [fresh] = await tx.$queryRaw(client_1.Prisma.sql `SELECT status, "sectionId" FROM "scorm_packages" WHERE id = ${pkg.id} FOR UPDATE`);
                if (!fresh)
                    return;
                if (fresh.status !== client_1.ScormPackageStatus.PROCESSING)
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
            if (err instanceof PackageNotProcessingError) {
                this.logger.warn(`Package ${pkg.id}: ${err.message} — tree rolled back`);
                return this.reread(pkg);
            }
            if (err instanceof TreeLockBusyError || isTransactionTimeout(err)) {
                this.logger.log(`Package ${pkg.id}: ${err.message} — leaving PROCESSING`);
                return pkg;
            }
            this.logger.error(`Synthetic tree failed for package ${pkg.id}: ${(0, error_message_1.errorMessage)(err)}`);
            return this.failIfUnbuilt(pkg, {
                status: client_1.ScormPackageStatus.FAILED,
                failureReason: (0, error_message_1.errorMessage)(err),
                riseProbeJson: probe
                    ? probe
                    : undefined,
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
        return this.finishPublishAndReady(pkg.id, pkg.courseId, adminId, this.importWarningFor(pkg.completeOn, probe));
    }
    importWarningFor(completeOn, probe) {
        return ([
            this.policyGate(completeOn, probe).warn,
            riseIndexSpaceWarning(probe?.riseIndexSpaceRisk ?? null),
        ]
            .filter(Boolean)
            .join(' | ') || null);
    }
    async finishPublishAndReady(packageId, courseId, adminId, importWarning) {
        const current = await this.prisma.scormPackage.findUnique({
            where: { id: packageId },
        });
        if (!current)
            throw new common_1.NotFoundException('SCORM package not found');
        if (current.status !== client_1.ScormPackageStatus.PROCESSING) {
            return current;
        }
        let published;
        try {
            published = await this.courseVersionService.publishNewVersion(adminId, courseId, 'Imported SCORM package');
        }
        catch (err) {
            if (err instanceof common_1.ConflictException) {
                this.logger.log(`Package ${packageId}: ${err.message} — leaving PROCESSING`);
                return current;
            }
            throw err;
        }
        const { count } = await this.prisma.scormPackage.updateMany({
            where: { id: packageId, status: client_1.ScormPackageStatus.PROCESSING },
            data: {
                status: client_1.ScormPackageStatus.READY,
                failureReason: null,
                importWarning,
            },
        });
        const after = await this.prisma.scormPackage.findUnique({
            where: { id: packageId },
        });
        if (!after)
            throw new common_1.NotFoundException('SCORM package not found');
        if (count === 0) {
            this.logger.error(`Package ${packageId} left PROCESSING (now ${after.status}) while a ` +
                `version was published for course ${courseId} — not marking READY; ` +
                `reconcile by hand`);
        }
        return { ...after, publishedVersion: published };
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
        const [{ locked: courseLocked }] = await tx.$queryRaw(client_1.Prisma.sql `SELECT pg_try_advisory_xact_lock(hashtextextended(${args.courseId}, ${exports.COURSE_TREE_LOCK_SEED})) AS locked`);
        if (!courseLocked) {
            throw new TreeLockBusyError(`Another SCORM tree write is in progress for course ${args.courseId}`);
        }
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
        const existing = await this.findScormTreeAnchor(tx, args, previousReady);
        let moduleId;
        let chapterId;
        if (existing) {
            ({ moduleId, chapterId } = existing);
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
        await tx.section.updateMany({
            where: {
                type: client_1.SectionType.SCORM,
                isArchived: false,
                chapter: { module: { courseId: args.courseId } },
            },
            data: { isArchived: true, archivedAt: new Date() },
        });
        if (previousReady) {
            await tx.scormPackage.update({
                where: { id: previousReady.id },
                data: { status: client_1.ScormPackageStatus.SUPERSEDED },
            });
        }
        const lessons = args.riseProbeJson?.lessons ?? [];
        const sectionSpecs = lessons.length > 0
            ? lessons.map((lesson) => ({
                title: lesson.title,
                orderIndex: lesson.index + 1,
                config: {
                    ...config,
                    scormLessonId: lesson.id,
                    scormLessonIndex: lesson.index,
                    scormLessonType: lesson.type,
                },
                lesson,
            }))
            : [
                {
                    title: args.chapterTitle,
                    orderIndex: 1,
                    config,
                    lesson: null,
                },
            ];
        const created = sectionSpecs.map((spec) => ({ id: (0, crypto_1.randomUUID)(), lesson: spec.lesson }));
        await tx.section.createMany({
            data: sectionSpecs.map((spec, i) => ({
                id: created[i].id,
                title: spec.title,
                description: '',
                chapterId,
                moduleId,
                type: client_1.SectionType.SCORM,
                orderIndex: spec.orderIndex,
                config: spec.config,
            })),
        });
        const lessonManifest = created
            .filter((row) => row.lesson !== null)
            .map((row) => ({
            index: row.lesson.index,
            id: row.lesson.id,
            title: row.lesson.title,
            type: row.lesson.type,
            sectionId: row.id,
        }));
        const { count } = await tx.scormPackage.updateMany({
            where: { id: args.packageId, status: client_1.ScormPackageStatus.PROCESSING },
            data: {
                sectionId: created[0].id,
                chapterId,
                lessons: lessonManifest.length > 0
                    ? lessonManifest
                    : client_1.Prisma.DbNull,
                lessonCount: lessonManifest.length > 0 ? lessonManifest.length : null,
                title: args.chapterTitle,
                riseProbeJson: args.riseProbeJson
                    ? args.riseProbeJson
                    : undefined,
            },
        });
        if (count === 0) {
            throw new PackageNotProcessingError(`Package ${args.packageId} is no longer PROCESSING`);
        }
    }
    async findScormTreeAnchor(tx, args, previousReady) {
        const withChapter = await tx.scormPackage.findFirst({
            where: {
                courseId: args.courseId,
                id: { not: args.packageId },
                status: { in: [client_1.ScormPackageStatus.READY, client_1.ScormPackageStatus.PRUNED] },
                chapterId: { not: null },
            },
            orderBy: { versionNumber: 'desc' },
            select: { chapterId: true },
        });
        if (withChapter?.chapterId) {
            const chapter = await tx.chapter.findFirst({
                where: {
                    id: withChapter.chapterId,
                    isArchived: false,
                    module: { courseId: args.courseId, isArchived: false },
                },
                select: { id: true, moduleId: true },
            });
            if (chapter)
                return { moduleId: chapter.moduleId, chapterId: chapter.id };
        }
        if (previousReady?.sectionId && !previousReady.chapterId) {
            const oldSection = await tx.section.findUnique({
                where: { id: previousReady.sectionId },
                select: { chapterId: true, moduleId: true },
            });
            if (!oldSection?.chapterId || !oldSection.moduleId) {
                throw new Error('Previous SCORM section is missing chapter/module');
            }
            return { moduleId: oldSection.moduleId, chapterId: oldSection.chapterId };
        }
        const live = await tx.section.findFirst({
            where: (0, scorm_publish_gate_1.scormGateCandidateSectionsWhere)(args.courseId),
            orderBy: { createdAt: 'desc' },
            select: { chapterId: true, chapter: { select: { moduleId: true } } },
        });
        return live
            ? { moduleId: live.chapter.moduleId, chapterId: live.chapterId }
            : null;
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
        return course;
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
function riseIndexSpaceWarning(risk) {
    return risk
        ? `Lesson index space is unverified for this package (${risk}) — ` +
            `learners report complete/incomplete only (no per-lesson %) until an admin ` +
            `checks a learner's decoded lessons map to the right sections and runs ` +
            `\`yarn script:backfill-scorm-lessons --verify-index-space=<packageId>\``
        : null;
}
exports.riseIndexSpaceWarning = riseIndexSpaceWarning;
function staleProcessingReason(pkg, now) {
    if (pkg.status !== client_1.ScormPackageStatus.PROCESSING || pkg.sectionId) {
        return null;
    }
    const age = now - pkg.createdAt.getTime();
    if (!pkg.cloudImportJobId) {
        return age >= STALE_UNSTARTED_MS
            ? 'SCORM import never started (no SCORM Cloud import job was recorded) — re-import'
            : null;
    }
    return age >= STALE_PROCESSING_MS
        ? 'SCORM Cloud import did not complete within 24h (SCORM Cloud repeatedly timed out) — re-import'
        : null;
}
function isTransactionTimeout(err) {
    return (err instanceof client_1.Prisma.PrismaClientKnownRequestError && err.code === 'P2028');
}
function cloudErrorMessage(err) {
    if (err instanceof scorm_cloud_client_1.ScormCloudHttpError) {
        return `SCORM Cloud HTTP ${err.cloudStatus}: ${err.cloudBody.slice(0, 300)}`;
    }
    return (0, error_message_1.errorMessage)(err);
}
//# sourceMappingURL=scorm.service.js.map