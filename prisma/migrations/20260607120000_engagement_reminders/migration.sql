-- Engagement reminders: new notification type + activity indexes for the
-- low-engagement sweep (see src/engagement). No new table — cadence/idempotency
-- is encoded in notifications.dedupeKey via the existing partial unique index.

-- 1. New notification type. Postgres requires ADD VALUE outside a txn block when
--    the value is used immediately; Prisma runs each statement separately so
--    IF NOT EXISTS keeps this migration safely re-runnable.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ENGAGEMENT_REMINDER';

-- 2. Indexes supporting the sweep's MAX("updatedAt") GROUP BY ("userId","courseId").
--    LastSeenSection had no (userId, courseId) index at all — this one is required.
CREATE INDEX IF NOT EXISTS "lastseen_user_course_updated_idx"
  ON "LastSeenSection" ("userId", "courseId", "updatedAt");

--    UserCourseProgress already has a (userId, courseId, ...) unique whose left
--    prefix is usable; this makes the MAX("updatedAt") aggregate index-only.
CREATE INDEX IF NOT EXISTS "ucp_user_course_updated_idx"
  ON "UserCourseProgress" ("userId", "courseId", "updatedAt");

-- 3. Engagement "start line": when the admin first activated a course for a user.
--    Set in toggleCourseStatus on isActive false→true. Nullable; the sweep uses
--    COALESCE("activatedAt", "updatedAt") so existing rows still work pre-backfill.
ALTER TABLE "user_courses" ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMP(3);

--    Backfill: rows already active get a best-effort start line from updatedAt
--    (the toggle is the only write to this row, so updatedAt ≈ activation time).
UPDATE "user_courses"
   SET "activatedAt" = "updatedAt"
 WHERE "isActive" = true AND "activatedAt" IS NULL;
