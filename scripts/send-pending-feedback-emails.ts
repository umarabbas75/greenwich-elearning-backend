/**
 * send-pending-feedback-emails.ts
 *
 * Finds learners who reached 100% section progress on a course with an active
 * feedback form but have not submitted feedback, then emails them (optional).
 * Skips learners who completed today or yesterday (they may still get the
 * normal completion / feedback-request flow).
 *
 * Usage (dry run — default, no emails sent):
 *   yarn script:pending-feedback:dry
 *
 * Send emails:
 *   yarn script:pending-feedback:send
 *
 * Options:
 *   --send          Actually send emails (default is dry run)
 *   --limit=N       Cap candidates processed (default: no limit)
 *   --delay-ms=N    Pause between sends in ms (default: 600)
 */

import * as dotenv from 'dotenv';
import { EmailStatus, EmailType, Prisma, PrismaClient } from '@prisma/client';
import { Resend } from 'resend';
import { renderPendingFeedbackOutstanding } from '../src/mail/templates/course-feedback.template';

dotenv.config();

const rawUrl = process.env.DATABASE_URL ?? '';
const datasourceUrl = rawUrl.includes('pgbouncer=true')
  ? rawUrl
  : rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'pgbouncer=true&connect_timeout=30';

const prisma = new PrismaClient({ datasources: { db: { url: datasourceUrl } } });

const DEFAULT_FROM =
  'Greenwich Training & Consulting <noreply@greenwichtc-elearning.com>';

interface Candidate {
  userId: string;
  courseId: string;
  email: string;
  firstName: string | null;
  courseTitle: string;
  courseCompletedAt: Date | null;
  totalSections: number;
  progressedSections: number;
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const shouldSend = process.argv.includes('--send');
const limitRaw = parseArg('limit');
const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10)) : undefined;
const delayMs = Math.max(
  0,
  parseInt(parseArg('delay-ms') ?? '600', 10) || 600,
);

async function findCandidates(take?: number): Promise<Candidate[]> {
  const limitClause =
    take !== undefined ? Prisma.sql`LIMIT ${take}` : Prisma.empty;

  return prisma.$queryRaw<Candidate[]>`
    WITH section_totals AS (
      SELECT mo."courseId" AS "courseId",
             COUNT(*)::int AS "totalSections"
        FROM "sections" s
        JOIN "chapters" ch ON ch."id" = s."chapterId"
        JOIN "modules" mo ON mo."id" = ch."moduleId"
       WHERE s."isActive" = true
       GROUP BY mo."courseId"
    ),
    progress_counts AS (
      SELECT ucp."userId",
             ucp."courseId",
             COUNT(DISTINCT ucp."sectionId")::int AS "progressedSections"
        FROM "UserCourseProgress" ucp
       GROUP BY ucp."userId", ucp."courseId"
    )
    SELECT pc."userId"   AS "userId",
           pc."courseId" AS "courseId",
           u."email"     AS "email",
           u."firstName" AS "firstName",
           c."title"     AS "courseTitle",
           cc."courseCompletedAt" AS "courseCompletedAt",
           st."totalSections" AS "totalSections",
           pc."progressedSections" AS "progressedSections"
      FROM progress_counts pc
      JOIN section_totals st ON st."courseId" = pc."courseId"
      JOIN "users" u ON u."id" = pc."userId"
      JOIN "courses" c ON c."id" = pc."courseId"
      JOIN "user_courses" uc
        ON uc."userId" = pc."userId" AND uc."courseId" = pc."courseId"
      JOIN "course_feedback_forms" ff ON ff."courseId" = pc."courseId"
      LEFT JOIN "course_feedback_submissions" fs
             ON fs."userId" = pc."userId" AND fs."courseId" = pc."courseId"
      LEFT JOIN "course_completions" cc
             ON cc."userId" = pc."userId" AND cc."courseId" = pc."courseId"
     WHERE pc."progressedSections" >= st."totalSections"
       AND st."totalSections" > 0
       AND ff."isActive" = true
       AND fs."id" IS NULL
       AND c."isActive" = true
       AND uc."isActive" = true
       AND u."status" = 'active'
       AND u."deletedAt" IS NULL
       AND u."email" IS NOT NULL
       AND (
         cc."courseCompletedAt" IS NULL
         OR cc."courseCompletedAt"::date < (CURRENT_DATE - make_interval(days => 1::int))::date
       )
       AND NOT EXISTS (
         SELECT 1
           FROM "email_logs" el
          WHERE el."userId" = pc."userId"
            AND el."type" = 'FEEDBACK_OUTSTANDING'
            AND el."status" = 'SENT'
            AND el."metadata"->>'courseId' = pc."courseId"::text
       )
     ORDER BY pc."userId", pc."courseId"
     ${limitClause}
  `;
}

