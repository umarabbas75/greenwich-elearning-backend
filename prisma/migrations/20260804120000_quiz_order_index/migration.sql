-- AlterTable
ALTER TABLE "quizzes" ADD COLUMN "orderIndex" INTEGER;

-- CreateIndex
CREATE INDEX "quizzes_chapterId_orderIndex_idx" ON "quizzes"("chapterId", "orderIndex");

-- Backfill: per chapter, assign 0..n-1 to non-archived quizzes by createdAt, id
-- (matches legacy effective order before orderIndex existed).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "chapterId"
      ORDER BY "createdAt" ASC, id ASC
    ) - 1 AS idx
  FROM "quizzes"
  WHERE "chapterId" IS NOT NULL
    AND "isArchived" = false
)
UPDATE "quizzes" q
SET "orderIndex" = ranked.idx
FROM ranked
WHERE q.id = ranked.id;
