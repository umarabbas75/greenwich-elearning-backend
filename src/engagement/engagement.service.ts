import { Injectable, Logger } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { ReminderType } from '../mail/mail.types';
import { withDbRetry } from '../utils/with-db-retry';
import {
  ENGAGEMENT_DEFAULTS,
  ENGAGEMENT_ENV,
  cooldownBucket,
  engagementDedupeKey,
  engagementGroupKey,
} from './engagement.constants';

/** One disengaged (user, course) candidate returned by the detection queries. */
interface Candidate {
  userId: string;
  courseId: string;
  email: string;
  firstName: string;
  courseTitle: string;
  // Personalization fields. Populated per reminder type by the detection query;
  // the other type leaves them null and the template omits them.
  courseDuration?: string | null; // NEVER_STARTED nudge (e.g. "60 Days")
  completedSections?: number | null; // STALLED progress
  totalSections?: number | null; // STALLED progress
}

export interface SweepSummary {
  neverStarted: { candidates: number; notified: number; emailed: number };
  stalled: { candidates: number; notified: number; emailed: number };
  ranAt: string;
}

/**
 * Detects low-engagement students and reminds them via an in-app notification
 * AND a best-effort email. Invoked by a scheduled (Vercel Cron) HTTP call.
 *
 * Design constraints (Neon pooled, connection_limit=1):
 *  - Queries run strictly sequentially (no $transaction([]), no parallel awaits).
 *  - Detection is set-based raw SQL (one query per type), never per-user N+1.
 *  - Each run is bounded by ENGAGEMENT_BATCH_LIMIT to stay within the serverless
 *    function time budget; re-runs are safe (dedupeKey + skipDuplicates).
 *  - $queryRaw is NOT covered by the PrismaService retry middleware, so each raw
 *    query is wrapped in withDbRetry explicitly.
 */
