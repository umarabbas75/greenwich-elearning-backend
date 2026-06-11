-- Track forum list opens and individual thread views for admin analytics.

CREATE TYPE "ForumViewScope" AS ENUM ('list', 'thread');

CREATE TABLE "forum_view_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT,
    "courseId" TEXT,
    "scope" "ForumViewScope" NOT NULL DEFAULT 'thread',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_view_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "forum_view_events_userId_createdAt_idx"
  ON "forum_view_events"("userId", "createdAt" DESC);

CREATE INDEX "forum_view_events_threadId_createdAt_idx"
  ON "forum_view_events"("threadId", "createdAt" DESC);

CREATE INDEX "forum_view_events_createdAt_idx"
  ON "forum_view_events"("createdAt" DESC);

ALTER TABLE "forum_view_events"
  ADD CONSTRAINT "forum_view_events_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "forum_view_events"
  ADD CONSTRAINT "forum_view_events_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "forum_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "forum_view_events"
  ADD CONSTRAINT "forum_view_events_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