function formatCompletedAt(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

async function recordEmailLog(
  recipient: string,
  userId: string,
  courseId: string,
  courseTitle: string,
  completedAt: string | null,
  outcome: {
    status: EmailStatus;
    providerId?: string;
    error?: string;
  },
): Promise<void> {
  try {
    await prisma.emailLog.create({
      data: {
        recipient,
        type: EmailType.FEEDBACK_OUTSTANDING,
        userId,
        status: outcome.status,
        providerId: outcome.providerId ?? null,
        error: outcome.error ?? null,
        metadata: { courseId, courseTitle, completedAt },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠ Failed to record EmailLog for ${recipient}: ${message}`);
  }
}

async function sendOne(
  client: Resend | null,
  from: string,
  candidate: Candidate,
): Promise<'sent' | 'skipped' | 'failed'> {
  const rendered = renderPendingFeedbackOutstanding({
    to: candidate.email,
    userId: candidate.userId,
    firstName: candidate.firstName ?? 'there',
    courseTitle: candidate.courseTitle,
    courseId: candidate.courseId,
    completedAt: formatCompletedAt(candidate.courseCompletedAt),
  });

  if (!client) {
    await recordEmailLog(
      candidate.email,
      candidate.userId,
      candidate.courseId,
      candidate.courseTitle,
      formatCompletedAt(candidate.courseCompletedAt),
      { status: EmailStatus.SKIPPED, error: 'mail-disabled' },
    );
    return 'skipped';
  }

  try {
    const { data, error } = await client.emails.send({
      from,
      to: candidate.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    if (error) {
      await recordEmailLog(
        candidate.email,
        candidate.userId,
        candidate.courseId,
        candidate.courseTitle,
        formatCompletedAt(candidate.courseCompletedAt),
        { status: EmailStatus.FAILED, error: error.message },
      );
      return 'failed';
    }
    await recordEmailLog(
      candidate.email,
      candidate.userId,
      candidate.courseId,
      candidate.courseTitle,
      formatCompletedAt(candidate.courseCompletedAt),
      { status: EmailStatus.SENT, providerId: data?.id },
    );
    return 'sent';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordEmailLog(
      candidate.email,
      candidate.userId,
      candidate.courseId,
      candidate.courseTitle,
      formatCompletedAt(candidate.courseCompletedAt),
      { status: EmailStatus.FAILED, error: message },
    );
    return 'failed';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const mode = shouldSend ? 'SEND' : 'DRY RUN';
  console.log(`\n📋 Pending feedback email script — ${mode}\n`);

  const candidates = await findCandidates(limit);
  console.log(`Found ${candidates.length} candidate(s) (100% progress, active feedback form, no submission).\n`);

  if (candidates.length === 0) {
    console.log('Nothing to do.\n');
    return;
  }

  const byCourse = new Map<string, number>();
  for (const c of candidates) {
    byCourse.set(c.courseTitle, (byCourse.get(c.courseTitle) ?? 0) + 1);
  }
  console.log('By course:');
  for (const [title, count] of [...byCourse.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}× ${title}`);
  }
  console.log();

  for (const c of candidates) {
    const completed = formatCompletedAt(c.courseCompletedAt) ?? 'unknown';
    console.log(
      `  • ${c.email} — ${c.courseTitle} (${c.progressedSections}/${c.totalSections} sections, completed ${completed})`,
    );
  }
  console.log();

  if (!shouldSend) {
    console.log('ℹ️  Dry run — pass --send to email these users.\n');
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM ?? DEFAULT_FROM;
  const client = apiKey ? new Resend(apiKey) : null;
  if (!client) {
    console.warn('⚠️  RESEND_API_KEY not set — emails will be SKIPPED in EmailLog only.\n');
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const result = await sendOne(client, from, c);
    if (result === 'sent') sent++;
    else if (result === 'failed') failed++;
    else skipped++;

    console.log(
      `  [${i + 1}/${candidates.length}] ${result.toUpperCase()} → ${c.email} (${c.courseTitle})`,
    );

    if (i < candidates.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  console.log(`\n✅ Done — sent: ${sent}, failed: ${failed}, skipped: ${skipped}\n`);
}

main()
  .catch((err) => {
    console.error('\n❌ Error:', err.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
