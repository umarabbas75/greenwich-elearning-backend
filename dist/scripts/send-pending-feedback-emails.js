"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
const resend_1 = require("resend");
const course_feedback_template_1 = require("../src/mail/templates/course-feedback.template");
dotenv.config();
const rawUrl = process.env.DATABASE_URL ?? '';
const datasourceUrl = rawUrl.includes('pgbouncer=true')
    ? rawUrl
    : rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'pgbouncer=true&connect_timeout=30';
const prisma = new client_1.PrismaClient({ datasources: { db: { url: datasourceUrl } } });
const DEFAULT_FROM = 'Greenwich Training & Consulting <noreply@greenwichtc-elearning.com>';
function parseArg(name) {
    const prefix = `--${name}=`;
    const hit = process.argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
}
const shouldSend = process.argv.includes('--send');
const limitRaw = parseArg('limit');
const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10)) : undefined;
const delayMs = Math.max(0, parseInt(parseArg('delay-ms') ?? '600', 10) || 600);
async function findCandidates(take) {
    const limitClause = take !== undefined ? client_1.Prisma.sql `LIMIT ${take}` : client_1.Prisma.empty;
    return prisma.$queryRaw `
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
function formatCompletedAt(d) {
    if (!d)
        return null;
    return d.toISOString().slice(0, 10);
}
async function recordEmailLog(recipient, userId, courseId, courseTitle, completedAt, outcome) {
    try {
        await prisma.emailLog.create({
            data: {
                recipient,
                type: client_1.EmailType.FEEDBACK_OUTSTANDING,
                userId,
                status: outcome.status,
                providerId: outcome.providerId ?? null,
                error: outcome.error ?? null,
                metadata: { courseId, courseTitle, completedAt },
            },
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`  ⚠ Failed to record EmailLog for ${recipient}: ${message}`);
    }
}
async function sendOne(client, from, candidate) {
    const rendered = (0, course_feedback_template_1.renderPendingFeedbackOutstanding)({
        to: candidate.email,
        userId: candidate.userId,
        firstName: candidate.firstName ?? 'there',
        courseTitle: candidate.courseTitle,
        courseId: candidate.courseId,
        completedAt: formatCompletedAt(candidate.courseCompletedAt),
    });
    if (!client) {
        await recordEmailLog(candidate.email, candidate.userId, candidate.courseId, candidate.courseTitle, formatCompletedAt(candidate.courseCompletedAt), { status: client_1.EmailStatus.SKIPPED, error: 'mail-disabled' });
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
            await recordEmailLog(candidate.email, candidate.userId, candidate.courseId, candidate.courseTitle, formatCompletedAt(candidate.courseCompletedAt), { status: client_1.EmailStatus.FAILED, error: error.message });
            return 'failed';
        }
        await recordEmailLog(candidate.email, candidate.userId, candidate.courseId, candidate.courseTitle, formatCompletedAt(candidate.courseCompletedAt), { status: client_1.EmailStatus.SENT, providerId: data?.id });
        return 'sent';
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await recordEmailLog(candidate.email, candidate.userId, candidate.courseId, candidate.courseTitle, formatCompletedAt(candidate.courseCompletedAt), { status: client_1.EmailStatus.FAILED, error: message });
        return 'failed';
    }
}
function sleep(ms) {
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
    const byCourse = new Map();
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
        console.log(`  • ${c.email} — ${c.courseTitle} (${c.progressedSections}/${c.totalSections} sections, completed ${completed})`);
    }
    console.log();
    if (!shouldSend) {
        console.log('ℹ️  Dry run — pass --send to email these users.\n');
        return;
    }
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM ?? DEFAULT_FROM;
    const client = apiKey ? new resend_1.Resend(apiKey) : null;
    if (!client) {
        console.warn('⚠️  RESEND_API_KEY not set — emails will be SKIPPED in EmailLog only.\n');
    }
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const result = await sendOne(client, from, c);
        if (result === 'sent')
            sent++;
        else if (result === 'failed')
            failed++;
        else
            skipped++;
        console.log(`  [${i + 1}/${candidates.length}] ${result.toUpperCase()} → ${c.email} (${c.courseTitle})`);
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
//# sourceMappingURL=send-pending-feedback-emails.js.map