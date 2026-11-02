# Shared quizzes: rollout and rollback

One bank quiz can now be used in chapters of several courses, for example the
same NEBOSH questions in NEBOSH and NEBOSH (TEST).

- Content lives on `quizzes`, so an edit changes every chapter that uses the quiz.
- Order, removal and learner answers are per chapter. Membership is the
  `chapter_quizzes` table.
- Within one course a quiz sits in at most one chapter.

Migration: `prisma/migrations/20261103120000_chapter_quiz_placements`.

## What the migration does

1. Creates `chapter_quizzes`.
2. Backfills one live placement per quiz from `quizzes."chapterId"`, copying
   its `orderIndex` and `createdAt`.
3. Backfills a *removed* placement for every (chapter, quiz) pair a course
   version manifest lists that is no longer live there. These are quizzes
   unassigned or moved under the old model.
4. Changes the learner answer key from (userId, quizId) to
   (userId, chapterId, quizId).
5. Installs the trigger `quizzes_mirror_legacy_chapter`. It copies writes the
   previous release makes to `quizzes."chapterId"` / `"orderIndex"` into
   `chapter_quizzes`, so nothing is lost between applying the migration and
   the new backend going live.

`quizzes."chapterId"` and `"orderIndex"` stay in the database but are frozen.
Prisma calls them `legacyChapterId` / `legacyOrderIndex`, and the new code
never writes them.

On a restored copy of production (2 Nov 2026), the old and new code gave
identical results everywhere:

| What was compared | Size | Differences |
| --- | --- | --- |
| Live chapter quiz sets and order | 266 chapters | 0 |
| Course manifests and the publish decision | 23 courses | 0 |
| Pinned order | 1,299 versions | 0 |
| Pinned learner trees | 22 versions | 0 |

## Deploy order

1. **Apply the migration**: `npx prisma migrate deploy`, against production.
   The previous backend keeps working on the new schema, and the trigger
   covers its writes.
2. **Deploy the backend** (committed `dist/`). `yarn check:dist` must pass:
   the new Prisma schema with an old `dist/` breaks every quiz route.
3. **Deploy the frontend.** It only offers "reuse a quiz in another course"
   when the backend returns `chapters` on GET /quizzes. It submits on
   `PUT /quizzes/placements/bulk`, a route the old backend does not have, so a
   stray request to the old backend 404s instead of moving quizzes.

Run this check right after step 2:

```sql
-- every legacy chapterId has a placement row (live, or removed since)
SELECT count(*) FROM quizzes q
WHERE q."chapterId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM chapter_quizzes cq
                  WHERE cq."quizId" = q.id AND cq."chapterId" = q."chapterId");
-- expected 0
```

## Rollback

Roll forward if you can. The new backend's writes, such as placements, a quiz
in two courses, and per-chapter answers, cannot be expressed with one
`chapterId` per quiz.

If the backend has to go back to the previous release after the new one has
been live:

1. **Un-share first.** Find quizzes used in more than one course (archived
   chapters included, which the admin UI hides):

```sql
SELECT q.id, left(q.question, 60) AS question,
       string_agg(DISTINCT co.title, ' | ') AS courses
FROM "chapter_quizzes" cq
JOIN "quizzes" q ON q.id = cq."quizId"
JOIN "chapters" c ON c.id = cq."chapterId"
JOIN "modules" m ON m.id = c."moduleId"
JOIN "courses" co ON co.id = m."courseId"
WHERE NOT cq."isArchived"
GROUP BY q.id, q.question
HAVING count(DISTINCT m."courseId") > 1;
```

   Unassign each one from every course but the one that should keep it.
   Otherwise the old code sees it in a single chapter.

2. **Point the legacy columns at the current state** with the trigger off,
   so this does not touch `chapter_quizzes`. Live chapters are preferred over
   archived ones, then the oldest placement wins. The last statement keeps one
   answer row per learner and quiz, because the old answer code can't handle
   two. It drops the older answer of a learner who answered a shared quiz in
   two courses.

```sql
BEGIN;
ALTER TABLE "quizzes" DISABLE TRIGGER "quizzes_mirror_legacy_chapter";
-- each quiz's best live placement becomes its single chapter
UPDATE "quizzes" q
SET "chapterId" = p."chapterId", "orderIndex" = p."orderIndex"
FROM (
  SELECT DISTINCT ON (cq."quizId") cq."quizId", cq."chapterId", cq."orderIndex"
  FROM "chapter_quizzes" cq
  JOIN "chapters" c ON c.id = cq."chapterId"
  JOIN "modules" m ON m.id = c."moduleId"
  WHERE NOT cq."isArchived"
  ORDER BY cq."quizId", (c."isArchived" OR m."isArchived"), cq."createdAt", cq."id"
) p
WHERE q."id" = p."quizId"
  AND (q."chapterId" IS DISTINCT FROM p."chapterId"
       OR q."orderIndex" IS DISTINCT FROM p."orderIndex");
-- quizzes in no chapter any more
UPDATE "quizzes" q SET "chapterId" = NULL
WHERE q."chapterId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "chapter_quizzes" cq
                  WHERE cq."quizId" = q."id" AND NOT cq."isArchived");
ALTER TABLE "quizzes" ENABLE TRIGGER "quizzes_mirror_legacy_chapter";
-- the old answer code expects one row per (learner, quiz): keep the newest
DELETE FROM "quiz_answers" a
USING "quiz_answers" b
WHERE a."userId" = b."userId" AND a."quizId" = b."quizId"
  AND (a."updatedAt", a."id") < (b."updatedAt", b."id");
COMMIT;
```

3. **Deploy the previous backend and frontend.** Leave the migration in place.
4. **Run step 2 again** as soon as the previous backend is live. It is
   idempotent, and it picks up anything the new backend wrote between steps 2
   and 3. From then on, the trigger keeps `chapter_quizzes` in step with the
   old code, so rolling forward again later needs nothing extra.

## Later: contract migration

Once the new release has been stable for a while:

- Drop the trigger and function `gw_mirror_legacy_quiz_chapter`.
- Drop `quizzes."chapterId"`, `"orderIndex"` and their indexes and foreign key.
- In `sortQuizIdsByLiveOrder` / `loadQuizOrderKeys`, remove the legacy-order
  fallback. Every manifest pair has a placement since the migration.
