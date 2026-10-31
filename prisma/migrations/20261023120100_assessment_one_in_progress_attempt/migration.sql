-- A learner has at most one IN_PROGRESS attempt per assessment. startAttempt
-- checks for one first, but two near-simultaneous Start clicks could both pass
-- that check and create two.
--
-- Any existing duplicates keep the newest open; older ones become EXPIRED so
-- the index below can be built.
UPDATE "assessment_attempts" a
SET "status" = 'EXPIRED'
WHERE a."status" = 'IN_PROGRESS'
  AND EXISTS (
    SELECT 1 FROM "assessment_attempts" b
    WHERE b."userId" = a."userId"
      AND b."assessmentId" = a."assessmentId"
      AND b."status" = 'IN_PROGRESS'
      AND (b."startedAt", b."id") > (a."startedAt", a."id")
  );

-- Partial unique index, not expressible in schema.prisma.
CREATE UNIQUE INDEX "assessment_attempts_one_in_progress" ON "assessment_attempts"("userId", "assessmentId") WHERE "status" = 'IN_PROGRESS';
