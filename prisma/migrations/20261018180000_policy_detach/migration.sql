-- Removing a policy (or an item from one) used to delete it together with
-- every learner's acknowledgement. It is now detached instead, so the
-- acknowledgements survive as evidence. Re-adding it re-attaches the same row;
-- detachedWindows records every period it was removed for, so it does not
-- reach learners who enrolled in one of them (same as course_forms).
-- Additive: existing rows stay attached and apply exactly as they do now.
ALTER TABLE "policies" ADD COLUMN "detachedAt" TIMESTAMP(3);
ALTER TABLE "policies" ADD COLUMN "detachedWindows" JSONB;
ALTER TABLE "policy_items" ADD COLUMN "detachedAt" TIMESTAMP(3);
ALTER TABLE "policy_items" ADD COLUMN "detachedWindows" JSONB;
