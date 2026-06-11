import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { withDbRetry } from '../utils/with-db-retry';
import { ResponseDto } from '../dto';
import {
  ENGAGEMENT_DEFAULTS,
  ENGAGEMENT_ENV,
} from '../engagement/engagement.constants';

/**
 * Read-only analytics for the admin dashboard. All queries are sequential
 * (Neon connection_limit=1 — no $transaction([]) / parallel awaits) and raw
 * SQL is wrapped in withDbRetry({mode:'read'}) since $queryRaw isn't covered by
 * the Prisma retry middleware. Counts use COUNT(*) FILTER (...) to collapse
 * round-trips. Lists use keyset pagination on (createdAt desc, id desc).
 */
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────
  // OVERVIEW
  // ────────────────────────────────────────────────────────────────────────

  async getOverview(): Promise<ResponseDto> {
    return this.wrap('Overview fetched successfully', async () => {
      // One row of user/account counts.
      const [users] = await this.read<
        {
          total: bigint;
          active: bigint;
          inactive: bigint;
          admins: bigint;
          students: bigint;
          pending_first_login: bigint;
          new_this_week: bigint;
        }[]
      >(Prisma.sql`
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

      const [enroll] = await this.read<
        { active: bigint; assigned_inactive: bigint; paid: bigint }[]
      >(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE "isActive" = true) AS active,
          COUNT(*) FILTER (WHERE "isActive" = false) AS assigned_inactive,
          COUNT(*) FILTER (WHERE "isPaid" = true) AS paid
        FROM "user_courses"
      `);

      const [courses] = await this.read<
        { active_courses: bigint }[]
      >(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE "isActive" = true) AS active_courses FROM "courses"
      `);

      const [logins] = await this.read<
        { today: bigint; week: bigint }[]
      >(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE "createdAt" >= date_trunc('day', now())) AS today,
          COUNT(*) FILTER (WHERE "createdAt" >= now() - interval '7 days') AS week
        FROM "login_events"
      `);

      // "Completed" = content finished (courseCompletedAt set), the criterion for
      // all courses. Assessment pass is a separate signal (many courses have no
      // assessment), reported alongside.
      const [completions] = await this.read<
        { total: bigint; assessment_passed: bigint }[]
      >(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE "courseCompletedAt" IS NOT NULL) AS total,
               COUNT(*) FILTER (WHERE "isPassed" = true) AS assessment_passed
        FROM "course_completions"
      `);

      const [reminders] = await this.read<
        { sent_week: bigint; never_started: bigint; stalled: bigint }[]
      >(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE "createdAt" >= now() - interval '7 days') AS sent_week,
          COUNT(*) FILTER (WHERE "payload"->>'reminderType' = 'never_started') AS never_started,
          COUNT(*) FILTER (WHERE "payload"->>'reminderType' = 'stalled') AS stalled
        FROM "notifications"
        WHERE "type" = 'ENGAGEMENT_REMINDER'
      `);

      // Distinct active learners (any activity signal) today and last 7 days.
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
          total: this.n(completions.total), // content completed
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

  /** Count of distinct users with ANY activity signal in the window. */
  private async distinctActiveUsers(window: 'day' | 'week'): Promise<number> {
    const since =
      window === 'day'
        ? Prisma.sql`date_trunc('day', now())`
        : Prisma.sql`now() - interval '7 days'`;
    const [row] = await this.read<{ n: bigint }[]>(Prisma.sql`
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

  // ────────────────────────────────────────────────────────────────────────
  // LOGINS
  // ────────────────────────────────────────────────────────────────────────

  async getLoginsToday(): Promise<ResponseDto> {
    return this.wrap("Today's logins fetched successfully", async () => {
      const rows = await this.read<
        {
          userId: string;
          firstName: string;
          lastName: string;
          email: string;
          ipAddress: string | null;
          userAgent: string | null;
          createdAt: Date;
        }[]
      >(Prisma.sql`
        SELECT le."userId", u."firstName", u."lastName", u."email",
               le."ipAddress", le."userAgent", le."createdAt"
          FROM "login_events" le
          JOIN "users" u ON u."id" = le."userId"
         WHERE le."createdAt" >= date_trunc('day', now())
         ORDER BY le."createdAt" DESC
      `);
      // Distinct users (a user may log in multiple times today).
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

  async getLoginsTrend(days: number): Promise<ResponseDto> {
    return this.wrap('Login trend fetched successfully', async () => {
      const rows = await this.read<
        { day: Date; logins: bigint; users: bigint }[]
      >(Prisma.sql`
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

  async getRecentLogins(params: {
    cursor?: string;
    limit: number;
  }): Promise<ResponseDto> {
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

  async getLoginBreakdown(days: number): Promise<ResponseDto> {
    return this.wrap('Login breakdown fetched successfully', async () => {
      const rows = await this.read<
        { userAgent: string | null; ipAddress: string | null }[]
      >(
        Prisma.sql`
          SELECT "userAgent", "ipAddress" FROM "login_events"
           WHERE "createdAt" >= now() - make_interval(days => ${days}::int)
        `,
      );
      const byDevice = new Map<string, number>();
      const byBrowser = new Map<string, number>();
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

  // ────────────────────────────────────────────────────────────────────────
  // ACTIVITY
  // ────────────────────────────────────────────────────────────────────────

  async getActivityFeed(params: {
    days: number;
    cursor?: string;
    limit: number;
    userId?: string;
  }): Promise<ResponseDto> {
    return this.wrap('Activity feed fetched successfully', async () => {
      const limit = Math.min(Math.max(params.limit, 1), 100);
      const userFilter = params.userId
        ? Prisma.sql`AND a."userId" = ${params.userId}`
        : Prisma.empty;
      // Cursor is an ISO timestamp (keyset on occurredAt desc). Simpler than a
      // composite id cursor for a UNION feed; ties are acceptable for an audit feed.
      const cursorFilter = params.cursor
        ? Prisma.sql`AND a."occurredAt" < ${new Date(params.cursor)}`
        : Prisma.empty;

      const rows = await this.read<
        {
          userId: string;
          type: string;
          courseId: string | null;
          detail: string | null;
          occurredAt: Date;
          threadId: string | null;
          firstName: string | null;
          lastName: string | null;
          email: string | null;
          courseTitle: string | null;
        }[]
      >(Prisma.sql`
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
         WHERE a."occurredAt" >= now() - make_interval(days => ${
           params.days
         }::int)
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

  /** Paginated log of forum list opens and thread views. */
  async getForumViews(params: {
    days: number;
    cursor?: string;
    limit: number;
    userId?: string;
    threadId?: string;
    scope?: 'list' | 'thread';
  }): Promise<ResponseDto> {
    return this.wrap('Forum views fetched successfully', async () => {
      const limit = Math.min(Math.max(params.limit, 1), 100);
      const userFilter = params.userId
        ? Prisma.sql`AND fv."userId" = ${params.userId}`
        : Prisma.empty;
      const threadFilter = params.threadId
        ? Prisma.sql`AND fv."threadId" = ${params.threadId}`
        : Prisma.empty;
      const scopeFilter =
        params.scope === 'list'
          ? Prisma.sql`AND fv."scope" = 'list'::"ForumViewScope"`
          : params.scope === 'thread'
            ? Prisma.sql`AND fv."scope" = 'thread'::"ForumViewScope"`
            : Prisma.empty;
      const cursorFilter = params.cursor
        ? Prisma.sql`AND fv."createdAt" < ${new Date(params.cursor)}`
        : Prisma.empty;

      const rows = await this.read<
        {
          id: string;
          userId: string;
          threadId: string | null;
          courseId: string | null;
          scope: string;
          createdAt: Date;
          firstName: string | null;
          lastName: string | null;
          email: string | null;
          threadTitle: string | null;
          courseTitle: string | null;
        }[]
      >(Prisma.sql`
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

  async getDailyActiveUsers(days: number): Promise<ResponseDto> {
    return this.wrap('Daily active users fetched successfully', async () => {
      const rows = await this.read<{ day: Date; users: bigint }[]>(Prisma.sql`
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

  // ────────────────────────────────────────────────────────────────────────
  // COMPLETIONS
  // ────────────────────────────────────────────────────────────────────────

  async getCompletions(params: {
    courseId?: string;
    from?: string;
    to?: string;
    passed?: boolean;
    cursor?: string;
    limit: number;
  }): Promise<ResponseDto> {
    return this.wrap('Completions fetched successfully', async () => {
      const limit = Math.min(Math.max(params.limit, 1), 100);
      // "Completed" = content finished. Only list rows that are actually
      // content-complete; date range filters on courseCompletedAt. `passed`
      // optionally narrows to those who also passed the assessment.
      const where: Prisma.CourseCompletionWhereInput = {
        courseCompletedAt: { not: null },
      };
      if (params.courseId) where.courseId = params.courseId;
      if (params.passed !== undefined) where.isPassed = params.passed;
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

  async getCompletionsByCourse(): Promise<ResponseDto> {
    return this.wrap('Course funnel fetched successfully', async () => {
      const rows = await this.read<
        {
          courseId: string;
          title: string;
          enrolled: bigint;
          activated: bigint;
          started: bigint;
          completed: bigint;
        }[]
      >(Prisma.sql`
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
            completionRatePct:
              enrolled > 0 ? Math.round((completed / enrolled) * 100) : 0,
          };
        }),
      };
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // ENGAGEMENT
  // ────────────────────────────────────────────────────────────────────────

  async getEngagementCohorts(): Promise<ResponseDto> {
    return this.wrap('Engagement cohorts fetched successfully', async () => {
      const neverStartedDays = this.num(
        ENGAGEMENT_ENV.neverStartedDays,
        ENGAGEMENT_DEFAULTS.neverStartedDays,
      );
      const stalledDays = this.num(
        ENGAGEMENT_ENV.stalledDays,
        ENGAGEMENT_DEFAULTS.stalledDays,
      );

      const [never] = await this.read<{ n: bigint }[]>(Prisma.sql`
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

      const [stalled] = await this.read<{ n: bigint }[]>(Prisma.sql`
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

  async getEngagementSent(params: {
    from?: string;
    to?: string;
    cursor?: string;
    limit: number;
  }): Promise<ResponseDto> {
    return this.wrap('Engagement send log fetched successfully', async () => {
      const limit = Math.min(Math.max(params.limit, 1), 100);
      const where: Prisma.EmailLogWhereInput = { type: 'ENGAGEMENT_REMINDER' };
      if (params.from || params.to) {
        where.createdAt = {};
        if (params.from) where.createdAt.gte = new Date(params.from);
        if (params.to) where.createdAt.lte = new Date(params.to);
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
          reminderType:
            (r.metadata as { reminderType?: string } | null)?.reminderType ??
            null,
          courseTitle:
            (r.metadata as { courseTitle?: string } | null)?.courseTitle ??
            null,
          error: r.error,
          at: r.createdAt,
        })),
        nextCursor: hasMore ? data[data.length - 1].id : null,
      };
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // SECURITY
  // ────────────────────────────────────────────────────────────────────────

  async getPasswordEvents(params: {
    from?: string;
    to?: string;
    cursor?: string;
    limit: number;
  }): Promise<ResponseDto> {
    return this.wrap('Password events fetched successfully', async () => {
      const limit = Math.min(Math.max(params.limit, 1), 100);
      const where: Prisma.SecurityEventWhereInput = {};
      if (params.from || params.to) {
        where.createdAt = {};
        if (params.from) where.createdAt.gte = new Date(params.from);
        if (params.to) where.createdAt.lte = new Date(params.to);
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

  async getPendingFirstLogin(): Promise<ResponseDto> {
    return this.wrap(
      'Pending first-login accounts fetched successfully',
      async () => {
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
      },
    );
  }

  async getRecentAccounts(days: number): Promise<ResponseDto> {
    return this.wrap('Recent accounts fetched successfully', async () => {
      const since = new Date(Date.now() - days * 86_400_000);
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

  // ────────────────────────────────────────────────────────────────────────
  // TIME-ON-PLATFORM LEADERBOARD
  // ────────────────────────────────────────────────────────────────────────

  async getTimeLeaderboard(params: {
    courseId?: string;
    limit: number;
  }): Promise<ResponseDto> {
    return this.wrap('Time leaderboard fetched successfully', async () => {
      const limit = Math.min(Math.max(params.limit, 1), 100);
      const courseFilter = params.courseId
        ? Prisma.sql`WHERE sts."courseId" = ${params.courseId}`
        : Prisma.empty;
      const rows = await this.read<
        {
          userId: string;
          firstName: string;
          lastName: string;
          email: string;
          total_seconds: bigint;
          courses: bigint;
        }[]
      >(Prisma.sql`
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
      return {
        courseId: params.courseId ?? null,
        leaderboard: rows.map((r, i) => ({
          rank: i + 1,
          userId: r.userId,
          name: `${r.firstName} ${r.lastName}`,
          email: r.email,
          totalSeconds: this.n(r.total_seconds),
          totalHours: Math.round((this.n(r.total_seconds) / 3600) * 10) / 10,
          coursesTouched: this.n(r.courses),
        })),
      };
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ────────────────────────────────────────────────────────────────────────

  /** Shared CTE: per-(userId,courseId) most-recent activity across all signals. */
  private activityRollupCte(): Prisma.Sql {
    return Prisma.sql`
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

  /** Run a raw read query through the retry wrapper (raw SQL isn't auto-retried). */
  private read<T>(sql: Prisma.Sql): Promise<T> {
    return withDbRetry(
      () =>
        this.prisma.$queryRaw<T extends (infer U)[] ? U : never>(
          sql,
        ) as Promise<T>,
      {
        mode: 'read',
      },
    );
  }

  /** Standard envelope + error handling wrapper. */
  private async wrap(
    message: string,
    fn: () => Promise<object>,
  ): Promise<ResponseDto> {
    try {
      const data = await fn();
      return { message, statusCode: 200, data };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error?.message || 'Failed to fetch dashboard data',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
        { cause: error },
      );
    }
  }

  private n(v: bigint | number | null | undefined): number {
    return v == null ? 0 : Number(v);
  }

  private num(envKey: string, fallback: number): number {
    const raw = this.config.get<string>(envKey);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  private tally(m: Map<string, number>): { label: string; count: number }[] {
    return [...m.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }

  /** Minimal, dependency-free UA parse → { os, browser }. Good enough for stats. */
  private parseDevice(ua: string | null): { os: string; browser: string } {
    if (!ua) return { os: 'Unknown', browser: 'Unknown' };
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
}
