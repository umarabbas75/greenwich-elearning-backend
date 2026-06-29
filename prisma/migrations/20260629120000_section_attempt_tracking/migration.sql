-- Section attempt counters (aggregate only — no per-attempt detail rows).
ALTER TABLE "section_time_spent"
  ADD COLUMN "totalAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "firstAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3);
