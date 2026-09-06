-- List hot path: denormalised excerpt (skip Quill HTML), tighter indexes.

ALTER TABLE "forum_threads" ADD COLUMN "excerpt" TEXT NOT NULL DEFAULT '';

UPDATE "forum_threads"
SET "excerpt" = LEFT(
  TRIM(BOTH FROM regexp_replace(
    regexp_replace(COALESCE("content", ''), '<[^>]+>', ' ', 'g'),
    '\s+',
    ' ',
    'g'
  )),
  280
);

CREATE INDEX "forum_threads_categoryId_status_isPinned_lastActivityAt_idx"
  ON "forum_threads" ("categoryId", "status", "isPinned" DESC, "lastActivityAt" DESC);

CREATE INDEX "forum_threads_courseId_idx" ON "forum_threads" ("courseId");

CREATE INDEX "forum_tags_name_idx" ON "forum_tags" ("name");
