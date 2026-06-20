-- Cascade-delete progress and last-seen rows when a section is deleted.
--
-- Background: deleting a section left UserCourseProgress rows orphaned (no FK
-- existed), and those stale rows still counted toward completion, inflating
-- course progress above 100%. LastSeenSection had a FK but it was ON DELETE
-- RESTRICT, forcing deleteSection() to remove dependents by hand. Both are now
-- ON DELETE CASCADE so section removal cleans up its dependent rows atomically.
--
-- Safe to apply: all existing orphaned UserCourseProgress rows were cleaned up
-- prior to this migration, so the new FK validates against existing data.

-- UserCourseProgress -> sections (new FK, cascade)
ALTER TABLE "UserCourseProgress"
  ADD CONSTRAINT "UserCourseProgress_sectionId_fkey"
  FOREIGN KEY ("sectionId") REFERENCES "sections"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- LastSeenSection -> sections (replace existing RESTRICT FK with cascade)
ALTER TABLE "LastSeenSection"
  DROP CONSTRAINT "LastSeenSection_sectionId_fkey";

ALTER TABLE "LastSeenSection"
  ADD CONSTRAINT "LastSeenSection_sectionId_fkey"
  FOREIGN KEY ("sectionId") REFERENCES "sections"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
