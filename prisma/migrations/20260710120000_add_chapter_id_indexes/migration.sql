-- Index the chapterId FK columns on sections and quizzes. Postgres does not
-- auto-index foreign-key columns, so the live/unpinned learner reads
--   section.findMany({ where: { chapterId, isArchived: false } })
--   chapter.findUnique(... quizzes where isArchived: false)
-- were sequential-scanning. Additive, safe to apply online for small tables.
-- For very large tables consider CREATE INDEX CONCURRENTLY (run outside a
-- transaction, i.e. not via `prisma migrate` which wraps statements in one).

-- IF NOT EXISTS: some environments already have these indexes from an earlier
-- `prisma db push` (Prisma's default index names match these), so guard against
-- "relation already exists" while still creating them where they're missing.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sections_chapterId_idx" ON "sections"("chapterId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "quizzes_chapterId_idx" ON "quizzes"("chapterId");
