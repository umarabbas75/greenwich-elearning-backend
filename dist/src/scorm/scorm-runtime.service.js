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
const rise_progress_1 = require("../utils/rise-progress");
const scorm_runtime_extract_1 = require("../utils/scorm-runtime-extract");
const chapter_progression_1 = require("../utils/chapter-progression");
const error_message_1 = require("../utils/error-message");
const scorm_cloud_compensate_1 = require("../utils/scorm-cloud-compensate");
const scorm_player_url_1 = require("../utils/scorm-player-url");
const strip_trailing_slash_1 = require("../utils/strip-trailing-slash");
const scorm_status_1 = require("./scorm-status");
const RECONCILE_BATCH = 20;
const DEFAULT_RECONCILE_AGE_SECONDS = 300;
const PRUNE_SUPERSEDED_BATCH = 10;
const DEFAULT_RUNTIME_PULL_MIN_INTERVAL_MS = 60000;
const TERMINAL_RUNTIME_PULL_MIN_INTERVAL_MS = 10000;
const SESSION_END_RUNTIME_PULL_MIN_INTERVAL_MS = 1000;
const RECONCILE_DIRTY_BATCH = 10;
const RECONCILE_DIRTY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const RECONCILE_CONCURRENCY = 5;
const RECONCILE_DEADLINE_MS = 30000;
const READ_PULL_BUDGET_MS = 2500;
const UNDECODABLE_WARN_CACHE = 500;
const CORROBORATED_CPV_KEY = 'riseCpvCorroborated';
const SCALAR_WRITE_ATTEMPTS = 5;
let ScormRuntimeService = ScormRuntimeService_1 = class ScormRuntimeService {
    constructor(prisma, config, cloud, courseVersionService, courseCompletion) {
        this.prisma = prisma;
        this.config = config;
        this.cloud = cloud;
        this.courseVersionService = courseVersionService;
        this.courseCompletion = courseCompletion;
        this.logger = new common_1.Logger(ScormRuntimeService_1.name);
        this.undecodableSeen = new Set();
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
        if (body.packageId && body.packageId !== resolved.package.id) {
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
        const repairStalePointer = await this.lastSeenPointerIsStale(user.id, resolved.chapterId);
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
                repairStalePointer,
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
        const receivedAt = new Date();
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
        const { payload: pulled, issuedAt } = await this.pullRuntimeDetail(row, parsed);
        const current = pulled === parsed
            ? row
            : (await this.prisma.scormRegistration.findUnique({
                where: { id: row.id },
            })) ?? row;
        const enriched = pulled === parsed
            ? parsed
            : {
                ...pulled,
                score: higherScore(pulled.score, parsed.score),
                totalSecondsTracked: pulled.totalSecondsTracked ?? parsed.totalSecondsTracked,
                registrationCompletion: higherRanked(pulled.registrationCompletion, parsed.registrationCompletion, scorm_status_1.mapRegistrationCompletion, scorm_status_1.COMPLETION_RANK),
                registrationSuccess: higherRanked(pulled.registrationSuccess, parsed.registrationSuccess, scorm_status_1.mapRegistrationSuccess, scorm_status_1.SUCCESS_RANK),
            };
        await this.applyProgressAndMaybeCertify(current, enriched, {
            throwIfCertifyIncomplete: true,
            postbackReceivedAt: receivedAt,
            snapshotAt: issuedAt ?? receivedAt,
            fullPull: issuedAt != null,
        });
    }
    async pullRuntimeDetail(row, payload) {
        const skipped = { payload, issuedAt: null };
        if ((0, scorm_runtime_extract_1.extractRuntime)(payload)?.runtime)
            return skipped;
        const floorMs = this.runtimePullFloorMs();
        const sincePull = row.lastRuntimePullAt
            ? Date.now() - row.lastRuntimePullAt.getTime()
            : Number.POSITIVE_INFINITY;
        const sessionEnded = row.suspended !== true && (0, scorm_runtime_extract_1.extractRuntime)(payload)?.suspended === true;
        let effectiveFloorMs = floorMs;
        if (sessionEnded) {
            effectiveFloorMs = SESSION_END_RUNTIME_PULL_MIN_INTERVAL_MS;
        }
        else if (sincePull >= TERMINAL_RUNTIME_PULL_MIN_INTERVAL_MS &&
            sincePull < floorMs &&
            (await this.isTerminalPostback(row, payload))) {
            effectiveFloorMs = Math.min(floorMs, TERMINAL_RUNTIME_PULL_MIN_INTERVAL_MS);
        }
        if (sincePull < effectiveFloorMs)
            return skipped;
        let issuedAt = null;
        try {
            issuedAt = await this.claimRuntimePull(row.id, effectiveFloorMs);
            if (!issuedAt)
                return skipped;
            const full = await this.cloud.getRegistrationProgress(row.scormCloudRegistrationId, 'full');
            if (!full || typeof full !== 'object' || Array.isArray(full)) {
                this.logger.warn(`Runtime pull for registration ${row.id} returned no usable body; falling back to the postback snapshot`);
                return skipped;
            }
            return { payload: full, issuedAt };
        }
        catch (err) {
            if (issuedAt)
                await this.markRuntimeGoneIf404(row.id, issuedAt, err);
            this.logger.warn(`Runtime pull failed for registration ${row.id}; falling back to the postback snapshot: ${(0, error_message_1.errorMessage)(err)}`);
            return skipped;
        }
    }
    async isTerminalPostback(row, payload) {
        if (row.completedAt != null)
            return false;
        if (!(0, scorm_status_1.completeOnSatisfied)(row.completeOn, (0, scorm_status_1.mapRegistrationCompletion)(payload.registrationCompletion), (0, scorm_status_1.mapRegistrationSuccess)(payload.registrationSuccess))) {
            return false;
        }
        return this.canRecordProgress(row, 'terminal pull floor');
    }
    async markRuntimeGoneIf404(registrationId, issuedAt, err) {
        if (!(err instanceof scorm_cloud_client_1.ScormCloudHttpError) || err.cloudStatus !== 404) {
            return;
        }
        this.logger.warn(`Cloud has no registration for ${registrationId} (404); marking its runtime as pulled so reads and reconcile stop retrying it`);
        try {
            await this.prisma.scormRegistration.updateMany({
                where: {
                    id: registrationId,
                    OR: [
                        { lastRuntimeAppliedAt: null },
                        { lastRuntimeAppliedAt: { lt: issuedAt } },
                    ],
                },
                data: { lastRuntimeAppliedAt: issuedAt },
            });
        }
        catch (stampErr) {
            this.logger.warn(`Could not mark registration ${registrationId} as gone: ${(0, error_message_1.errorMessage)(stampErr)}`);
        }
    }
    runtimePullFloorMs() {
        const configured = Number(this.config.get('SCORM_RUNTIME_PULL_MIN_INTERVAL_MS'));
        return Number.isFinite(configured) && configured > 0
            ? configured
            : DEFAULT_RUNTIME_PULL_MIN_INTERVAL_MS;
    }
    async claimRuntimePull(registrationId, floorMs) {
        const now = new Date();
        const { count } = await this.prisma.scormRegistration.updateMany({
            where: {
                id: registrationId,
                OR: [
                    { lastRuntimePullAt: null },
                    { lastRuntimePullAt: { lt: new Date(now.getTime() - floorMs) } },
                ],
            },
            data: { lastRuntimePullAt: now },
        });
        return count === 1 ? now : null;
    }
    async refreshIfDirty(row) {
        if (!isRuntimeDirty(row))
            return false;
        let issuedAt;
        try {
            const status = row.packageStatus !== undefined
                ? row.packageStatus
                : (await this.prisma.scormPackage.findUnique({
                    where: { id: row.packageId },
                    select: { status: true },
                }))?.status;
            if (status === client_1.ScormPackageStatus.PRUNED)
                return false;
            issuedAt = await this.claimRuntimePull(row.id, this.runtimePullFloorMs());
            if (!issuedAt)
                return false;
        }
        catch (err) {
            this.logger.warn(`Pull-on-read claim failed for registration ${row.id}: ${(0, error_message_1.errorMessage)(err)}`);
            return false;
        }
        const claimedAt = issuedAt;
        const work = (async () => {
            let progress;
            try {
                progress = await this.cloud.getRegistrationProgress(row.scormCloudRegistrationId, 'full');
            }
            catch (err) {
                await this.markRuntimeGoneIf404(row.id, claimedAt, err);
                throw err;
            }
            if (!progress ||
                typeof progress !== 'object' ||
                Array.isArray(progress)) {
                return false;
            }
            const fresh = await this.prisma.scormRegistration.findUnique({
                where: { id: row.id },
            });
            if (!fresh)
                return false;
            await this.applyProgressAndMaybeCertify(fresh, progress, {
                throwIfCertifyIncomplete: false,
                snapshotAt: claimedAt,
                fullPull: true,
            });
            return true;
        })().catch((err) => {
            this.logger.warn(`Pull-on-read failed for registration ${row.id}: ${(0, error_message_1.errorMessage)(err)}`);
            return false;
        });
        let timer;
        const budget = new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), READ_PULL_BUDGET_MS);
            timer.unref?.();
        });
        try {
            return await Promise.race([work, budget]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    async reconcileCron(invocationDeadline) {
        const startedAt = Date.now();
        const ageSeconds = Number(this.config.get('SCORM_RECONCILE_AGE_SECONDS') ??
            DEFAULT_RECONCILE_AGE_SECONDS);
        const cutoff = new Date(startedAt - ageSeconds * 1000);
        const dirtySince = new Date(startedAt - RECONCILE_DIRTY_WINDOW_MS);
        const dirty = await this.prisma.$queryRaw(client_1.Prisma.sql `
        SELECT sr.id
          FROM "scorm_registrations" sr
          JOIN "scorm_packages" sp ON sp.id = sr."packageId"
         WHERE sr."lastPostbackAt" IS NOT NULL
           AND sr."lastPostbackAt" < ${cutoff}
           AND sr."lastPostbackAt" >= ${dirtySince}
           AND sp."status" <> 'PRUNED'
           AND (
             sr."lastRuntimeAppliedAt" IS NULL
             OR sr."lastPostbackAt" > sr."lastRuntimeAppliedAt"
           )
         ORDER BY sr."lastPostbackAt" DESC
         LIMIT ${RECONCILE_DIRTY_BATCH}
      `);
        const sweep = await this.prisma.$queryRaw(client_1.Prisma.sql `
        SELECT sr.id
          FROM "scorm_registrations" sr
          JOIN "scorm_packages" sp ON sp.id = sr."packageId"
          LEFT JOIN "course_completions" cc
            ON cc."userId" = sr."userId" AND cc."courseId" = sr."courseId"
         WHERE COALESCE(sr."lastPostbackAt", sr."firstLaunchAt", sr."createdAt") < ${cutoff}
           AND sp."status" <> 'PRUNED'
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
         ORDER BY sr."lastRuntimePullAt" ASC NULLS FIRST,
                  COALESCE(sr."lastPostbackAt", sr."firstLaunchAt", sr."createdAt") ASC
         LIMIT ${RECONCILE_BATCH}
      `);
        const candidates = Array.from(new Set([...(dirty ?? []), ...(sweep ?? [])].map((c) => c.id))).map((id) => ({ id }));
        if (candidates.length === 0) {
            return { candidates: 0, updated: 0, deferred: 0 };
        }
        const rows = await this.prisma.scormRegistration.findMany({
            where: { id: { in: candidates.map((c) => c.id) } },
        });
        const byId = new Map(rows.map((row) => [row.id, row]));
        const deadline = Math.min(startedAt + RECONCILE_DEADLINE_MS, invocationDeadline ?? Infinity);
        const results = await mapWithConcurrency(candidates, RECONCILE_CONCURRENCY, async ({ id }) => {
            if (Date.now() >= deadline)
                return 'deferred';
            let issuedAt = null;
            try {
                const row = byId.get(id);
                if (!row)
                    return false;
                issuedAt = await this.claimRuntimePull(id, this.runtimePullFloorMs());
                if (!issuedAt)
                    return false;
                const progress = await this.cloud.getRegistrationProgress(row.scormCloudRegistrationId, 'full');
                if (!progress || typeof progress !== 'object')
                    return false;
                const fresh = await this.prisma.scormRegistration.findUnique({
                    where: { id },
                });
                if (!fresh)
                    return false;
                await this.applyProgressAndMaybeCertify(fresh, progress, {
                    throwIfCertifyIncomplete: false,
                    snapshotAt: issuedAt,
                    fullPull: true,
                });
                return true;
            }
            catch (err) {
                if (issuedAt)
                    await this.markRuntimeGoneIf404(id, issuedAt, err);
                this.logger.warn(`Reconcile failed for registration ${id}: ${(0, error_message_1.errorMessage)(err)}`);
                return false;
            }
        });
        return {
            candidates: candidates.length,
            updated: results.filter((r) => r === true).length,
            deferred: results.filter((r) => r === 'deferred').length,
        };
    }
    async pruneSupersededPackagesCron(deadline) {
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
                lessons: true,
                chapterId: true,
            },
        });
        let pruned = 0;
        let deferred = 0;
        for (const pkg of superseded) {
            if (deadline !== undefined && Date.now() >= deadline) {
                deferred += 1;
                continue;
            }
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
        return { candidates: superseded.length, pruned, deferred };
    }
    async getLearnerProgress(userId, courseId) {
        if (!courseId) {
            throw new common_1.BadRequestException('courseId is required');
        }
        const select = {
            id: true,
            packageId: true,
            completionStatus: true,
            successStatus: true,
            scoreScaled: true,
            totalTimeSeconds: true,
            firstLaunchAt: true,
            lastPostbackAt: true,
            completedAt: true,
            lessonsCompleted: true,
            lessonsCompletedAtCertify: true,
            progressSource: true,
            lessonId: true,
            lessonIndex: true,
            lessonTitle: true,
            attempts: true,
            suspended: true,
            firstAccessAt: true,
            lastAccessAt: true,
            scormCloudRegistrationId: true,
            lastRuntimeAppliedAt: true,
        };
        let found = await this.prisma.scormRegistration.findFirst({
            where: { userId, courseId },
            orderBy: { createdAt: 'desc' },
            select,
        });
        if (!found)
            return { message: 'ok', statusCode: 200, data: null };
        const pkg = await this.prisma.scormPackage.findUnique({
            where: { id: found.packageId },
            select: { lessonCount: true, status: true },
        });
        if (await this.refreshIfDirty({
            ...found,
            packageStatus: pkg?.status ?? null,
        })) {
            found =
                (await this.prisma.scormRegistration.findUnique({
                    where: { id: found.id },
                    select,
                })) ?? found;
        }
        const row = {
            ...found,
        };
        delete row.scormCloudRegistrationId;
        delete row.lastRuntimeAppliedAt;
        const lessonsTotal = pkg?.lessonCount ?? null;
        const certified = row.completedAt != null && lessonsTotal != null;
        return {
            message: 'ok',
            statusCode: 200,
            data: {
                ...row,
                lessonsCompleted: certified ? lessonsTotal : row.lessonsCompleted,
                lessonsCompletedDecoded: row.lessonsCompleted ?? null,
                lessonsTotal,
            },
        };
    }
    async applyProgressAndMaybeCertify(current, payload, options) {
        const snapshotAt = options.snapshotAt ?? new Date();
        let lessonUpdate = {};
        let lessonsFailed = false;
        try {
            lessonUpdate = await this.applyLessonProgress(current, payload, isSnapshotFresh(current, snapshotAt));
        }
        catch (err) {
            this.logger.warn(`Lesson progress failed for registration ${current.id}; keeping the Cloud snapshot: ${(0, error_message_1.errorMessage)(err)}`);
            lessonsFailed = true;
        }
        const markApplied = !lessonsFailed &&
            (options.fullPull || !!(0, scorm_runtime_extract_1.extractRuntime)(payload)?.runtime);
        const { completionStatus, successStatus } = await this.writeScalars(current, payload, lessonUpdate, {
            snapshotAt,
            postbackReceivedAt: options.postbackReceivedAt,
            markApplied,
        });
        if (!(0, scorm_status_1.completeOnSatisfied)(current.completeOn, completionStatus, successStatus)) {
            return;
        }
        if (current.completedAt != null && (await this.isStillCertified(current))) {
            return;
        }
        const outcome = await this.runCompletionBridge({
            ...current,
            completionStatus,
            successStatus,
        });
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
    async writeScalars(current, payload, snapshotFields, timing) {
        const incomingCompletion = (0, scorm_status_1.mapRegistrationCompletion)(payload.registrationCompletion);
        const incomingSuccess = (0, scorm_status_1.mapRegistrationSuccess)(payload.registrationSuccess);
        const scoreScaled = typeof payload.score?.scaled === 'number' ? payload.score.scaled : null;
        const totalTimeSeconds = typeof payload.totalSecondsTracked === 'number'
            ? payload.totalSecondsTracked
            : null;
        const firstAccess = toDate(payload.firstAccessDate);
        const lastAccess = toDate(payload.lastAccessDate);
        let row = current;
        for (let attempt = 1;; attempt += 1) {
            const completionStatus = (0, scorm_status_1.pickMonotonic)(row.completionStatus, incomingCompletion, scorm_status_1.COMPLETION_RANK);
            const successStatus = (0, scorm_status_1.pickMonotonic)(row.successStatus, incomingSuccess, scorm_status_1.SUCCESS_RANK);
            const fresh = isSnapshotFresh(row, timing.snapshotAt);
            const data = {
                completionStatus,
                successStatus,
                ...(totalTimeSeconds != null
                    ? {
                        totalTimeSeconds: Math.max(totalTimeSeconds, row.totalTimeSeconds ?? totalTimeSeconds),
                    }
                    : {}),
                ...(firstAccess &&
                    (!row.firstAccessAt || firstAccess < row.firstAccessAt)
                    ? { firstAccessAt: firstAccess }
                    : {}),
                ...(lastAccess && (!row.lastAccessAt || lastAccess > row.lastAccessAt)
                    ? { lastAccessAt: lastAccess }
                    : {}),
                ...(fresh
                    ? {
                        ...(scoreScaled != null ? { scoreScaled } : {}),
                        ...snapshotFields,
                        ...(snapshotFields.metadata !== undefined
                            ? {
                                metadata: {
                                    ...jsonObject(row.metadata),
                                    ...jsonObject(snapshotFields.metadata),
                                },
                            }
                            : {}),
                    }
                    : {}),
                ...(timing.postbackReceivedAt
                    ? {
                        lastPostbackAt: maxDate(row.lastPostbackAt, timing.postbackReceivedAt),
                    }
                    : {}),
                ...(timing.markApplied
                    ? {
                        lastRuntimeAppliedAt: maxDate(row.lastRuntimeAppliedAt, timing.snapshotAt),
                    }
                    : {}),
            };
            try {
                await this.prisma.scormRegistration.update({
                    where: { id: current.id, updatedAt: row.updatedAt },
                    data,
                });
                return { completionStatus, successStatus };
            }
            catch (err) {
                const conflict = err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                    err.code === 'P2025';
                if (!conflict || attempt >= SCALAR_WRITE_ATTEMPTS)
                    throw err;
                const reread = await this.prisma.scormRegistration.findUnique({
                    where: { id: current.id },
                });
                if (!reread)
                    throw err;
                row = reread;
            }
        }
    }
    async isStillCertified(row) {
        const completion = await this.prisma.courseCompletion.findUnique({
            where: {
                userId_courseId: { userId: row.userId, courseId: row.courseId },
            },
            select: { courseCompletedAt: true, isPassed: true },
        });
        return !!(completion?.courseCompletedAt && completion.isPassed);
    }
    async applyLessonProgress(current, payload, fresh = true) {
        const extracted = (0, scorm_runtime_extract_1.extractRuntime)(payload);
        if (!extracted)
            return {};
        const update = {};
        if (extracted.attempts != null)
            update.attempts = extracted.attempts;
        if (extracted.suspended != null)
            update.suspended = extracted.suspended;
        if (extracted.completionAmount != null) {
            update.completionAmount = extracted.completionAmount;
        }
        if (!extracted.runtime)
            return update;
        const metadata = buildRegistrationMetadata(payload);
        update.metadata = metadata;
        if (typeof extracted.runtime.location === 'string') {
            update.locationRaw = extracted.runtime.location;
        }
        const pkg = await this.prisma.scormPackage.findUnique({
            where: { id: current.packageId },
            select: { id: true, lessons: true, riseCpv: true, riseProbeJson: true },
        });
        const lessons = parsePackageLessons(pkg?.lessons);
        if (lessons.length === 0) {
            update.progressSource = 'binary';
            return clearLessonLabel(update, current);
        }
        const decoded = (0, rise_progress_1.parseRiseSuspendData)(extracted.runtime.suspendData);
        let canRecordCache = null;
        const canRecord = async () => {
            if (canRecordCache === null) {
                canRecordCache = await this.canRecordProgress(current);
            }
            return canRecordCache;
        };
        if (decoded?.cpv && pkg?.riseCpv && decoded.cpv !== pkg.riseCpv) {
            this.logger.warn(`Registration ${current.id}: suspendData cpv ${decoded.cpv} does not match package ${pkg.id} cpv ${pkg.riseCpv} — skipping lesson progress`);
            update.progressSource = 'binary';
            return clearLessonLabel(update, current);
        }
        const bookmark = (0, rise_progress_1.resolveRiseLesson)(extracted.runtime.location, lessons);
        if (bookmark) {
            update.lessonId = bookmark.lessonId;
            update.lessonIndex = bookmark.lessonIndex + 1;
            update.lessonTitle = bookmark.lessonTitle;
            const bookmarkLesson = lessons.find((l) => l.index === bookmark.lessonIndex);
            if (fresh &&
                bookmark.lessonId !== current.lessonId &&
                bookmarkLesson?.sectionId &&
                (await canRecord())) {
                await this.updateLastSeenLesson(current, bookmarkLesson.sectionId);
            }
        }
        if (!decoded) {
            this.warnUndecodableSuspendData(current.id, extracted.runtime.suspendData);
            update.progressSource = 'binary';
            return bookmark
                ? keepSourceIfDecoded(update, current)
                : clearLessonLabel(update, current);
        }
        const indexSpaceRisk = unverifiedIndexSpaceRisk(pkg?.riseProbeJson);
        if (indexSpaceRisk) {
            update.progressSource = 'binary';
            return bookmark
                ? keepSourceIfDecoded(update, current)
                : clearLessonLabel(update, current);
        }
        if (decoded.cpv && !pkg?.riseCpv) {
            const indicesCorroborate = decoded.completedIndices.length > 0 &&
                decoded.completedIndices.every((index) => lessons.some((l) => l.index === index));
            if (indicesCorroborate || bookmark !== null) {
                metadata[CORROBORATED_CPV_KEY] = decoded.cpv;
                if (jsonObject(current.metadata)[CORROBORATED_CPV_KEY] !== decoded.cpv) {
                    await this.maybeSeedPackageCpv(current, decoded.cpv);
                }
            }
        }
        update.progressSource = 'suspend-data';
        const byIndex = new Map(lessons.map((l) => [l.index, l]));
        const known = new Set(current.lessonsCompletedIndices ?? []);
        const merged = Array.from(new Set([...known, ...decoded.completedIndices]))
            .filter((index) => byIndex.has(index))
            .sort((a, b) => a - b);
        const knownInManifest = Array.from(known).filter((i) => byIndex.has(i));
        if (merged.length === knownInManifest.length) {
            if (lessons.length > 0 &&
                knownInManifest.length === lessons.length &&
                (await canRecord())) {
                const anySection = lessons.find((l) => l.sectionId);
                if (anySection) {
                    await this.stampChapterCompletion(current, anySection.sectionId);
                }
            }
            await this.applyLessonIndices(current.id, [], lessons.map((l) => l.index));
            return update;
        }
        const rows = merged
            .map((index) => byIndex.get(index))
            .filter((l) => !!l?.sectionId);
        const sections = rows.length
            ? await this.prisma.section.findMany({
                where: { id: { in: rows.map((l) => l.sectionId) } },
                select: {
                    id: true,
                    chapterId: true,
                    moduleId: true,
                    chapter: { select: { moduleId: true } },
                },
            })
            : [];
        const sectionById = new Map(sections.map((s) => [s.id, s]));
        const data = [];
        const appliedIndices = [];
        for (const lesson of rows) {
            const section = sectionById.get(lesson.sectionId);
            const moduleId = section?.moduleId ?? section?.chapter?.moduleId ?? null;
            if (!section?.chapterId || !moduleId)
                continue;
            data.push({
                userId: current.userId,
                courseId: current.courseId,
                chapterId: section.chapterId,
                moduleId,
                sectionId: section.id,
            });
            appliedIndices.push(lesson.index);
        }
        if (data.length === 0) {
            if (rows.length > 0) {
                this.logger.warn(`Registration ${current.id}: none of ${rows.length} decoded lesson(s) resolved to a writable section; they stay unapplied and will be retried on the next pull.`);
            }
            return update;
        }
        if (!(await canRecord())) {
            return update;
        }
        await this.prisma.userCourseProgress.createMany({
            data,
            skipDuplicates: true,
        });
        await this.stampChapterCompletion(current, data[0].sectionId, data[0].chapterId);
        if (data.length < rows.length) {
            this.logger.warn(`Registration ${current.id}: ${rows.length - data.length} decoded lesson(s) ` +
                `could not be written (section missing or has no chapter); they stay ` +
                `unapplied and will be retried on the next pull.`);
        }
        await this.applyLessonIndices(current.id, appliedIndices, lessons.map((l) => l.index));
        return update;
    }
    async maybeSeedPackageCpv(current, cpv) {
        try {
            const others = await this.prisma.scormRegistration.count({
                where: {
                    packageId: current.packageId,
                    id: { not: current.id },
                    metadata: { path: [CORROBORATED_CPV_KEY], equals: cpv },
                },
            });
            if (others < 1)
                return;
            await this.prisma.scormPackage.updateMany({
                where: { id: current.packageId, riseCpv: null },
                data: { riseCpv: cpv },
            });
        }
        catch (err) {
            this.logger.warn(`Could not seed the Rise fingerprint for package ${current.packageId}: ${(0, error_message_1.errorMessage)(err)}`);
        }
    }
    warnUndecodableSuspendData(registrationId, raw) {
        if (typeof raw !== 'string' || raw.trim().length === 0)
            return;
        let version = 'unparseable';
        try {
            const envelope = JSON.parse(raw);
            if (envelope &&
                typeof envelope === 'object' &&
                !Array.isArray(envelope)) {
                version = envelope.v;
            }
        }
        catch {
        }
        const key = `${registrationId}:${String(version)}`;
        if (this.undecodableSeen.has(key))
            return;
        if (this.undecodableSeen.size >= UNDECODABLE_WARN_CACHE) {
            this.undecodableSeen.clear();
        }
        this.undecodableSeen.add(key);
        this.logger.warn(`Registration ${registrationId}: suspendData could not be decoded ` +
            `(v=${JSON.stringify(version) ?? 'undefined'}, ${raw.length} bytes) — falling back to binary progress`);
    }
    async stampChapterCompletion(row, sectionId, knownChapterId) {
        try {
            let chapterId = knownChapterId;
            if (!chapterId) {
                const section = await this.prisma.section.findUnique({
                    where: { id: sectionId },
                    select: { chapterId: true },
                });
                chapterId = section?.chapterId ?? undefined;
            }
            if (!chapterId)
                return;
            await (0, chapter_progression_1.recordChapterAndModuleCompletionIfNeeded)(this.prisma, row.userId, chapterId, { courseId: row.courseId });
        }
        catch (err) {
            this.logger.warn(`Chapter/module completion bookkeeping failed for registration ${row.id}: ${(0, error_message_1.errorMessage)(err)}`);
        }
    }
    async lastSeenPointerIsStale(userId, chapterId) {
        try {
            const existing = await this.prisma.lastSeenSection.findUnique({
                where: { userId_chapterId: { userId, chapterId } },
                select: { sectionId: true },
            });
            if (!existing?.sectionId)
                return true;
            const section = await this.prisma.section.findUnique({
                where: { id: existing.sectionId },
                select: { isActive: true, isArchived: true },
            });
            return !section || section.isArchived || !section.isActive;
        }
        catch {
            return true;
        }
    }
    async updateLastSeenLesson(row, sectionId) {
        try {
            const section = await this.prisma.section.findUnique({
                where: { id: sectionId },
                select: {
                    chapterId: true,
                    moduleId: true,
                    chapter: { select: { moduleId: true } },
                },
            });
            const moduleId = section?.moduleId ?? section?.chapter?.moduleId ?? null;
            if (!section?.chapterId || !moduleId)
                return;
            await this.prisma.lastSeenSection.upsert({
                where: {
                    userId_chapterId: {
                        userId: row.userId,
                        chapterId: section.chapterId,
                    },
                },
                update: { sectionId },
                create: {
                    userId: row.userId,
                    chapterId: section.chapterId,
                    sectionId,
                    moduleId,
                    courseId: row.courseId,
                },
            });
        }
        catch (err) {
            this.logger.warn(`Could not move the resume pointer for registration ${row.id}: ${(0, error_message_1.errorMessage)(err)}`);
        }
    }
    async canRecordProgress(row, purpose = 'lesson progress') {
        try {
            const [user, course] = await Promise.all([
                this.prisma.user.findUnique({
                    where: { id: row.userId },
                    select: { deletedAt: true },
                }),
                this.prisma.course.findUnique({
                    where: { id: row.courseId },
                    select: { isActive: true },
                }),
            ]);
            if (!user || user.deletedAt)
                return false;
            if (!course?.isActive)
                return false;
            await (0, assert_enrollment_usable_1.assertEnrollmentUsable)(this.prisma, row.userId, row.courseId, client_1.Role.user);
            return true;
        }
        catch (err) {
            if (err instanceof common_1.ForbiddenException) {
                this.logger.warn(`Skipping SCORM ${purpose} for registration ${row.id}: enrolment not usable (${(0, error_message_1.errorMessage)(err)})`);
                return false;
            }
            this.logger.warn(`Skipping SCORM ${purpose} for registration ${row.id}: ${(0, error_message_1.errorMessage)(err)}`);
            return false;
        }
    }
    async applyLessonIndices(registrationId, indices, validIndices) {
        const incoming = intArrayLiteral(indices);
        const valid = intArrayLiteral(validIndices);
        const mergedSet = client_1.Prisma.sql `
      SELECT DISTINCT i
        FROM unnest(
               COALESCE(sr."lessonsCompletedIndices", ARRAY[]::int[]) || ${incoming}
             ) AS i
       WHERE i = ANY(${valid})
    `;
        await this.prisma.$executeRaw(client_1.Prisma.sql `
      UPDATE "scorm_registrations" sr
         SET "lessonsCompletedIndices" = ARRAY(${mergedSet} ORDER BY 1),
             "lessonsCompleted" = cardinality(ARRAY(${mergedSet}))
       WHERE sr."id" = ${registrationId}
    `);
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
        await this.stampCompletionDenominator(row, certifySection);
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
            await this.prisma.scormRegistration.updateMany({
                where: { id: row.id, completedAt: null },
                data: { completedAt: new Date() },
            });
        }
        return done ? 'done' : 'retry';
    }
    async stampCompletionDenominator(row, fallback) {
        const registration = await this.prisma.scormRegistration.findUnique({
            where: { id: row.id },
            select: { lessonsCompleted: true, lessonsCompletedAtCertify: true },
        });
        if (registration &&
            registration.lessonsCompletedAtCertify == null &&
            registration.lessonsCompleted != null) {
            await this.prisma.scormRegistration.updateMany({
                where: { id: row.id, lessonsCompletedAtCertify: null },
                data: {
                    lessonsCompletedAtCertify: registration.lessonsCompleted,
                },
            });
        }
        const { liveSectionIds } = await this.courseVersionService.countCompletionDenominator(row.userId, row.courseId);
        if (liveSectionIds.length === 0) {
            await this.prisma.userCourseProgress.createMany({
                data: [
                    {
                        userId: row.userId,
                        courseId: row.courseId,
                        chapterId: fallback.chapterId,
                        moduleId: fallback.moduleId,
                        sectionId: fallback.sectionId,
                    },
                ],
                skipDuplicates: true,
            });
            return;
        }
        const sections = await this.prisma.section.findMany({
            where: { id: { in: liveSectionIds } },
            select: {
                id: true,
                chapterId: true,
                moduleId: true,
                chapter: { select: { moduleId: true } },
            },
        });
        const data = sections
            .filter((s) => !!s.chapterId)
            .map((s) => ({
            userId: row.userId,
            courseId: row.courseId,
            chapterId: s.chapterId,
            moduleId: s.moduleId ?? s.chapter?.moduleId ?? fallback.moduleId,
            sectionId: s.id,
        }));
        if (data.length > 0) {
            await this.prisma.userCourseProgress.createMany({
                data,
                skipDuplicates: true,
            });
        }
        if (data.length < liveSectionIds.length) {
            const stamped = new Set(data.map((d) => d.sectionId));
            const missing = liveSectionIds.filter((id) => !stamped.has(id));
            this.logger.error(`Certify stamp is short for registration ${row.id}: the completion gate counts ` +
                `${liveSectionIds.length} sections but only ${data.length} could be stamped. ` +
                `Unresolvable section ids: ${missing.slice(0, 10).join(', ')}. ` +
                `This learner cannot complete until the curriculum is repaired.`);
        }
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
            orderBy: { orderIndex: 'asc' },
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
                OR: [
                    { firstLaunchAt: { not: null } },
                    { lastPostbackAt: { not: null } },
                ],
            },
        });
        if (inProgress > 0)
            return false;
        const versions = await this.prisma.courseVersion.findMany({
            where: { courseId: pkg.courseId, status: 'PUBLISHED' },
            select: { id: true, manifest: true },
        });
        const ownedSections = await this.prisma.section.findMany({
            where: {
                type: client_1.SectionType.SCORM,
                config: { path: ['packageId'], equals: pkg.id },
            },
            select: { id: true },
        });
        const ownedSectionIds = new Set([pkg.sectionId]);
        for (const section of ownedSections)
            ownedSectionIds.add(section.id);
        for (const lesson of parsePackageLessons(pkg.lessons)) {
            ownedSectionIds.add(lesson.sectionId);
        }
        for (const version of versions) {
            const manifest = version.manifest;
            const modules = manifest?.modules ?? [];
            const versionSectionIds = new Set();
            for (const mod of modules) {
                const chapters = mod.chapters ?? [];
                for (const chapter of chapters) {
                    const ids = chapter.sectionIds;
                    if (!Array.isArray(ids))
                        continue;
                    for (const id of ids) {
                        if (typeof id === 'string')
                            versionSectionIds.add(id);
                    }
                }
            }
            const referencesThisPackage = Array.from(ownedSectionIds).some((id) => versionSectionIds.has(id));
            if (!referencesThisPackage)
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
            update: args.repairStalePointer ? { sectionId: args.sectionId } : {},
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
                orderBy: { orderIndex: 'asc' },
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
function parsePackageLessons(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
            continue;
        const row = entry;
        if (typeof row.index !== 'number' || !Number.isInteger(row.index))
            continue;
        if (typeof row.id !== 'string' || !row.id)
            continue;
        if (typeof row.sectionId !== 'string' || !row.sectionId)
            continue;
        out.push({
            index: row.index,
            id: row.id,
            title: typeof row.title === 'string' ? row.title : '',
            type: typeof row.type === 'string' ? row.type : 'blocks',
            sectionId: row.sectionId,
        });
    }
    return out;
}
function toDate(value) {
    if (typeof value !== 'string' || !value)
        return null;
    const trimmed = value.trim();
    const zoneless = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed);
    const date = new Date(zoneless ? `${trimmed.replace(' ', 'T')}Z` : trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
}
function maxDate(stored, incoming) {
    return stored && stored.getTime() > incoming.getTime() ? stored : incoming;
}
function isSnapshotFresh(row, snapshotAt) {
    const newest = Math.max(row.lastPostbackAt?.getTime() ?? Number.NEGATIVE_INFINITY, row.lastRuntimeAppliedAt?.getTime() ?? Number.NEGATIVE_INFINITY);
    return snapshotAt.getTime() >= newest;
}
function jsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}
function isRuntimeDirty(row) {
    if (!row.lastPostbackAt)
        return false;
    if (!row.lastRuntimeAppliedAt)
        return true;
    return row.lastPostbackAt.getTime() > row.lastRuntimeAppliedAt.getTime();
}
function unverifiedIndexSpaceRisk(probe) {
    if (!probe || typeof probe !== 'object' || Array.isArray(probe))
        return null;
    const record = probe;
    if (record.riseIndexSpaceVerified === true)
        return null;
    return typeof record.riseIndexSpaceRisk === 'string' &&
        record.riseIndexSpaceRisk.length > 0
        ? record.riseIndexSpaceRisk
        : null;
}
async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next;
            next += 1;
            results[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
    return results;
}
const METADATA_REDUNDANT_KEYS = new Set([
    'registrationCompletion',
    'registrationSuccess',
    'totalSecondsTracked',
    'firstAccessDate',
    'lastAccessDate',
    'score',
]);
function buildRegistrationMetadata(payload) {
    const source = (payload ?? {});
    const clone = {};
    for (const [key, value] of Object.entries(source)) {
        if (METADATA_REDUNDANT_KEYS.has(key))
            continue;
        clone[key] = JSON.parse(JSON.stringify(value ?? null));
    }
    scrubPayload(clone);
    return clone;
}
const LEARNER_NAME_KEYS = new Set([
    'firstName',
    'lastName',
    'fullName',
    'name',
    'email',
]);
function scrubPayload(node) {
    if (!node || typeof node !== 'object')
        return;
    if (Array.isArray(node)) {
        for (const child of node)
            scrubPayload(child);
        return;
    }
    const record = node;
    for (const [key, value] of Object.entries(record)) {
        if (LEARNER_NAME_KEYS.has(key) && typeof value === 'string') {
            delete record[key];
            continue;
        }
        if (key === 'runtimeInteractions' || key === 'runtimeObjectives') {
            record[`${key}Count`] = Array.isArray(value) ? value.length : null;
            delete record[key];
            continue;
        }
        if (key === 'suspendData') {
            record.suspendDataBytes = typeof value === 'string' ? value.length : null;
            delete record[key];
            continue;
        }
        scrubPayload(value);
    }
}
function higherRanked(a, b, map, rank) {
    if (a === undefined)
        return b;
    if (b === undefined)
        return a;
    return (rank[map(a)] ?? 0) >= (rank[map(b)] ?? 0) ? a : b;
}
function clearLessonLabel(update, current) {
    update.lessonId = null;
    update.lessonIndex = null;
    update.lessonTitle = null;
    return keepSourceIfDecoded(update, current);
}
function keepSourceIfDecoded(update, current) {
    if (current.lessonsCompleted != null)
        delete update.progressSource;
    return update;
}
function higherScore(a, b) {
    if (typeof a?.scaled !== 'number')
        return b;
    if (typeof b?.scaled !== 'number')
        return a;
    return a.scaled >= b.scaled ? a : b;
}
function intArrayLiteral(values) {
    if (values.length === 0)
        return client_1.Prisma.sql `ARRAY[]::int[]`;
    return client_1.Prisma.sql `ARRAY[${client_1.Prisma.join(values)}]::int[]`;
}
//# sourceMappingURL=scorm-runtime.service.js.map