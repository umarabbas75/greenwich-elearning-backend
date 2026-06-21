/**
 * _audit-completion-mismatch.ts
 *
 * Read-only diagnostic. Lists every user who has
 *   course_completions.courseCompletedAt IS NOT NULL
 * but whose live progress (distinct completed sections / current total sections
 * in the course) is below 100%. These are users who finished the course before
 * new content was added — they earned the certificate, but the FE percentage
 * has since drifted downward.
 *
 * Pure read query, no writes. Safe to run anytime, in any env.
 *
 *   yarn ts-node -r tsconfig-paths/register scripts/_audit-completion-mismatch.ts
 */

import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const rawUrl = process.env.DATABASE_URL ?? '';
const datasourceUrl = rawUrl.includes('pgbouncer=true')
  ? rawUrl
  : rawUrl +
    (rawUrl.includes('?') ? '&' : '?') +
    'pgbouncer=true&connect_timeout=30';

const prisma = new PrismaClient({
  datasources: { db: { url: datasourceUrl } },
});

type Row = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  course_id: string;
  course_title: string;
  course_completed_at: Date;
  completed_sections: number;
  total_sections: number;
  live_percentage: number;
};

async function main() {
  console.log('\n🔎 Frozen-completion mismatch audit\n');

  const rows = await prisma.$queryRaw<Row[]>`
    WITH course_section_counts AS (
      SELECT m."courseId", COUNT(s.id)::int AS total_sections
        FROM "modules"  m
        JOIN "chapters" c ON c."moduleId"  = m.id
        JOIN "sections" s ON s."chapterId" = c.id
       GROUP BY m."courseId"
    ),
    user_progress AS (
      SELECT ucp."userId",
             ucp."courseId",
             COUNT(DISTINCT ucp."sectionId")::int AS completed_sections
        FROM "UserCourseProgress" ucp
       GROUP BY ucp."userId", ucp."courseId"
    )
    SELECT
      u.email                              AS email,
      u."firstName"                        AS first_name,
      u."lastName"                         AS last_name,
      cc."courseId"                        AS course_id,
      c.title                              AS course_title,
      cc."courseCompletedAt"               AS course_completed_at,
      COALESCE(up.completed_sections, 0)   AS completed_sections,
      csc.total_sections                   AS total_sections,
      ROUND(
        (COALESCE(up.completed_sections, 0)::numeric * 100)
          / NULLIF(csc.total_sections, 0),
        2
      )::float                             AS live_percentage
    FROM "course_completions" cc
    JOIN "users"   u ON u.id = cc."userId"
    JOIN "courses" c ON c.id = cc."courseId"
    LEFT JOIN course_section_counts csc ON csc."courseId" = cc."courseId"
    LEFT JOIN user_progress up
      ON up."userId" = cc."userId" AND up."courseId" = cc."courseId"
    WHERE cc."courseCompletedAt" IS NOT NULL
      AND csc.total_sections > 0
      AND (COALESCE(up.completed_sections, 0)::numeric * 100)
            / csc.total_sections < 100
    ORDER BY live_percentage ASC, cc."courseCompletedAt" DESC
  `;

  if (rows.length === 0) {
    console.log('✅ Clean — every certified completer is at 100% live progress.\n');
    return;
  }

  console.log(
    `Found ${rows.length} user-course completion row(s) showing < 100% live progress.\n`,
  );

  const byCourse = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byCourse.get(r.course_id) ?? [];
    list.push(r);
    byCourse.set(r.course_id, list);
  }

  for (const [, list] of byCourse) {
    const title = list[0].course_title;
    const total = list[0].total_sections;
    console.log(
      `▸ "${title}"  (${total} sections, ${list.length} affected user(s))`,
    );
    for (const r of list) {
      const name =
        [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || '—';
      const pct = Number(r.live_percentage).toFixed(2);
      const completedAt = r.course_completed_at.toISOString().split('T')[0];
      console.log(
        `    ${r.email.padEnd(36)} · ${name.padEnd(24)} · completed ${completedAt} · ${r.completed_sections}/${r.total_sections} = ${pct}%`,
      );
    }
    console.log();
  }

  console.log(
    `Total: ${rows.length} affected completer(s) across ${byCourse.size} course(s).\n`,
  );
  console.log(
    'These users will jump back to 100% the moment the freeze-at-100 patch is deployed — no data backfill needed.\n',
  );
}

main()
  .catch((err) => {
    console.error('\n❌ Error:', err.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
