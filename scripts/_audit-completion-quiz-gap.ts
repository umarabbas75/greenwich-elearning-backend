/**
 * _audit-completion-quiz-gap.ts
 *
 * Read-only diagnostic. Finds learners who hold a course completion
 * (course_completions.courseCompletedAt IS NOT NULL) while at least one
 * chapter quiz in that course is NOT passed.
 *
 * Why this can happen today: `_checkContentCompletion` stamps
 * courseCompletedAt based on distinct completed SECTIONS only — it never
 * consults QuizProgress. The progression gate (`isChapterComplete`) does
 * require the quiz, but `assertChapterAccessible` only gates entering the
 * NEXT chapter. So a chapter whose quiz is unpassed is never enforced if the
 * learner has no need to advance past it — most notably the LAST chapter.
 *
 * A chapter "has a quiz" iff it has >= 1 non-archived Quiz row (a Quiz row is
 * a single question; the chapter's quiz is the set of them).
 * "Passed" = quiz_progress row for (userId, chapterId) with isPassed = true.
 *
 * Pure read query, no writes. Safe to run anytime, in any env.
 *
 *   yarn ts-node -r tsconfig-paths/register scripts/_audit-completion-quiz-gap.ts
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

type GapRow = {
  email: string;
  course_id: string;
  course_title: string;
  course_completed_at: Date;
  quiz_chapters: number;
  passed_chapters: number;
  unpassed_chapters: number;
  unpassed_titles: string;
  last_chapter_unpassed: boolean;
};

async function main() {
  // Chapters that have at least one live quiz question, with their position
  // within the module (to identify "is this the last chapter of the course").
  // Scoped to live (non-archived) structure throughout, matching how the
  // completion denominator treats the live tree.
  const rows = await prisma.$queryRaw<GapRow[]>`
    WITH quiz_chapters AS (
      SELECT c.id           AS chapter_id,
             c.title        AS chapter_title,
             m."courseId"   AS course_id,
             ROW_NUMBER() OVER (
               PARTITION BY m."courseId"
               ORDER BY m."createdAt", m.id, c."createdAt", c.id
             ) AS chapter_seq
        FROM "chapters" c
        JOIN "modules" m ON m.id = c."moduleId"
       WHERE c."isArchived" = false
         AND m."isArchived" = false
         AND EXISTS (
               SELECT 1 FROM "quizzes" q
                WHERE q."chapterId" = c.id
                  AND q."isArchived" = false
             )
    ),
    course_chapter_max AS (
      SELECT m."courseId" AS course_id, COUNT(*) AS total_chapters
        FROM "chapters" c
        JOIN "modules" m ON m.id = c."moduleId"
       WHERE c."isArchived" = false AND m."isArchived" = false
       GROUP BY m."courseId"
    )
    SELECT u.email                                   AS email,
           co.id                                     AS course_id,
           co.title                                  AS course_title,
           cc."courseCompletedAt"                    AS course_completed_at,
           COUNT(qc.chapter_id)::int                 AS quiz_chapters,
           COUNT(qp.id) FILTER (WHERE qp."isPassed") ::int AS passed_chapters,
           (COUNT(qc.chapter_id) - COUNT(qp.id) FILTER (WHERE qp."isPassed"))::int
                                                     AS unpassed_chapters,
           COALESCE(STRING_AGG(
             qc.chapter_title, ' | '
             ORDER BY qc.chapter_seq
           ) FILTER (WHERE qp."isPassed" IS DISTINCT FROM true), '') AS unpassed_titles,
           BOOL_OR(
             qp."isPassed" IS DISTINCT FROM true
             AND qc.chapter_seq = ccm.total_chapters
           )                                         AS last_chapter_unpassed
      FROM "course_completions" cc
      JOIN "users"   u  ON u.id = cc."userId"
      JOIN "courses" co ON co.id = cc."courseId"
      JOIN quiz_chapters qc ON qc.course_id = cc."courseId"
      JOIN course_chapter_max ccm ON ccm.course_id = cc."courseId"
      LEFT JOIN "quiz_progress" qp
             ON qp."chapterId" = qc.chapter_id
            AND qp."userId"    = cc."userId"
     WHERE cc."courseCompletedAt" IS NOT NULL
       AND u."deletedAt" IS NULL
     GROUP BY u.email, co.id, co.title, cc."courseCompletedAt"
    HAVING COUNT(qc.chapter_id) > COUNT(qp.id) FILTER (WHERE qp."isPassed")
     ORDER BY cc."courseCompletedAt" DESC
  `;

  console.log('='.repeat(78));
  console.log('COMPLETION / QUIZ GAP AUDIT');
  console.log('Certified learners with >=1 unpassed chapter quiz');
  console.log('='.repeat(78));

  if (rows.length === 0) {
    console.log('\n✅ No affected learners. No completion was granted with an');
    console.log('   unpassed chapter quiz.\n');
  } else {
    console.log(`\n⚠️  ${rows.length} affected learner/course pair(s):\n`);
    for (const r of rows) {
      console.log(`- ${r.email}  |  ${r.course_title}`);
      console.log(
        `    completedAt=${r.course_completed_at.toISOString()}  ` +
          `quizChapters=${r.quiz_chapters} passed=${r.passed_chapters} ` +
          `unpassed=${r.unpassed_chapters}` +
          (r.last_chapter_unpassed ? '  [LAST CHAPTER UNPASSED]' : ''),
      );
      console.log(`    unpassed: ${r.unpassed_titles}`);
    }
    console.log('');
  }

  // Structural context: does the "last chapter has no quiz" assumption hold?
  const shape = await prisma.$queryRaw<
    Array<{
      course_title: string;
      total_chapters: number;
      quiz_chapters: number;
      last_chapter_has_quiz: boolean;
    }>
  >`
    WITH ordered AS (
      SELECT m."courseId" AS course_id,
             c.id         AS chapter_id,
             ROW_NUMBER() OVER (
               PARTITION BY m."courseId"
               ORDER BY m."createdAt", m.id, c."createdAt", c.id
             ) AS seq,
             COUNT(*) OVER (PARTITION BY m."courseId") AS total_chapters,
             EXISTS (
               SELECT 1 FROM "quizzes" q
                WHERE q."chapterId" = c.id AND q."isArchived" = false
             ) AS has_quiz
        FROM "chapters" c
        JOIN "modules" m ON m.id = c."moduleId"
       WHERE c."isArchived" = false AND m."isArchived" = false
    )
    SELECT co.title::text                                   AS course_title,
           MAX(o.total_chapters)::int                       AS total_chapters,
           COUNT(*) FILTER (WHERE o.has_quiz)::int          AS quiz_chapters,
           BOOL_OR(o.has_quiz AND o.seq = o.total_chapters) AS last_chapter_has_quiz
      FROM ordered o
      JOIN "courses" co ON co.id = o.course_id
     GROUP BY co.id, co.title
     ORDER BY co.title
  `;

  console.log('-'.repeat(78));
  console.log('COURSE SHAPE — is the "last chapter has no quiz" assumption true?');
  console.log('-'.repeat(78));
  for (const s of shape) {
    console.log(
      `${s.last_chapter_has_quiz ? '⚠️ ' : '  '} ${s.course_title}` +
        `  (chapters=${s.total_chapters}, withQuiz=${s.quiz_chapters}, ` +
        `lastChapterHasQuiz=${s.last_chapter_has_quiz})`,
    );
  }
  const risky = shape.filter((s) => s.last_chapter_has_quiz);
  console.log(
    `\n${risky.length} of ${shape.length} course(s) have a quiz on the LAST chapter ` +
      `(these are exposed to the gap going forward).\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
