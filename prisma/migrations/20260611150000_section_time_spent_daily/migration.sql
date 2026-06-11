-- Daily roll-up of section heartbeats for per-day time-on-platform breakdowns.

CREATE TABLE "section_time_spent_daily" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "totalSeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "section_time_spent_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "section_time_spent_daily_userId_courseId_day_key"
  ON "section_time_spent_daily"("userId", "courseId", "day");

CREATE INDEX "section_time_spent_daily_userId_day_idx"
  ON "section_time_spent_daily"("userId", "day");

CREATE INDEX "section_time_spent_daily_day_idx"
  ON "section_time_spent_daily"("day");

ALTER TABLE "section_time_spent_daily"
  ADD CONSTRAINT "section_time_spent_daily_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
