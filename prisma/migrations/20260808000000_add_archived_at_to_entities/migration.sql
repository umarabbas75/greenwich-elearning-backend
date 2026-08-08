-- Adds `archivedAt: DateTime?` to Module, Chapter, Section, Quiz.
--
-- Motivation: `isArchived: Boolean` records *whether* a row was archived but
-- not *when*. PR 1's admin-side archive inventory needs both — to sort
-- most-recently-archived first and to correlate archive events with
-- AdminAuditLog rows.
--
-- Backfill strategy: `updatedAt` is the least-wrong retrospective timestamp
-- for pre-existing archived rows. It's imperfect — any post-archive edit
-- (orderIndex bumps, title tweaks) will have overwritten the true archive
-- moment — but it is the only signal available. From PR 1 onward, the
-- service layer sets `archivedAt = now()` explicitly on the archive branches
-- of deleteModule/Chapter/Section/deleteQuiz/unAssignQuiz, so this
-- backfill drift is bounded to pre-PR-1 history.
--
-- No index added: the inventory endpoint scopes by courseId (via existing
-- FKs) and filters by `isArchived = true` (highly selective — usually dozens
-- of rows per course), so sorting the narrowed set by `archivedAt` in memory
-- is cheap. Revisit only if inventory ever hot-spots in prod on a course
-- with thousands of archived rows.

ALTER TABLE "modules"  ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "chapters" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "sections" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "quizzes"  ADD COLUMN "archivedAt" TIMESTAMP(3);

UPDATE "modules"  SET "archivedAt" = "updatedAt" WHERE "isArchived" = true;
UPDATE "chapters" SET "archivedAt" = "updatedAt" WHERE "isArchived" = true;
UPDATE "sections" SET "archivedAt" = "updatedAt" WHERE "isArchived" = true;
UPDATE "quizzes"  SET "archivedAt" = "updatedAt" WHERE "isArchived" = true;
