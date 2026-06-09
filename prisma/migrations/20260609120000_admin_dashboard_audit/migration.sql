-- Admin dashboard instrumentation: email send log + security event audit, and a
-- passwordChangedAt timestamp on users. All additive and default-safe.

-- ── Enums ──────────────────────────────────────────────────────────────────
CREATE TYPE "EmailType" AS ENUM ('ENGAGEMENT_REMINDER', 'PASSWORD_RESET');
CREATE TYPE "EmailStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');
CREATE TYPE "SecurityEventType" AS ENUM (
  'PASSWORD_RESET_COMPLETED',
  'PASSWORD_CHANGED_FIRST_LOGIN',
  'PASSWORD_CHANGED'
);

-- ── users.passwordChangedAt ─────────────────────────────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);

-- Backfill from completed forgot-password resets (best-effort history). The
-- force-change flow had no prior record, so those remain null until next change.
UPDATE "users" u
   SET "passwordChangedAt" = pr."consumedAt"
  FROM (
    SELECT DISTINCT ON ("userId") "userId", "consumedAt"
      FROM "password_resets"
     WHERE "consumedAt" IS NOT NULL
     ORDER BY "userId", "consumedAt" DESC
  ) pr
 WHERE pr."userId" = u."id" AND u."passwordChangedAt" IS NULL;

-- ── email_logs ──────────────────────────────────────────────────────────────
CREATE TABLE "email_logs" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT,
  "recipient"  TEXT NOT NULL,
  "type"       "EmailType" NOT NULL,
  "status"     "EmailStatus" NOT NULL,
  "providerId" TEXT,
  "error"      TEXT,
  "metadata"   JSONB,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "email_logs_type_createdAt_idx" ON "email_logs" ("type", "createdAt" DESC);
CREATE INDEX "email_logs_userId_createdAt_idx" ON "email_logs" ("userId", "createdAt" DESC);
CREATE INDEX "email_logs_status_createdAt_idx" ON "email_logs" ("status", "createdAt" DESC);
ALTER TABLE "email_logs"
  ADD CONSTRAINT "email_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── security_events ─────────────────────────────────────────────────────────
CREATE TABLE "security_events" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "type"      "SecurityEventType" NOT NULL,
  "actorId"   TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "security_events_userId_createdAt_idx" ON "security_events" ("userId", "createdAt" DESC);
CREATE INDEX "security_events_type_createdAt_idx" ON "security_events" ("type", "createdAt" DESC);
ALTER TABLE "security_events"
  ADD CONSTRAINT "security_events_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
