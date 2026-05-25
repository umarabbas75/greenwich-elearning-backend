-- Composite index to support per-user unread-count and list queries
CREATE INDEX IF NOT EXISTS "notifications_userId_isRead_createdAt_idx"
  ON "notifications" ("userId", "isRead", "createdAt" DESC);
