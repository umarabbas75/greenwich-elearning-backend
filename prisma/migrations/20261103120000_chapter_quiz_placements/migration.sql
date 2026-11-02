-- Let one bank quiz be used in several chapters (e.g. the same NEBOSH
-- questions in two courses).
--
-- Before: quizzes."chapterId" — a quiz belonged to at most one chapter, and
-- re-assigning it silently moved it out of its old chapter.
-- After:  chapter_quizzes — one row per (chapter, quiz) with its own order and
-- removal state. Quiz content stays on quizzes, so editing it changes every
-- chapter that uses it.
--
-- Expand phase only. quizzes."chapterId" / "orderIndex" are kept (unused by the
-- new code) so the previous release keeps working until the new one is live,
-- and a transition trigger mirrors that release's writes into chapter_quizzes.
-- A later contract migration drops the trigger and the two columns.

-- Hold off writes to quizzes (from the still-running previous release) until
-- this migration commits, so none can land between the backfill below and
-- the transition trigger at the end. Reads are not blocked; the migration
-- takes seconds.
LOCK TABLE "quizzes" IN SHARE ROW EXCLUSIVE MODE;

-- CreateTable
CREATE TABLE "chapter_quizzes" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "orderIndex" INTEGER,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chapter_quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chapter_quizzes_quizId_idx" ON "chapter_quizzes"("quizId");

-- CreateIndex
CREATE INDEX "chapter_quizzes_chapterId_isArchived_orderIndex_idx" ON "chapter_quizzes"("chapterId", "isArchived", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "chapter_quizzes_chapterId_quizId_key" ON "chapter_quizzes"("chapterId", "quizId");

-- AddForeignKey
ALTER TABLE "chapter_quizzes" ADD CONSTRAINT "chapter_quizzes_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_quizzes" ADD CONSTRAINT "chapter_quizzes_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every quiz currently in a chapter becomes one live placement with
-- the same order. createdAt is copied from the quiz so the (orderIndex,
-- createdAt, quizId) tie-break orders exactly like the old
-- (orderIndex, createdAt, id) one — version fingerprints and pinned order are
-- unchanged by the move. Quizzes archived from the bank keep a live placement
-- (the quiz-level isArchived hides them), matching how they kept chapterId.
INSERT INTO "chapter_quizzes" ("id", "chapterId", "quizId", "orderIndex", "isArchived", "archivedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, q."chapterId", q."id", q."orderIndex", false, NULL, q."createdAt", CURRENT_TIMESTAMP
FROM "quizzes" q
WHERE q."chapterId" IS NOT NULL;

-- Backfill, part 2: every (chapter, quiz) pair that a course version still
-- lists but that is no longer live in that chapter — unassigned, or moved to
-- another chapter, before placements existed — gets a REMOVED placement.
-- That records the history the single chapterId lost: pinned learners keep
-- their order (copied from the quiz, exactly what ordered it for them
-- before), and deleting the course that now holds a moved quiz can no longer
-- delete it from under the course whose versions still serve it. Pairs whose
-- chapter or quiz row is gone are skipped; malformed manifests are ignored.
INSERT INTO "chapter_quizzes" ("id", "chapterId", "quizId", "orderIndex", "isArchived", "archivedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, pairs.chapter_id, q."id", q."orderIndex", true, COALESCE(q."archivedAt", CURRENT_TIMESTAMP), q."createdAt", CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ch->>'sourceId' AS chapter_id, qid AS quiz_id
  FROM "course_versions" v
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v."manifest"->'modules') = 'array' THEN v."manifest"->'modules' ELSE '[]'::jsonb END) m
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(m->'chapters') = 'array' THEN m->'chapters' ELSE '[]'::jsonb END) ch
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(ch->'quizIds') = 'array' THEN ch->'quizIds' ELSE '[]'::jsonb END) qid
) pairs
JOIN "quizzes" q ON q."id" = pairs.quiz_id
JOIN "chapters" c ON c."id" = pairs.chapter_id
ON CONFLICT ("chapterId", "quizId") DO NOTHING;

-- Learner answers become per chapter: a quiz shared by two courses is answered
-- separately in each. Existing rows are unique on the stricter
-- (userId, quizId), so the new index always builds. Created before the old one
-- is dropped so uniqueness is never unenforced.
CREATE UNIQUE INDEX "quiz_answers_userId_chapterId_quizId_key" ON "quiz_answers"("userId", "chapterId", "quizId");

DROP INDEX "quiz_answers_userId_quizId_key";

-- Transition trigger. Until the new release is live, the previous one still
-- assigns, moves, unassigns and reorders by writing quizzes."chapterId" /
-- "orderIndex". Mirror those writes so nothing done in that window is lost.
-- The new release never writes either column, so this goes quiet once it is
-- deployed. Leaving a chapter archives the placement rather than deleting it:
-- that keeps the pinned-learner order and is excluded from the live set, like
-- the old "chapterId cleared" state.
CREATE FUNCTION "gw_mirror_legacy_quiz_chapter"() RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."chapterId" IS NOT NULL
     AND OLD."chapterId" IS DISTINCT FROM NEW."chapterId" THEN
    UPDATE "chapter_quizzes"
    SET "isArchived" = true, "archivedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "chapterId" = OLD."chapterId" AND "quizId" = OLD."id" AND "isArchived" = false;
  END IF;

  IF NEW."chapterId" IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR OLD."chapterId" IS DISTINCT FROM NEW."chapterId"
          OR OLD."orderIndex" IS DISTINCT FROM NEW."orderIndex") THEN
    INSERT INTO "chapter_quizzes" ("id", "chapterId", "quizId", "orderIndex", "isArchived", "archivedAt", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, NEW."chapterId", NEW."id", NEW."orderIndex", false, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("chapterId", "quizId") DO UPDATE
    SET "orderIndex" = EXCLUDED."orderIndex",
        "isArchived" = false,
        "archivedAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER "quizzes_mirror_legacy_chapter"
AFTER INSERT OR UPDATE OF "chapterId", "orderIndex" ON "quizzes"
FOR EACH ROW EXECUTE FUNCTION "gw_mirror_legacy_quiz_chapter"();
