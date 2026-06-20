-- Add a configurable post-completion access window to courses.
--
-- validityDays = how many days a learner keeps access after completing the
-- course. Defaults to 365 (one year). Existing courses adopt the default
-- automatically; admins can override per-course on create/update.

ALTER TABLE "courses"
  ADD COLUMN "validityDays" INTEGER NOT NULL DEFAULT 365;
