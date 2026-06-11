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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminDashboardService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const with_db_retry_1 = require("../utils/with-db-retry");
const engagement_constants_1 = require("../engagement/engagement.constants");
let AdminDashboardService = class AdminDashboardService {
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
    }
    async getOverview() {
        return this.wrap('Overview fetched successfully', async () => {
            const [users] = await this.read(client_1.Prisma.sql `
        SELECT
          COUNT(*) FILTER (WHERE "deletedAt" IS NULL) AS total,
          COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND "status" = 'active') AS active,
          COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND "status" = 'inactive') AS inactive,
          COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND "role" = 'admin') AS admins,
          COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND "role" = 'user') AS students,
          COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND "mustChangePassword" = true) AS pending_first_login,
          COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND "createdAt" >= now() - interval '7 days') AS new_this_week
        FROM "users"
      `);
            const [enroll] = await this.read(client_1.Prisma.sql `
        SELECT
          COUNT(*) FILTER (WHERE "isActive" = true) AS active,
          COUNT(*) FILTER (WHERE "isActive" = false) AS assigned_inactive,
          COUNT(*) FILTER (WHERE "isPaid" = true) AS paid
        FROM "user_courses"
      `);
            const [courses] = await this.read(client_1.Prisma.sql `
        SELECT COUNT(*) FILTER (WHERE "isActive" = true) AS active_courses FROM "courses"
      `);
            const [logins] = await this.read(client_1.Prisma.sql `
        SELECT
          COUNT(*) FILTER (WHERE "createdAt" >= date_trunc('day', now())) AS today,
          COUNT(*) FILTER (WHERE "createdAt" >= now() - interval '7 days') AS week
        FROM "login_events"
      `);
            const [completions] = await this.read(client_1.Prisma.sql `
        SELECT COUNT(*) FILTER (WHERE "courseCompletedAt" IS NOT NULL) AS total,
               COUNT(*) FILTER (WHERE "isPassed" = true) AS assessment_passed
        FROM "course_completions"
      `);
            const [reminders] = await this.read(client_1.Prisma.sql `
        SELECT
          COUNT(*) FILTER (WHERE "createdAt" >= now() - interval '7 days') AS sent_week,
          COUNT(*) FILTER (WHERE "payload"->>'reminderType' = 'never_started') AS never_started,
          COUNT(*) FILTER (WHERE "payload"->>'reminderType' = 'stalled') AS stalled
        FROM "notifications"
        WHERE "type" = 'ENGAGEMENT_REMINDER'
      `);
            const activeToday = await this.distinctActiveUsers('day');
            const activeWeek = await this.distinctActiveUsers('week');
            return {
                users: {
                    total: this.n(users.total),
                    active: this.n(users.active),
                    inactive: this.n(users.inactive),
                    admins: this.n(users.admins),
                    students: this.n(users.students),
                    pendingFirstLogin: this.n(users.pending_first_login),
                    newThisWeek: this.n(users.new_this_week),
                },
                courses: { active: this.n(courses.active_courses) },
                enrollments: {
                    active: this.n(enroll.active),
                    assignedNotActivated: this.n(enroll.assigned_inactive),
                    paid: this.n(enroll.paid),
                },
                logins: { today: this.n(logins.today), last7Days: this.n(logins.week) },
                activeLearners: { today: activeToday, last7Days: activeWeek },
                completions: {
                    total: this.n(completions.total),
                    assessmentPassed: this.n(completions.assessment_passed),
                },
                engagementReminders: {
                    sentLast7Days: this.n(reminders.sent_week),
                    neverStartedTotal: this.n(reminders.never_started),
                    stalledTotal: this.n(reminders.stalled),
                },
            };
        });
    }
    async distinctActiveUsers(window) {
        const since = window === 'day'
            ? client_1.Prisma.sql `date_trunc('day', now())`
            : client_1.Prisma.sql `now() - interval '7 days'`;
        const [row] = await this.read(client_1.Prisma.sql `
      SELECT COUNT(DISTINCT "userId") AS n FROM (
        SELECT "userId" FROM "UserCourseProgress" WHERE "updatedAt" >= ${since}
        UNION SELECT "userId" FROM "LastSeenSection" WHERE "updatedAt" >= ${since}
        UNION SELECT "userId" FROM "quiz_progress" WHERE "updatedAt" >= ${since}
        UNION SELECT "userId" FROM "assessment_attempts" WHERE "updatedAt" >= ${since}
        UNION SELECT "studentId" AS "userId" FROM "assignment_submissions" WHERE "updatedAt" >= ${since}
        UNION SELECT "userId" FROM "section_time_spent" WHERE "updatedAt" >= ${since}
        UNION SELECT "userId" FROM "login_events" WHERE "createdAt" >= ${since}
        UNION SELECT "userId" FROM "forum_view_events" WHERE "createdAt" >= ${since}
      ) a
    `);
        return this.n(row.n);
    }
    async getLoginsToday() {
        return this.wrap("Today's logins fetched successfully", async () => {
            const rows = await this.read(client_1.Prisma.sql `
        SELECT le."userId", u."firstName", u."lastName", u."email",
               le."ipAddress", le."userAgent", le."createdAt"
          FROM "login_events" le
          JOIN "users" u ON u."id" = le."userId"
         WHERE le."createdAt" >= date_trunc('day', now())
         ORDER BY le."createdAt" DESC
      `);
            const distinct = new Set(rows.map((r) => r.userId)).size;
            return {
                totalLogins: rows.length,
                distinctUsers: distinct,
                logins: rows.map((r) => ({
                    userId: r.userId,
                    name: `${r.firstName} ${r.lastName}`,
                    email: r.email,
                    at: r.createdAt,
                    ip: r.ipAddress,
                    device: this.parseDevice(r.userAgent),
                })),
            };
        });
    }
    async getLoginsTrend(days) {
        return this.wrap('Login trend fetched successfully', async () => {
            const rows = await this.read(client_1.Prisma.sql `
        SELECT date_trunc('day', "createdAt") AS day,
               COUNT(*) AS logins,
               COUNT(DISTINCT "userId") AS users
          FROM "login_events"
         WHERE "createdAt" >= now() - make_interval(days => ${days}::int)
         GROUP BY 1
         ORDER BY 1
      `);
            return {
                days,
                series: rows.map((r) => ({
                    date: r.day,
                    logins: this.n(r.logins),
                    distinctUsers: this.n(r.users),
                })),
            };
        });
    }
    async getRecentLogins(params) {
        return this.wrap('Recent logins fetched successfully', async () => {
            const limit = Math.min(Math.max(params.limit, 1), 100);
            const rows = await this.prisma.loginEvent.findMany({
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: limit + 1,
                include: {
                    user: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                },
                ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
            });
            const hasMore = rows.length > limit;
            const data = hasMore ? rows.slice(0, limit) : rows;
            return {
                data: data.map((r) => ({
                    id: r.id,
                    userId: r.userId,
                    name: r.user ? `${r.user.firstName} ${r.user.lastName}` : null,
                    email: r.user?.email ?? null,
                    at: r.createdAt,
                    ip: r.ipAddress,
                    device: this.parseDevice(r.userAgent),
                })),
                nextCursor: hasMore ? data[data.length - 1].id : null,
            };
        });
    }
    async getLoginBreakdown(days) {
        return this.wrap('Login breakdown fetched successfully', async () => {
            const rows = await this.read(client_1.Prisma.sql `
          SELECT "userAgent", "ipAddress" FROM "login_events"
           WHERE "createdAt" >= now() - make_interval(days => ${days}::int)
        `);
            const byDevice = new Map();
            const byBrowser = new Map();
            for (const r of rows) {
                const d = this.parseDevice(r.userAgent);
                byDevice.set(d.os, (byDevice.get(d.os) ?? 0) + 1);
                byBrowser.set(d.browser, (byBrowser.get(d.browser) ?? 0) + 1);
            }
            return {
                days,
                totalLogins: rows.length,
                byOs: this.tally(byDevice),
                byBrowser: this.tally(byBrowser),
            };
        });
    }
    async getActivityFeed(params) {
        return this.wrap('Activity feed fetched successfully', async () => {
            const limit = Math.min(Math.max(params.limit, 1), 100);
            const userFilter = params.userId
                ? client_1.Prisma.sql `AND a."userId" = ${params.userId}`
                : client_1.Prisma.empty;
            const cursorFilter = params.cursor
                ? client_1.Prisma.sql `AND a."occurredAt" < ${new Date(params.cursor)}`
                : client_1.Prisma.empty;
            const rows = await this.read(client_1.Prisma.sql `
        WITH a AS (
          SELECT "userId", 'SECTION_PROGRESS' AS type, "courseId", NULL::text AS detail, "updatedAt" AS "occurredAt", NULL::text AS "threadId"
            FROM "UserCourseProgress"
          UNION ALL
          SELECT "userId", 'SECTION_VIEW', "courseId", NULL, "updatedAt", NULL FROM "LastSeenSection"
          UNION ALL
          SELECT qp."userId", 'QUIZ', m."courseId",
                 CASE WHEN qp."isPassed" THEN 'passed' ELSE 'attempted' END, qp."updatedAt", NULL
            FROM "quiz_progress" qp
            JOIN "chapters" c ON c."id" = qp."chapterId"
            JOIN "modules" m ON m."id" = c."moduleId"
          UNION ALL
          SELECT aa."userId", 'ASSESSMENT', ass."courseId",
                 aa."status"::text, GREATEST(aa."updatedAt", aa."startedAt"), NULL
            FROM "assessment_attempts" aa
            JOIN "assessments" ass ON ass."id" = aa."assessmentId"
          UNION ALL
          SELECT s."studentId", 'ASSIGNMENT', ag."courseId", s."status"::text, s."updatedAt", NULL
            FROM "assignment_submissions" s
            JOIN "assignments" ag ON ag."id" = s."assignmentId"
          UNION ALL
          SELECT "userId", 'FORUM_THREAD', "courseId", "title", "createdAt", "id" FROM "forum_threads"
          UNION ALL
          SELECT fc."userId", 'FORUM_COMMENT', ft."courseId", left(fc."content", 80), fc."createdAt", fc."threadId"
            FROM "forum_comments" fc
            JOIN "forum_threads" ft ON ft."id" = fc."threadId"
          UNION ALL
          SELECT fv."userId",
                 CASE WHEN fv."scope" = 'list' THEN 'FORUM_LIST' ELSE 'FORUM_VIEW' END,
                 fv."courseId",
                 CASE WHEN fv."scope" = 'list' THEN 'Opened forum' ELSE COALESCE(ft."title", 'Viewed thread') END,
                 fv."createdAt",
                 fv."threadId"
            FROM "forum_view_events" fv
            LEFT JOIN "forum_threads" ft ON ft."id" = fv."threadId"
          UNION ALL
          SELECT "userId", 'COURSE_COMPLETED', "courseId",
                 CASE WHEN "isPassed" THEN 'passed' ELSE 'completed' END, COALESCE("assessmentPassedAt", "updatedAt"), NULL
            FROM "course_completions"
        )
        SELECT a."userId", a."type", a."courseId", a."detail", a."occurredAt", a."threadId",
               u."firstName", u."lastName", u."email", c."title" AS "courseTitle"
          FROM a
          JOIN "users" u ON u."id" = a."userId"
          LEFT JOIN "courses" c ON c."id" = a."courseId"
         WHERE a."occurredAt" >= now() - make_interval(days => ${params.days}::int)
           ${userFilter}
           ${cursorFilter}
         ORDER BY a."occurredAt" DESC
         LIMIT ${limit + 1}
      `);
            const hasMore = rows.length > limit;
            const data = hasMore ? rows.slice(0, limit) : rows;
            return {
                days: params.days,
                data: data.map((r) => ({
                    userId: r.userId,
                    name: r.firstName ? `${r.firstName} ${r.lastName}` : null,
                    email: r.email,
                    type: r.type,
                    courseId: r.courseId,
                    courseTitle: r.courseTitle,
                    threadId: r.threadId,
                    detail: r.detail,
                    at: r.occurredAt,
                })),
                nextCursor: hasMore
                    ? data[data.length - 1].occurredAt.toISOString()
                    : null,
            };
        });
    }
    async getForumViews(params) {
        return this.wrap('Forum views fetched successfully', async () => {
            const limit = Math.min(Math.max(params.limit, 1), 100);
            const userFilter = params.userId
                ? client_1.Prisma.sql `AND fv."userId" = ${params.userId}`
                : client_1.Prisma.empty;
            const threadFilter = params.threadId
                ? client_1.Prisma.sql `AND fv."threadId" = ${params.threadId}`
                : client_1.Prisma.empty;
            const scopeFilter = params.scope === 'list'
                ? client_1.Prisma.sql `AND fv."scope" = 'list'::"ForumViewScope"`
                : params.scope === 'thread'
                    ? client_1.Prisma.sql `AND fv."scope" = 'thread'::"ForumViewScope"`
                    : client_1.Prisma.empty;
            const cursorFilter = params.cursor
                ? client_1.Prisma.sql `AND fv."createdAt" < ${new Date(params.cursor)}`
                : client_1.Prisma.empty;
            const rows = await this.read(client_1.Prisma.sql `
        SELECT fv."id", fv."userId", fv."threadId", fv."courseId", fv."scope"::text,
               fv."createdAt", u."firstName", u."lastName", u."email",
               ft."title" AS "threadTitle", c."title" AS "courseTitle"
          FROM "forum_view_events" fv
          JOIN "users" u ON u."id" = fv."userId"
          LEFT JOIN "forum_threads" ft ON ft."id" = fv."threadId"
          LEFT JOIN "courses" c ON c."id" = fv."courseId"
         WHERE fv."createdAt" >= now() - make_interval(days => ${params.days}::int)
           ${userFilter}
           ${threadFilter}
           ${scopeFilter}
           ${cursorFilter}
         ORDER BY fv."createdAt" DESC
         LIMIT ${limit + 1}
      `);
            const hasMore = rows.length > limit;
            const slice = hasMore ? rows.slice(0, limit) : rows;
            return {
                days: params.days,
                data: slice.map((r) => ({
                    id: r.id,
                    userId: r.userId,
                    name: r.firstName ? `${r.firstName} ${r.lastName}` : null,
                    email: r.email,
                    scope: r.scope,
                    threadId: r.threadId,
                    threadTitle: r.threadTitle,
                    courseId: r.courseId,
                    courseTitle: r.courseTitle,
                    at: r.createdAt,
                })),
                nextCursor: hasMore
                    ? slice[slice.length - 1].createdAt.toISOString()
                    : null,
            };
        });
    }
    async getDailyActiveUsers(days) {
        return this.wrap('Daily active users fetched successfully', async () => {
            const rows = await this.read(client_1.Prisma.sql `
        SELECT date_trunc('day', "occurredAt") AS day, COUNT(DISTINCT "userId") AS users
          FROM (
            SELECT "userId", "updatedAt" AS "occurredAt" FROM "UserCourseProgress"
            UNION ALL SELECT "userId", "updatedAt" FROM "LastSeenSection"
            UNION ALL SELECT "userId", "updatedAt" FROM "quiz_progress"
            UNION ALL SELECT "userId", "updatedAt" FROM "assessment_attempts"
            UNION ALL SELECT "studentId", "updatedAt" FROM "assignment_submissions"
            UNION ALL SELECT "userId", "updatedAt" FROM "section_time_spent"
            UNION ALL SELECT "userId", "createdAt" AS "updatedAt" FROM "forum_view_events"
          ) a
         WHERE "occurredAt" >= now() - make_interval(days => ${days}::int)
         GROUP BY 1
         ORDER BY 1
      `);
            return {
                days,
                series: rows.map((r) => ({
                    date: r.day,
                    activeUsers: this.n(r.users),
                })),
            };
        });
    }
    async getCompletions(params) {
        return this.wrap('Completions fetched successfully', async () => {
            const limit = Math.min(Math.max(params.limit, 1), 100);
            const where = {
                courseCompletedAt: { not: null },
            };
            if (params.courseId)
                where.courseId = params.courseId;
            if (params.passed !== undefined)
                where.isPassed = params.passed;
            if (params.from || params.to) {
                where.courseCompletedAt = {
                    not: null,
                    ...(params.from ? { gte: new Date(params.from) } : {}),
                    ...(params.to ? { lte: new Date(params.to) } : {}),
                };
            }
            const rows = await this.prisma.courseCompletion.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: limit + 1,
                include: {
                    user: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                    course: { select: { id: true, title: true } },
                },
                ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
            });
            const hasMore = rows.length > limit;
            const data = hasMore ? rows.slice(0, limit) : rows;
            return {
                data: data.map((r) => ({
                    id: r.id,
                    userId: r.userId,
                    name: r.user ? `${r.user.firstName} ${r.user.lastName}` : null,
                    email: r.user?.email ?? null,
                    courseId: r.courseId,
                    courseTitle: r.course?.title ?? null,
                    completedAt: r.courseCompletedAt,
                    assessmentPassed: r.isPassed,
                    assessmentPassedAt: r.assessmentPassedAt,
                    certificateUrl: r.certificateUrl,
                })),
                nextCursor: hasMore ? data[data.length - 1].id : null,
            };
        });
    }
    async getCompletionsByCourse() {
        return this.wrap('Course funnel fetched successfully', async () => {
            const rows = await this.read(client_1.Prisma.sql `
        SELECT c."id" AS "courseId", c."title",
               COUNT(DISTINCT uc."userId") AS enrolled,
               COUNT(DISTINCT uc."userId") FILTER (WHERE uc."isActive") AS activated,
               COUNT(DISTINCT started."userId") AS started,
               COUNT(DISTINCT cc."userId") FILTER (WHERE cc."courseCompletedAt" IS NOT NULL) AS completed
          FROM "courses" c
          LEFT JOIN "user_courses" uc ON uc."courseId" = c."id"
          LEFT JOIN (
            SELECT "userId", "courseId" FROM "UserCourseProgress"
            UNION SELECT "userId", "courseId" FROM "LastSeenSection"
          ) started ON started."courseId" = c."id" AND started."userId" = uc."userId"
          LEFT JOIN "course_completions" cc ON cc."courseId" = c."id" AND cc."userId" = uc."userId"
         WHERE c."isActive" = true
         GROUP BY c."id", c."title"
         ORDER BY enrolled DESC
      `);
            return {
                courses: rows.map((r) => {
                    const enrolled = this.n(r.enrolled);
                    const completed = this.n(r.completed);
                    return {
                        courseId: r.courseId,
                        title: r.title,
                        enrolled,
                        activated: this.n(r.activated),
                        started: this.n(r.started),
                        completed,
                        completionRatePct: enrolled > 0 ? Math.round((completed / enrolled) * 100) : 0,
                    };
                }),
            };
        });
    }
    async getEngagementCohorts() {
        return this.wrap('Engagement cohorts fetched successfully', async () => {
            const neverStartedDays = this.num(engagement_constants_1.ENGAGEMENT_ENV.neverStartedDays, engagement_constants_1.ENGAGEMENT_DEFAULTS.neverStartedDays);
            const stalledDays = this.num(engagement_constants_1.ENGAGEMENT_ENV.stalledDays, engagement_constants_1.ENGAGEMENT_DEFAULTS.stalledDays);
            const [never] = await this.read(client_1.Prisma.sql `
        ${this.activityRollupCte()}
        SELECT COUNT(*) AS n
          FROM "user_courses" uc
          JOIN "users" u ON u."id" = uc."userId"
          JOIN "courses" c ON c."id" = uc."courseId"
          LEFT JOIN "course_completions" cc ON cc."userId" = uc."userId" AND cc."courseId" = uc."courseId"
          LEFT JOIN activity_rollup ar ON ar."userId" = uc."userId" AND ar."courseId" = uc."courseId"
         WHERE c."isActive" AND uc."isActive" AND u."status" = 'active' AND u."deletedAt" IS NULL
           AND cc."id" IS NULL AND ar."userId" IS NULL
           AND COALESCE(uc."activatedAt", uc."updatedAt") < now() - make_interval(days => ${neverStartedDays}::int)
      `);
            const [stalled] = await this.read(client_1.Prisma.sql `
        ${this.activityRollupCte()}
        SELECT COUNT(*) AS n
          FROM "user_courses" uc
          JOIN "users" u ON u."id" = uc."userId"
          JOIN "courses" c ON c."id" = uc."courseId"
          JOIN activity_rollup ar ON ar."userId" = uc."userId" AND ar."courseId" = uc."courseId"
          LEFT JOIN "course_completions" cc ON cc."userId" = uc."userId" AND cc."courseId" = uc."courseId"
         WHERE c."isActive" AND uc."isActive" AND u."status" = 'active' AND u."deletedAt" IS NULL
           AND cc."id" IS NULL
           AND ar.last_at < now() - make_interval(days => ${stalledDays}::int)
      `);
            return {
                thresholds: { neverStartedDays, stalledDays },
                neverStarted: this.n(never.n),
                stalled: this.n(stalled.n),
            };
        });
    }
    async getEngagementSent(params) {
        return this.wrap('Engagement send log fetched successfully', async () => {
            const limit = Math.min(Math.max(params.limit, 1), 100);
            const where = { type: 'ENGAGEMENT_REMINDER' };
            if (params.from || params.to) {
                where.createdAt = {};
                if (params.from)
                    where.createdAt.gte = new Date(params.from);
                if (params.to)
                    where.createdAt.lte = new Date(params.to);
            }
            const rows = await this.prisma.emailLog.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: limit + 1,
                include: {
                    user: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                },
                ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
            });
            const hasMore = rows.length > limit;
            const data = hasMore ? rows.slice(0, limit) : rows;
            return {
                data: data.map((r) => ({
                    id: r.id,
                    userId: r.userId,
                    name: r.user ? `${r.user.firstName} ${r.user.lastName}` : null,
                    email: r.recipient,
                    status: r.status,
                    reminderType: r.metadata?.reminderType ??
                        null,
                    courseTitle: r.metadata?.courseTitle ??
                        null,
                    error: r.error,
                    at: r.createdAt,
                })),
                nextCursor: hasMore ? data[data.length - 1].id : null,
            };
        });
    }
    async getPasswordEvents(params) {
        return this.wrap('Password events fetched successfully', async () => {
            const limit = Math.min(Math.max(params.limit, 1), 100);
            const where = {};
            if (params.from || params.to) {
                where.createdAt = {};
                if (params.from)
                    where.createdAt.gte = new Date(params.from);
                if (params.to)
                    where.createdAt.lte = new Date(params.to);
            }
            const rows = await this.prisma.securityEvent.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: limit + 1,
                include: {
                    user: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                },
                ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
            });
            const hasMore = rows.length > limit;
            const data = hasMore ? rows.slice(0, limit) : rows;
            return {
                data: data.map((r) => ({
                    id: r.id,
                    userId: r.userId,
                    name: r.user ? `${r.user.firstName} ${r.user.lastName}` : null,
                    email: r.user?.email ?? null,
                    kind: r.type,
                    at: r.createdAt,
                })),
                nextCursor: hasMore ? data[data.length - 1].id : null,
            };
        });
    }
    async getPendingFirstLogin() {
        return this.wrap('Pending first-login accounts fetched successfully', async () => {
            const rows = await this.prisma.user.findMany({
                where: { mustChangePassword: true, deletedAt: null },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    status: true,
                    createdAt: true,
                },
                orderBy: { createdAt: 'desc' },
                take: 200,
            });
            return {
                count: rows.length,
                users: rows.map((u) => ({
                    id: u.id,
                    name: `${u.firstName} ${u.lastName}`,
                    email: u.email,
                    status: u.status,
                    createdAt: u.createdAt,
                })),
            };
        });
    }
    async getRecentAccounts(days) {
        return this.wrap('Recent accounts fetched successfully', async () => {
            const since = new Date(Date.now() - days * 86400000);
            const rows = await this.prisma.user.findMany({
                where: { createdAt: { gte: since }, deletedAt: null },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    role: true,
                    status: true,
                    mustChangePassword: true,
                    createdAt: true,
                },
                orderBy: { createdAt: 'desc' },
                take: 200,
            });
            return {
                days,
                count: rows.length,
                users: rows.map((u) => ({
                    id: u.id,
                    name: `${u.firstName} ${u.lastName}`,
                    email: u.email,
                    role: u.role,
                    status: u.status,
                    pendingFirstLogin: u.mustChangePassword,
                    createdAt: u.createdAt,
                })),
            };
        });
    }
    async getTimeLeaderboard(params) {
        return this.wrap('Time leaderboard fetched successfully', async () => {
            const limit = Math.min(Math.max(params.limit, 1), 100);
            const days = Math.min(Math.max(params.days, 1), 90);
            const courseFilter = params.courseId
                ? client_1.Prisma.sql `WHERE sts."courseId" = ${params.courseId}`
                : client_1.Prisma.empty;
            const rows = await this.read(client_1.Prisma.sql `
        SELECT sts."userId", u."firstName", u."lastName", u."email",
               SUM(sts."totalSeconds")::bigint AS total_seconds,
               COUNT(DISTINCT sts."courseId") AS courses
          FROM "section_time_spent" sts
          JOIN "users" u ON u."id" = sts."userId"
          ${courseFilter}
         GROUP BY sts."userId", u."firstName", u."lastName", u."email"
         ORDER BY total_seconds DESC
         LIMIT ${limit}
      `);
            const userIds = rows.map((r) => r.userId);
            const dailyByUser = new Map();
            if (userIds.length > 0) {
                const courseDailyFilter = params.courseId
                    ? client_1.Prisma.sql `AND std."courseId" = ${params.courseId}`
                    : client_1.Prisma.empty;
                const dailyRows = await this.read(client_1.Prisma.sql `
          SELECT std."userId",
                 std."day",
                 SUM(std."totalSeconds")::bigint AS total_seconds
            FROM "section_time_spent_daily" std
           WHERE std."userId" IN (${client_1.Prisma.join(userIds)})
             AND std."day" >= (CURRENT_DATE - make_interval(days => ${days - 1}::int))::date
             ${courseDailyFilter}
           GROUP BY std."userId", std."day"
           ORDER BY std."userId", std."day" DESC
        `);
                for (const d of dailyRows) {
                    const list = dailyByUser.get(d.userId) ?? [];
                    list.push({
                        day: d.day.toISOString().slice(0, 10),
                        totalSeconds: this.n(d.total_seconds),
                    });
                    dailyByUser.set(d.userId, list);
                }
            }
            return {
                courseId: params.courseId ?? null,
                days,
                leaderboard: rows.map((r, i) => ({
                    rank: i + 1,
                    userId: r.userId,
                    name: `${r.firstName} ${r.lastName}`,
                    email: r.email,
                    totalSeconds: this.n(r.total_seconds),
                    totalHours: Math.round((this.n(r.total_seconds) / 3600) * 10) / 10,
                    coursesTouched: this.n(r.courses),
                    dailyBreakdown: dailyByUser.get(r.userId) ?? [],
                })),
            };
        });
    }
    activityRollupCte() {
        return client_1.Prisma.sql `
      WITH activity AS (
        SELECT "userId", "courseId", MAX("updatedAt") AS last_at FROM "UserCourseProgress" GROUP BY 1, 2
        UNION ALL SELECT "userId", "courseId", MAX("updatedAt") FROM "LastSeenSection" GROUP BY 1, 2
        UNION ALL SELECT qp."userId", m."courseId", MAX(qp."updatedAt")
          FROM "quiz_progress" qp
          JOIN "chapters" c ON c."id" = qp."chapterId"
          JOIN "modules" m ON m."id" = c."moduleId" GROUP BY 1, 2
        UNION ALL SELECT aa."userId", a."courseId", MAX(GREATEST(aa."updatedAt", aa."startedAt"))
          FROM "assessment_attempts" aa
          JOIN "assessments" a ON a."id" = aa."assessmentId" GROUP BY 1, 2
        UNION ALL SELECT s."studentId", a."courseId", MAX(s."updatedAt")
          FROM "assignment_submissions" s
          JOIN "assignments" a ON a."id" = s."assignmentId" GROUP BY 1, 2
      ), activity_rollup AS (
        SELECT "userId", "courseId", MAX(last_at) AS last_at FROM activity GROUP BY 1, 2
      )`;
    }
    read(sql) {
        return (0, with_db_retry_1.withDbRetry)(() => this.prisma.$queryRaw(sql), {
            mode: 'read',
        });
    }
    async wrap(message, fn) {
        try {
            const data = await fn();
            return { message, statusCode: 200, data };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.INTERNAL_SERVER_ERROR,
                error: error?.message || 'Failed to fetch dashboard data',
            }, common_1.HttpStatus.INTERNAL_SERVER_ERROR, { cause: error });
        }
    }
    n(v) {
        return v == null ? 0 : Number(v);
    }
    num(envKey, fallback) {
        const raw = this.config.get(envKey);
        const n = raw ? Number(raw) : NaN;
        return Number.isFinite(n) && n > 0 ? n : fallback;
    }
    tally(m) {
        return [...m.entries()]
            .map(([label, count]) => ({ label, count }))
            .sort((a, b) => b.count - a.count);
    }
    parseDevice(ua) {
        if (!ua)
            return { os: 'Unknown', browser: 'Unknown' };
        const os = /Windows/i.test(ua)
            ? 'Windows'
            : /Mac OS X|Macintosh/i.test(ua)
                ? 'macOS'
                : /Android/i.test(ua)
                    ? 'Android'
                    : /iPhone|iPad|iOS/i.test(ua)
                        ? 'iOS'
                        : /Linux/i.test(ua)
                            ? 'Linux'
                            : 'Other';
        const browser = /Edg\//i.test(ua)
            ? 'Edge'
            : /OPR\/|Opera/i.test(ua)
                ? 'Opera'
                : /Chrome\//i.test(ua)
                    ? 'Chrome'
                    : /Firefox\//i.test(ua)
                        ? 'Firefox'
                        : /Safari\//i.test(ua)
                            ? 'Safari'
                            : 'Other';
        return { os, browser };
    }
};
exports.AdminDashboardService = AdminDashboardService;
exports.AdminDashboardService = AdminDashboardService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], AdminDashboardService);
//# sourceMappingURL=admin-dashboard.service.js.map