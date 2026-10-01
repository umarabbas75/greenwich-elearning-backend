-- Course destroy deletes bell rows by "referenceId" (polymorphic, no FK);
-- without an index every destroy seq-scans notifications.
--
-- CONCURRENTLY so the build does not block notification inserts. Must stay
-- the only statement in this file — see
-- 20261001120000_section_time_spent_daily_course_idx for why, and for
-- recovering from an INVALID index left by an interrupted build.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "notifications_referenceId_idx" ON "notifications"("referenceId");
