-- SCORM lesson-level progress (see docs/scorm-progress-parity-plan.md).
--
-- All additive. No column is renamed and nothing existing changes meaning, so
-- this deploys ahead of the code that writes it without a coordinated release.

-- Package: the parsed Rise lesson manifest and the chapter its sections live in.
ALTER TABLE "scorm_packages" ADD COLUMN IF NOT EXISTS "lessons" JSONB;
ALTER TABLE "scorm_packages" ADD COLUMN IF NOT EXISTS "lessonCount" INTEGER;
ALTER TABLE "scorm_packages" ADD COLUMN IF NOT EXISTS "chapterId" TEXT;
ALTER TABLE "scorm_packages" ADD COLUMN IF NOT EXISTS "riseCpv" TEXT;

-- Registration: decoded lesson progress, the bookmark (label only), and the
-- Cloud scalars the pull path now asks for.
ALTER TABLE "scorm_registrations" ADD COLUMN IF NOT EXISTS "lessonsCompleted" INTEGER;
ALTER TABLE "scorm_registrations" ADD COLUMN IF NOT EXISTS "progressSource" TEXT;
ALTER TABLE "scorm_registrations" ADD COLUMN IF NOT EXISTS "lessonsCompletedAtCertify" INTEGER;
ALTER TABLE "scorm_registrations" ADD COLUMN IF NOT EXISTS "attempts" INTEGER;
ALTER TABLE "scorm_registrations" ADD COLUMN IF NOT EXISTS "suspended" BOOLEAN;
ALTER TABLE "scorm_registrations" ADD COLUMN IF NOT EXISTS "locationRaw" TEXT;
ALTER TABLE "scorm_registrations" ADD COLUMN IF NOT EXISTS "lessonId" TEXT;
ALTER TABLE "scorm_registrations" ADD COLUMN IF NOT EXISTS "lessonIndex" INTEGER;
ALTER TABLE "scorm_registrations" ADD COLUMN IF NOT EXISTS "lessonTitle" TEXT;
ALTER TABLE "scorm_registrations" ADD COLUMN IF NOT EXISTS "completionAmount" DOUBLE PRECISION;
ALTER TABLE "scorm_registrations" ADD COLUMN IF NOT EXISTS "firstAccessAt" TIMESTAMP(3);
ALTER TABLE "scorm_registrations" ADD COLUMN IF NOT EXISTS "lastAccessAt" TIMESTAMP(3);
ALTER TABLE "scorm_registrations" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- The decoded completed-lesson SET, not just its size: a Rise re-attempt can
-- yield a different set of the same cardinality, which a count comparison reads
-- as "nothing changed".
--
-- Nullable, matching what Prisma generates for `Int[] @default([])` — a
-- NOT NULL here would show as drift in `prisma migrate diff`. The code reads it
-- through COALESCE either way.
ALTER TABLE "scorm_registrations"
  ADD COLUMN IF NOT EXISTS "lessonsCompletedIndices" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- Debounce anchor for the runtime pull. Deliberately NOT lastPostbackAt, which
-- every postback stamps — debouncing against that would skip the pull for
-- exactly the learners who are actively generating postbacks.
ALTER TABLE "scorm_registrations" ADD COLUMN IF NOT EXISTS "lastRuntimePullAt" TIMESTAMP(3);

-- The newest pull-ISSUE instant whose FULL detail has been applied (vs
-- lastRuntimePullAt, the latest attempt). lastPostbackAt > this means a
-- postback no later pull has seen: reconcile prioritises those rows and the
-- learner progress read refreshes them.
ALTER TABLE "scorm_registrations" ADD COLUMN IF NOT EXISTS "lastRuntimeAppliedAt" TIMESTAMP(3);

-- The (userId, packageId) unique leads with userId, so per-package reads (the
-- cpv corroboration count, the prune scan) had no index. And reconcile's
-- dirty-first selection is a recent range on lastPostbackAt, newest first.
-- Names are exactly what Prisma generates, so `migrate diff` shows no drift.
CREATE INDEX IF NOT EXISTS "scorm_registrations_packageId_idx" ON "scorm_registrations"("packageId");
CREATE INDEX IF NOT EXISTS "scorm_registrations_lastPostbackAt_idx" ON "scorm_registrations"("lastPostbackAt");
