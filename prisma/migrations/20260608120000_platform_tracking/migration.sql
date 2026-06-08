-- Platform tracking: login history (append-only) + per-section active time.

CREATE TABLE IF NOT EXISTS "login_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "login_events_userId_createdAt_idx"
  ON "login_events" ("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "login_events_createdAt_idx"
  ON "login_events" ("createdAt" DESC);

ALTER TABLE "login_events"
  ADD CONSTRAINT "login_events_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "section_time_spent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "moduleId" TEXT,
    "courseId" TEXT NOT NULL,
    "totalSeconds" INTEGER NOT NULL DEFAULT 0,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "section_time_spent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "section_time_spent_userId_sectionId_key"
  ON "section_time_spent" ("userId", "sectionId");
CREATE INDEX IF NOT EXISTS "section_time_spent_userId_courseId_idx"
  ON "section_time_spent" ("userId", "courseId");
CREATE INDEX IF NOT EXISTS "section_time_spent_courseId_moduleId_idx"
  ON "section_time_spent" ("courseId", "moduleId");
CREATE INDEX IF NOT EXISTS "section_time_spent_userId_chapterId_idx"
  ON "section_time_spent" ("userId", "chapterId");

ALTER TABLE "section_time_spent"
  ADD CONSTRAINT "section_time_spent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
