-- One-level comment replies. parentId is nullable so we can detach later.

ALTER TABLE "forum_comments" ADD COLUMN "parentId" TEXT;

CREATE INDEX "forum_comments_threadId_parentId_createdAt_idx"
  ON "forum_comments" ("threadId", "parentId", "createdAt");

ALTER TABLE "forum_comments"
  ADD CONSTRAINT "forum_comments_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "forum_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
