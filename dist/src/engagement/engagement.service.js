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
var EngagementService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngagementService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../prisma/prisma.service");
const mail_service_1 = require("../mail/mail.service");
const mail_types_1 = require("../mail/mail.types");
const with_db_retry_1 = require("../utils/with-db-retry");
const engagement_constants_1 = require("./engagement.constants");
const feedback_constants_1 = require("../feedback/feedback.constants");
let EngagementService = EngagementService_1 = class EngagementService {
    constructor(prisma, mail, config) {
        this.prisma = prisma;
        this.mail = mail;
        this.config = config;
        this.logger = new common_1.Logger(EngagementService_1.name);
    }
    num(key, fallback) {
        const raw = this.config.get(key);
        const parsed = raw === undefined ? NaN : Number(raw);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    }
    appBaseUrl() {
        return (this.config.get(engagement_constants_1.ENGAGEMENT_ENV.appBaseUrl) ??
            engagement_constants_1.ENGAGEMENT_DEFAULTS.appBaseUrl).replace(/\/+$/, '');
    }
    courseUrl(courseId) {
        return `${this.appBaseUrl()}/studentCourses/${courseId}`;
    }
    async runSweep(now = new Date()) {
        const limit = Math.trunc(this.num(engagement_constants_1.ENGAGEMENT_ENV.batchLimit, engagement_constants_1.ENGAGEMENT_DEFAULTS.batchLimit));
        const neverStartedDays = this.num(engagement_constants_1.ENGAGEMENT_ENV.neverStartedDays, engagement_constants_1.ENGAGEMENT_DEFAULTS.neverStartedDays);
        const stalledDays = this.num(engagement_constants_1.ENGAGEMENT_ENV.stalledDays, engagement_constants_1.ENGAGEMENT_DEFAULTS.stalledDays);
        const neverStartedCooldown = this.num(engagement_constants_1.ENGAGEMENT_ENV.neverStartedCooldownDays, engagement_constants_1.ENGAGEMENT_DEFAULTS.neverStartedCooldownDays);
        const stalledCooldown = this.num(engagement_constants_1.ENGAGEMENT_ENV.stalledCooldownDays, engagement_constants_1.ENGAGEMENT_DEFAULTS.stalledCooldownDays);
        const neverStartedCandidates = await this.findNeverStarted(neverStartedDays, limit);
        const neverStarted = await this.dispatch(neverStartedCandidates, mail_types_1.ReminderType.NEVER_STARTED, (0, engagement_constants_1.cooldownBucket)(now, neverStartedCooldown));
        const stalledCandidates = await this.findStalled(stalledDays, limit);
        const stalled = await this.dispatch(stalledCandidates, mail_types_1.ReminderType.STALLED, (0, engagement_constants_1.cooldownBucket)(now, stalledCooldown));
        const feedbackCandidates = await this.findFeedbackReminders(limit);
        const feedbackReminder = await this.dispatchFeedbackReminders(feedbackCandidates, (0, feedback_constants_1.feedbackReminderBucket)(now, feedback_constants_1.FEEDBACK_REMINDER_COOLDOWN_DAYS));
        const summary = {
            neverStarted,
            stalled,
            feedbackReminder,
            ranAt: now.toISOString(),
        };
        this.logger.log(`Engagement sweep: never_started ${neverStarted.notified}/${neverStarted.candidates} notified, ` +
            `${neverStarted.emailed} emailed; stalled ${stalled.notified}/${stalled.candidates} notified, ` +
            `${stalled.emailed} emailed; feedback ${feedbackReminder.notified}/${feedbackReminder.candidates} notified, ` +
            `${feedbackReminder.emailed} emailed.`);
        return summary;
    }
    async findNeverStarted(daysEnrolled, limit) {
        const cutoff = client_1.Prisma.sql `(now() - make_interval(days => ${daysEnrolled}::int))`;
        return (0, with_db_retry_1.withDbRetry)(() => this.prisma.$queryRaw `
          ${EngagementService_1.ACTIVITY_CTE}
          SELECT uc."userId"   AS "userId",
                 uc."courseId" AS "courseId",
                 u."email"     AS "email",
                 u."firstName" AS "firstName",
                 c."title"     AS "courseTitle",
                 c."duration"  AS "courseDuration"
            FROM "user_courses" uc
            JOIN "users"   u ON u."id" = uc."userId"
            JOIN "courses" c ON c."id" = uc."courseId"
            LEFT JOIN "course_completions" cc
                   ON cc."userId" = uc."userId" AND cc."courseId" = uc."courseId"
            LEFT JOIN activity_rollup ar
                   ON ar."userId" = uc."userId" AND ar."courseId" = uc."courseId"
           WHERE c."isActive" = true        -- course is live in the catalogue
             AND uc."isActive" = true       -- admin has activated it for this user
             AND u."status" = 'active'      -- account can actually log in
             AND u."deletedAt" IS NULL
             AND cc."id" IS NULL            -- not completed
             AND ar."userId" IS NULL        -- zero activity of any kind
             -- Start line is course activation for this user (COALESCE handles
             -- rows predating the activatedAt column).
             AND COALESCE(uc."activatedAt", uc."updatedAt") < ${cutoff}
           ORDER BY uc."userId", uc."courseId"
           LIMIT ${limit}
        `, { mode: 'read' });
    }
    async findStalled(daysInactive, limit) {
        const cutoff = client_1.Prisma.sql `(now() - make_interval(days => ${daysInactive}::int))`;
        return (0, with_db_retry_1.withDbRetry)(() => this.prisma.$queryRaw `
          ${EngagementService_1.ACTIVITY_CTE}
          SELECT uc."userId"   AS "userId",
                 uc."courseId" AS "courseId",
                 u."email"     AS "email",
                 u."firstName" AS "firstName",
                 c."title"     AS "courseTitle",
                 -- Progress = distinct sections the user has progressed through.
                 -- Restricted to sections that still exist; stale progress rows
                 -- (section deleted/moved after completion) would otherwise push
                 -- completedSections past totalSections (>100%).
                 (SELECT COUNT(DISTINCT ucp."sectionId")
                    FROM "UserCourseProgress" ucp
                   WHERE ucp."userId" = uc."userId"
                     AND ucp."courseId" = uc."courseId"
                     AND EXISTS (SELECT 1 FROM "sections" s
                                  WHERE s."id" = ucp."sectionId"))::int AS "completedSections",
                 -- Total sections in the course (sections → chapters → modules).
                 (SELECT COUNT(*)
                    FROM "sections" s
                    JOIN "chapters" ch ON ch."id" = s."chapterId"
                    JOIN "modules"  mo ON mo."id" = ch."moduleId"
                   WHERE mo."courseId" = uc."courseId")::int AS "totalSections"
            FROM "user_courses" uc
            JOIN "users"   u ON u."id" = uc."userId"
            JOIN "courses" c ON c."id" = uc."courseId"
            JOIN activity_rollup ar
              ON ar."userId" = uc."userId" AND ar."courseId" = uc."courseId"
            LEFT JOIN "course_completions" cc
                   ON cc."userId" = uc."userId" AND cc."courseId" = uc."courseId"
           WHERE c."isActive" = true        -- course is live in the catalogue
             AND uc."isActive" = true       -- admin has activated it for this user
             AND u."status" = 'active'      -- account can actually log in
             AND u."deletedAt" IS NULL
             AND cc."id" IS NULL            -- not completed
             AND ar.last_at < ${cutoff}     -- last activity older than threshold
           ORDER BY uc."userId", uc."courseId"
           LIMIT ${limit}
        `, { mode: 'read' });
    }
    async findFeedbackReminders(limit) {
        const cutoff = client_1.Prisma.sql `(now() - make_interval(days => ${feedback_constants_1.FEEDBACK_REMINDER_AFTER_DAYS}::int))`;
        const maxNotifications = feedback_constants_1.FEEDBACK_REMINDER_LIFETIME_CAP + 1;
        return (0, with_db_retry_1.withDbRetry)(() => this.prisma.$queryRaw `
          SELECT cc."userId"   AS "userId",
                 cc."courseId" AS "courseId",
                 u."email"     AS "email",
                 u."firstName" AS "firstName",
                 c."title"     AS "courseTitle"
            FROM "course_completions" cc
            JOIN "users" u ON u."id" = cc."userId"
            JOIN "courses" c ON c."id" = cc."courseId"
            JOIN "course_feedback_forms" ff ON ff."courseId" = cc."courseId"
            LEFT JOIN "course_feedback_submissions" fs
                   ON fs."userId" = cc."userId" AND fs."courseId" = cc."courseId"
           WHERE cc."courseCompletedAt" IS NOT NULL
             AND cc."courseCompletedAt" < ${cutoff}
             AND ff."isRequired" = true
             AND ff."isActive" = true
             AND fs."id" IS NULL
             AND c."isActive" = true
             AND u."status" = 'active'
             AND u."deletedAt" IS NULL
             AND (
               SELECT COUNT(*)::int
                 FROM "notifications" n
                WHERE n."userId" = cc."userId"
                  AND n."referenceId" = cc."courseId"
                  AND n."type" = 'COURSE_FEEDBACK_REQUIRED'
             ) < ${maxNotifications}
           ORDER BY cc."userId", cc."courseId"
           LIMIT ${limit}
        `, { mode: 'read' });
    }
    async dispatchFeedbackReminders(candidates, bucket) {
        if (candidates.length === 0) {
            return { candidates: 0, notified: 0, emailed: 0 };
        }
        const rows = candidates.map((c) => {
            const daysOverdue = Math.min(30, feedback_constants_1.FEEDBACK_REMINDER_AFTER_DAYS);
            return {
                userId: c.userId,
                type: client_1.NotificationType.COURSE_FEEDBACK_REQUIRED,
                message: `Please share your feedback for ${c.courseTitle}.`,
                payload: {
                    courseId: c.courseId,
                    courseTitle: c.courseTitle,
                    daysOverdue,
                    reminderType: mail_types_1.ReminderType.FEEDBACK_REMINDER,
                },
                groupKey: (0, feedback_constants_1.feedbackGroupKey)(c.courseId),
                dedupeKey: (0, feedback_constants_1.feedbackDedupeKey)(c.courseId, c.userId, bucket),
                referenceId: c.courseId,
            };
        });
        const inserted = await (0, with_db_retry_1.withDbRetry)(() => this.prisma.notification.createMany({
            data: rows,
            skipDuplicates: true,
        }), { mode: 'write' });
        let emailed = 0;
        if (inserted.count > 0 && this.mail.isEnabled) {
            const freshKeys = await this.freshlyInsertedFeedbackKeys(rows);
            const toEmail = candidates.filter((c) => freshKeys.has((0, feedback_constants_1.feedbackDedupeKey)(c.courseId, c.userId, bucket)));
            emailed = await this.sendFeedbackReminderEmails(toEmail);
        }
        return {
            candidates: candidates.length,
            notified: inserted.count,
            emailed,
        };
    }
    async sendFeedbackReminderEmails(recipients) {
        const batchSize = Math.max(1, Math.trunc(this.num(engagement_constants_1.ENGAGEMENT_ENV.emailConcurrency, engagement_constants_1.ENGAGEMENT_DEFAULTS.emailConcurrency)));
        const pauseMs = engagement_constants_1.ENGAGEMENT_DEFAULTS.emailBatchPauseMs;
        const sendOne = (c) => this.mail.sendFeedbackReminder({
            to: c.email,
            userId: c.userId,
            firstName: c.firstName,
            courseTitle: c.courseTitle,
            courseId: c.courseId,
        });
        let sent = 0;
        for (let i = 0; i < recipients.length; i += batchSize) {
            const chunk = recipients.slice(i, i + batchSize);
            const results = await Promise.all(chunk.map(sendOne));
            sent += results.filter((r) => r.sent).length;
            if (i + batchSize < recipients.length)
                await this.sleep(pauseMs);
        }
        return sent;
    }
    async freshlyInsertedFeedbackKeys(rows) {
        const keys = rows
            .map((r) => r.dedupeKey)
            .filter((k) => typeof k === 'string');
        if (keys.length === 0)
            return new Set();
        const found = await (0, with_db_retry_1.withDbRetry)(() => this.prisma.notification.findMany({
            where: {
                dedupeKey: { in: keys },
                createdAt: { gte: new Date(Date.now() - 5 * 60000) },
            },
            select: { dedupeKey: true },
        }), { mode: 'read' });
        return new Set(found
            .map((f) => f.dedupeKey)
            .filter((k) => typeof k === 'string'));
    }
    async dispatch(candidates, reminderType, bucket) {
        if (candidates.length === 0) {
            return { candidates: 0, notified: 0, emailed: 0 };
        }
        const message = reminderType === mail_types_1.ReminderType.NEVER_STARTED
            ? 'You have enrolled in a course but have not started yet.'
            : 'You have not been active in your course recently — pick up where you left off.';
        const rows = candidates.map((c) => ({
            userId: c.userId,
            type: client_1.NotificationType.ENGAGEMENT_REMINDER,
            message,
            payload: {
                reminderType,
                courseId: c.courseId,
                courseTitle: c.courseTitle,
            },
            groupKey: (0, engagement_constants_1.engagementGroupKey)(reminderType, c.courseId),
            dedupeKey: (0, engagement_constants_1.engagementDedupeKey)({
                reminderType,
                courseId: c.courseId,
                userId: c.userId,
                bucket,
            }),
            referenceId: c.courseId,
        }));
        const inserted = await (0, with_db_retry_1.withDbRetry)(() => this.prisma.notification.createMany({
            data: rows,
            skipDuplicates: true,
        }), { mode: 'write' });
        let emailed = 0;
        if (inserted.count > 0 && this.mail.isEnabled) {
            const freshKeys = await this.freshlyInsertedKeys(rows);
            const toEmail = candidates.filter((c) => freshKeys.has((0, engagement_constants_1.engagementDedupeKey)({
                reminderType,
                courseId: c.courseId,
                userId: c.userId,
                bucket,
            })));
            emailed = await this.sendEmails(toEmail, reminderType);
        }
        return {
            candidates: candidates.length,
            notified: inserted.count,
            emailed,
        };
    }
    async sendEmails(recipients, reminderType) {
        const batchSize = Math.max(1, Math.trunc(this.num(engagement_constants_1.ENGAGEMENT_ENV.emailConcurrency, engagement_constants_1.ENGAGEMENT_DEFAULTS.emailConcurrency)));
        const pauseMs = engagement_constants_1.ENGAGEMENT_DEFAULTS.emailBatchPauseMs;
        const sendOne = (c) => this.mail.sendEngagementReminder({
            to: c.email,
            userId: c.userId,
            firstName: c.firstName,
            courseTitle: c.courseTitle,
            reminderType,
            courseUrl: this.courseUrl(c.courseId),
            courseDuration: c.courseDuration,
            completedSections: c.completedSections,
            totalSections: c.totalSections,
        });
        let sent = 0;
        const rateLimited = [];
        for (let i = 0; i < recipients.length; i += batchSize) {
            const chunk = recipients.slice(i, i + batchSize);
            const results = await Promise.all(chunk.map(sendOne));
            results.forEach((r, idx) => {
                if (r.sent)
                    sent += 1;
                else if (r.reason && /rate.?limit/i.test(r.reason))
                    rateLimited.push(chunk[idx]);
            });
            if (i + batchSize < recipients.length)
                await this.sleep(pauseMs);
        }
        if (rateLimited.length > 0) {
            await this.sleep(pauseMs * 2);
            for (let i = 0; i < rateLimited.length; i += batchSize) {
                const chunk = rateLimited.slice(i, i + batchSize);
                const results = await Promise.all(chunk.map(sendOne));
                sent += results.filter((r) => r.sent).length;
                if (i + batchSize < rateLimited.length)
                    await this.sleep(pauseMs);
            }
        }
        return sent;
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    async freshlyInsertedKeys(rows) {
        const keys = rows
            .map((r) => r.dedupeKey)
            .filter((k) => typeof k === 'string');
        if (keys.length === 0)
            return new Set();
        const found = await (0, with_db_retry_1.withDbRetry)(() => this.prisma.notification.findMany({
            where: {
                dedupeKey: { in: keys },
                createdAt: { gte: new Date(Date.now() - 5 * 60000) },
            },
            select: { dedupeKey: true },
        }), { mode: 'read' });
        return new Set(found
            .map((f) => f.dedupeKey)
            .filter((k) => typeof k === 'string'));
    }
};
exports.EngagementService = EngagementService;
EngagementService.ACTIVITY_CTE = client_1.Prisma.sql `
    WITH activity AS (
      SELECT "userId", "courseId", MAX("updatedAt") AS last_at
        FROM "UserCourseProgress" GROUP BY "userId", "courseId"
      UNION ALL
      SELECT "userId", "courseId", MAX("updatedAt") AS last_at
        FROM "LastSeenSection" GROUP BY "userId", "courseId"
      UNION ALL
      SELECT qp."userId", m."courseId", MAX(qp."updatedAt") AS last_at
        FROM "quiz_progress" qp
        JOIN "chapters" c ON c."id" = qp."chapterId"
        JOIN "modules"  m ON m."id" = c."moduleId"
       GROUP BY qp."userId", m."courseId"
      UNION ALL
      SELECT aa."userId", a."courseId", MAX(GREATEST(aa."updatedAt", aa."startedAt")) AS last_at
        FROM "assessment_attempts" aa
        JOIN "assessments" a ON a."id" = aa."assessmentId"
       GROUP BY aa."userId", a."courseId"
      UNION ALL
      SELECT s."studentId" AS "userId", a."courseId", MAX(s."updatedAt") AS last_at
        FROM "assignment_submissions" s
        JOIN "assignments" a ON a."id" = s."assignmentId"
       GROUP BY s."studentId", a."courseId"
    ),
    activity_rollup AS (
      SELECT "userId", "courseId", MAX(last_at) AS last_at
        FROM activity GROUP BY "userId", "courseId"
    )`;
exports.EngagementService = EngagementService = EngagementService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        mail_service_1.MailService,
        config_1.ConfigService])
], EngagementService);
//# sourceMappingURL=engagement.service.js.map