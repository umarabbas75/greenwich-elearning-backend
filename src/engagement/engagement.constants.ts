import { ReminderType } from '../mail/mail.types';

/**
 * Pure configuration + key derivation for the engagement sweep. No I/O here so
 * the cadence logic (the correctness-critical part) is trivially unit-testable.
 */

/** Env var names (read via ConfigService in the service). */
export const ENGAGEMENT_ENV = {
  /** Days enrolled with zero activity before a NEVER_STARTED reminder. */
  neverStartedDays: 'ENGAGEMENT_NEVER_STARTED_DAYS',
  /** Days of inactivity before a STALLED reminder. */
  stalledDays: 'ENGAGEMENT_STALLED_DAYS',
  /** Cooldown windows controlling how often the same user/course can be re-reminded. */
  neverStartedCooldownDays: 'ENGAGEMENT_NEVER_STARTED_COOLDOWN_DAYS',
  stalledCooldownDays: 'ENGAGEMENT_STALLED_COOLDOWN_DAYS',
  /** Max candidate rows processed per reminder type per cron run (serverless time bound). */
  batchLimit: 'ENGAGEMENT_BATCH_LIMIT',
  /** Max concurrent Resend sends within a run. */
  emailConcurrency: 'ENGAGEMENT_EMAIL_CONCURRENCY',
  /** Public app base URL used to build course deep links in emails. */
  appBaseUrl: 'APP_BASE_URL',
} as const;

export const ENGAGEMENT_DEFAULTS = {
  neverStartedDays: 3,
  stalledDays: 7,
  neverStartedCooldownDays: 3,
  stalledCooldownDays: 7,
  // Kept conservative so a single cron run's email fan-out stays well inside the
  // Vercel function time budget (and under Resend's daily quota). Raise once
  // volume + send latency are observed.
  batchLimit: 50,
  // Max concurrent Resend sends. These are HTTP calls (not DB), so parallelism
  // here does not contend with the connection_limit=1 Postgres pool.
  emailConcurrency: 5,
  appBaseUrl: 'https://www.greenwichtc-elearning.com',
} as const;

const MS_PER_DAY = 86_400_000;

/**
 * Deterministic cooldown bucket: floor(epochDays / cooldownDays). Computed once
 * per run from a single `now` so every key in the run shares the same bucket.
 * Re-runs within the same window produce identical dedupeKeys (insert no-ops via
 * the partial unique index = cooldown); the next window increments the bucket and
 * allows a fresh reminder if the user is still disengaged.
 */
export function cooldownBucket(now: Date, cooldownDays: number): number {
  const epochDays = Math.floor(now.getTime() / MS_PER_DAY);
  return Math.floor(epochDays / Math.max(1, cooldownDays));
}

/**
 * Per-recipient idempotency key consumed by the partial unique index
 * (userId, dedupeKey) on notifications. Format:
 *   engagement:<reminderType>:<courseId>:<userId>:<bucket>
 */
export function engagementDedupeKey(args: {
  reminderType: ReminderType;
  courseId: string;
  userId: string;
  bucket: number;
}): string {
  return `engagement:${args.reminderType}:${args.courseId}:${args.userId}:${args.bucket}`;
}

/** Stable collapse key so the FE bell groups a user's reminders by course/type. */
export function engagementGroupKey(
  reminderType: ReminderType,
  courseId: string,
): string {
  return `engagement:${reminderType}:${courseId}`;
}