@Injectable()
export class EngagementService {
  private readonly logger = new Logger(EngagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private num(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    const parsed = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private appBaseUrl(): string {
    return (
      this.config.get<string>(ENGAGEMENT_ENV.appBaseUrl) ??
      ENGAGEMENT_DEFAULTS.appBaseUrl
    ).replace(/\/+$/, '');
  }

  private courseUrl(courseId: string): string {
    return `${this.appBaseUrl()}/studentCourses/${courseId}`;
  }

  /**
   * Run the full sweep. `now` is injectable for testing; production passes the
   * real clock. A single `now` drives every cooldown bucket so all keys in this
   * run share a window.
   */
  async runSweep(now: Date = new Date()): Promise<SweepSummary> {
    const limit = Math.trunc(
      this.num(ENGAGEMENT_ENV.batchLimit, ENGAGEMENT_DEFAULTS.batchLimit),
    );
    const neverStartedDays = this.num(
      ENGAGEMENT_ENV.neverStartedDays,
      ENGAGEMENT_DEFAULTS.neverStartedDays,
    );
    const stalledDays = this.num(
      ENGAGEMENT_ENV.stalledDays,
      ENGAGEMENT_DEFAULTS.stalledDays,
    );
    const neverStartedCooldown = this.num(
      ENGAGEMENT_ENV.neverStartedCooldownDays,
      ENGAGEMENT_DEFAULTS.neverStartedCooldownDays,
    );
    const stalledCooldown = this.num(
      ENGAGEMENT_ENV.stalledCooldownDays,
      ENGAGEMENT_DEFAULTS.stalledCooldownDays,
    );

    // Sequential by necessity (connection_limit=1). NEVER_STARTED first so its
    // precedence holds (the queries are disjoint, but order is explicit anyway).
    const neverStartedCandidates = await this.findNeverStarted(
      neverStartedDays,
      limit,
    );
    const neverStarted = await this.dispatch(
      neverStartedCandidates,
      ReminderType.NEVER_STARTED,
      cooldownBucket(now, neverStartedCooldown),
    );

    const stalledCandidates = await this.findStalled(stalledDays, limit);
    const stalled = await this.dispatch(
      stalledCandidates,
      ReminderType.STALLED,
      cooldownBucket(now, stalledCooldown),
    );

    const summary: SweepSummary = {
      neverStarted,
      stalled,
      ranAt: now.toISOString(),
    };
    this.logger.log(
      `Engagement sweep: never_started ${neverStarted.notified}/${neverStarted.candidates} notified, ` +
        `${neverStarted.emailed} emailed; stalled ${stalled.notified}/${stalled.candidates} notified, ` +
        `${stalled.emailed} emailed.`,
    );
    return summary;
  }

  // ──────────────────────────────────────────────────────────────────────
  // DETECTION — set-based raw SQL. The `activity_rollup` CTE unifies all four
  // activity signals into (userId, courseId, last_at). Two of the signals
  // (quiz_progress, assessment_attempts) carry no courseId, so they are joined
  // through chapters→modules and assessments respectively.
  // ──────────────────────────────────────────────────────────────────────

  /** Shared CTE fragment. Inlined into both queries (kept as a constant for parity). */
  private static readonly ACTIVITY_CTE = Prisma.sql`
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

  private async findNeverStarted(
    daysEnrolled: number,
    limit: number,
  ): Promise<Candidate[]> {
    // Cast to int: Prisma binds JS numbers as bigint, but make_interval's `days`
    // arg is integer and Postgres won't implicitly narrow bigint→integer for a
    // named-arg call (error 42883). Explicit ::int makes the signature match.
    const cutoff = Prisma.sql`(now() - make_interval(days => ${daysEnrolled}::int))`;
    return withDbRetry(
      () =>
        this.prisma.$queryRaw<Candidate[]>`
          ${EngagementService.ACTIVITY_CTE}
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
        `,
      { mode: 'read' },
    );
  }

  private async findStalled(
    daysInactive: number,
    limit: number,
  ): Promise<Candidate[]> {
    // See findNeverStarted: ::int cast required so make_interval's signature
    // matches (Prisma binds the number as bigint otherwise → error 42883).
    const cutoff = Prisma.sql`(now() - make_interval(days => ${daysInactive}::int))`;
    return withDbRetry(
      () =>
        this.prisma.$queryRaw<Candidate[]>`
          ${EngagementService.ACTIVITY_CTE}
          SELECT uc."userId"   AS "userId",
                 uc."courseId" AS "courseId",
                 u."email"     AS "email",
                 u."firstName" AS "firstName",
                 c."title"     AS "courseTitle",
                 -- Progress = distinct sections the user has progressed through.
                 (SELECT COUNT(DISTINCT ucp."sectionId")
                    FROM "UserCourseProgress" ucp
                   WHERE ucp."userId" = uc."userId"
                     AND ucp."courseId" = uc."courseId")::int AS "completedSections",
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
        `,
      { mode: 'read' },
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // DISPATCH — write in-app notifications (idempotency anchor) first, then send
  // best-effort emails for the rows that were newly inserted this run.
  // ──────────────────────────────────────────────────────────────────────

  private async dispatch(
    candidates: Candidate[],
    reminderType: ReminderType,
    bucket: number,
  ): Promise<{ candidates: number; notified: number; emailed: number }> {
    if (candidates.length === 0) {
      return { candidates: 0, notified: 0, emailed: 0 };
    }

    const message =
      reminderType === ReminderType.NEVER_STARTED
        ? 'You have enrolled in a course but have not started yet.'
        : 'You have not been active in your course recently — pick up where you left off.';

    const rows: Prisma.NotificationCreateManyInput[] = candidates.map((c) => ({
      userId: c.userId,
      type: NotificationType.ENGAGEMENT_REMINDER,
      message,
      payload: {
        reminderType,
        courseId: c.courseId,
        courseTitle: c.courseTitle,
      },
      groupKey: engagementGroupKey(reminderType, c.courseId),
      dedupeKey: engagementDedupeKey({
        reminderType,
        courseId: c.courseId,
        userId: c.userId,
        bucket,
      }),
      referenceId: c.courseId,
    }));

    // Single bulk insert; skipDuplicates makes the (userId, dedupeKey) partial
    // unique index suppress anyone already reminded in this cooldown window.
    const inserted = await withDbRetry(
      () =>
        this.prisma.notification.createMany({
          data: rows,
          skipDuplicates: true,
        }),
      { mode: 'write' },
    );

    // createMany returns only a count, not which rows were new. To email exactly
    // the freshly-reminded users (not the suppressed duplicates), re-read this
    // run's dedupeKeys and keep those created in this sweep. One extra read,
    // bounded by the batch size — acceptable under connection_limit=1.
    let emailed = 0;
    if (inserted.count > 0 && this.mail.isEnabled) {
      const freshKeys = await this.freshlyInsertedKeys(rows);
      const toEmail = candidates.filter((c) =>
        freshKeys.has(
          engagementDedupeKey({
            reminderType,
            courseId: c.courseId,
            userId: c.userId,
            bucket,
          }),
        ),
      );
      emailed = await this.sendEmails(toEmail, reminderType);
    }

    return {
      candidates: candidates.length,
      notified: inserted.count,
      emailed,
    };
  }

  /**
   * Sends reminder emails in small batches, throttled to stay under Resend's
   * rate limit (2 requests/second). Each batch of `emailConcurrency` is sent
   * concurrently, then we pause `emailBatchPauseMs` before the next. Any send
   * that fails with a rate-limit error is retried once after a longer backoff.
   * These are HTTP calls (not DB), so they never touch the connection_limit=1
   * Postgres pool. Returns the count successfully sent.
   */
  private async sendEmails(
    recipients: Candidate[],
    reminderType: ReminderType,
  ): Promise<number> {
    const batchSize = Math.max(
      1,
      Math.trunc(
        this.num(
          ENGAGEMENT_ENV.emailConcurrency,
          ENGAGEMENT_DEFAULTS.emailConcurrency,
        ),
      ),
    );
    const pauseMs = ENGAGEMENT_DEFAULTS.emailBatchPauseMs;

    const sendOne = (c: Candidate) =>
      this.mail.sendEngagementReminder({
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
    const rateLimited: Candidate[] = [];

    for (let i = 0; i < recipients.length; i += batchSize) {
      const chunk = recipients.slice(i, i + batchSize);
      const results = await Promise.all(chunk.map(sendOne));
      results.forEach((r, idx) => {
        if (r.sent) sent += 1;
        else if (r.reason && /rate.?limit/i.test(r.reason))
          rateLimited.push(chunk[idx]);
      });
      // Throttle between batches to respect Resend's 2 req/s ceiling.
      if (i + batchSize < recipients.length) await this.sleep(pauseMs);
    }

    // One retry pass for rate-limited sends, after a longer cooldown.
    if (rateLimited.length > 0) {
      await this.sleep(pauseMs * 2);
      for (let i = 0; i < rateLimited.length; i += batchSize) {
        const chunk = rateLimited.slice(i, i + batchSize);
        const results = await Promise.all(chunk.map(sendOne));
        sent += results.filter((r) => r.sent).length;
        if (i + batchSize < rateLimited.length) await this.sleep(pauseMs);
      }
    }

    return sent;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Returns the dedupeKeys among `rows` whose notification row's createdAt falls
   * within the last few minutes — i.e. inserted by THIS run rather than a prior
   * one. This distinguishes new sends from skipDuplicates no-ops so we email
   * only once per cooldown window.
   */
  private async freshlyInsertedKeys(
    rows: Prisma.NotificationCreateManyInput[],
  ): Promise<Set<string>> {
    const keys = rows
      .map((r) => r.dedupeKey)
      .filter((k): k is string => typeof k === 'string');
    if (keys.length === 0) return new Set();

    const found = await withDbRetry(
      () =>
        this.prisma.notification.findMany({
          where: {
            dedupeKey: { in: keys },
            createdAt: { gte: new Date(Date.now() - 5 * 60_000) },
          },
          select: { dedupeKey: true },
        }),
      { mode: 'read' },
    );
    return new Set(
      found
        .map((f) => f.dedupeKey)
        .filter((k): k is string => typeof k === 'string'),
    );
  }
}
