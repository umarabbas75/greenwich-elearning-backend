-- Follow-ups to the 17 Oct IGC incident: admin edits must not change the
-- rules for learners who already have state. All changes are additive, and
-- every backfill keeps existing requirements applying exactly as they do now.

-- Course forms: the moment a form starts applying, kept separate from
-- createdAt so switching a form from optional to required only affects later
-- enrolments. Existing forms keep their current anchor.
ALTER TABLE "course_forms"
  ADD COLUMN "requiredSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "course_forms" SET "requiredSince" = "createdAt";

-- Removing a form from a course now detaches it instead of deleting the row,
-- which used to cascade every learner's submission. detachedWindows records
-- every period it was removed for, so re-adding it does not reach learners
-- who enrolled in one of them.
ALTER TABLE "course_forms" ADD COLUMN "detachedAt" TIMESTAMP(3);
ALTER TABLE "course_forms" ADD COLUMN "detachedWindows" JSONB;

-- Feedback is only owed by completions at or after the moment it became
-- required. Under the old code a save recreated the form, so its createdAt is
-- the last save rather than when feedback became required; backfilling from
-- the course's creation keeps every existing completer owing it, as today.
ALTER TABLE "course_feedback_forms"
  ADD COLUMN "requiredSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "course_feedback_forms" ff
SET "requiredSince" = c."createdAt"
FROM "courses" c
WHERE c."id" = ff."courseId";

-- Policy items get their own anchor, so an item added to (or made required
-- on) an existing policy only applies to later enrolments. Existing items
-- inherit their policy's date, which is what applies to them today.
ALTER TABLE "policy_items"
  ADD COLUMN "requiredSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "policy_items" i
SET "requiredSince" = p."createdAt"
FROM "policies" p
WHERE p."id" = i."policyId";

-- The access window granted at completion. Lowering course.validityDays later
-- must not shorten it. Existing completions keep the course's current value.
ALTER TABLE "course_completions" ADD COLUMN "validityDaysAtCompletion" INTEGER;
UPDATE "course_completions" cc
SET "validityDaysAtCompletion" = c."validityDays"
FROM "courses" c
WHERE c."id" = cc."courseId"
  AND cc."courseCompletedAt" IS NOT NULL;
