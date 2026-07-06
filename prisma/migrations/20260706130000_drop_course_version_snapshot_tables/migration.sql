-- Drop heavy snapshot tables; structure is stored in course_versions.manifest only.
-- Run backfill-course-version-manifests.ts BEFORE this migration.

DROP TABLE IF EXISTS "course_version_quizzes";
DROP TABLE IF EXISTS "course_version_sections";
DROP TABLE IF EXISTS "course_version_chapters";
DROP TABLE IF EXISTS "course_version_modules";
