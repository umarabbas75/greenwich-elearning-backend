-- Catalogue courses are either author-built (NATIVE) or a single imported
-- SCORM package (IMPORTED_SCORM). Default keeps every existing course native.

CREATE TYPE "course_delivery_mode" AS ENUM ('NATIVE', 'IMPORTED_SCORM');

ALTER TABLE "courses"
  ADD COLUMN "deliveryMode" "course_delivery_mode" NOT NULL DEFAULT 'NATIVE';
