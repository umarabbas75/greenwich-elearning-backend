-- Notifications: split isRead → seenAt/readAt, add payload/groupKey/dedupeKey,
-- cascade-null thread FK, refresh indexes.

-- 1. New columns
ALTER TABLE "notifications"
  ADD COLUMN "seenAt"    TIMESTAMP(3),
  ADD COLUMN "readAt"    TIMESTAMP(3),
  ADD COLUMN "payload"   JSONB,
  ADD COLUMN "groupKey"  TEXT,
  ADD COLUMN "dedupeKey" TEXT;

-- 2. Backfill. Lossy proxy: updatedAt is the best signal we have for when a
--    read was registered. isRead = false rows get explicit NULLs (no column
--    default — we want NULL, not "now()").
UPDATE "notifications"
   SET "seenAt" = "updatedAt",
       "readAt" = "updatedAt"
 WHERE "isRead" = true;

UPDATE "notifications"
   SET "seenAt" = NULL,
       "readAt" = NULL
 WHERE "isRead" = false;

-- 3. Drop the legacy boolean and its index.
DROP INDEX IF EXISTS "notifications_userId_isRead_createdAt_idx";
ALTER TABLE "notifications" DROP COLUMN "isRead";

-- 4. New indexes.
CREATE INDEX "notifications_userId_readAt_createdAt_idx"
  ON "notifications" ("userId", "readAt", "createdAt" DESC);

CREATE INDEX "notifications_userId_groupKey_idx"
  ON "notifications" ("userId", "groupKey");

-- Partial unique on (userId, dedupeKey) — only enforced when dedupeKey IS NOT NULL.
-- Prisma can't express this directly; raw SQL is the only way.
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_unique"
  ON "notifications" ("userId", "dedupeKey")
  WHERE "dedupeKey" IS NOT NULL;

-- 5. Cascade-null the threadId FK. Drop the existing constraint and re-create
--    with ON DELETE SET NULL so deleting a ForumThread leaves orphan
--    notifications with threadId=NULL (audit trail preserved, FE handles
--    the dangling-reference case at fetch time).
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_threadId_fkey";
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "forum_threads"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
