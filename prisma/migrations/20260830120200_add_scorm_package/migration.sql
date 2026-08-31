-- One imported package (SCORM Cloud course) per version of a catalogue Course.
-- completeOn is stored on the package so complete-import can build Section.config
-- after the original HTTP request returns (Cloud import jobs are async).

CREATE TYPE "scorm_package_status" AS ENUM ('PROCESSING', 'READY', 'FAILED', 'SUPERSEDED');

CREATE TABLE "scorm_packages" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "sectionId" TEXT,
    "title" TEXT NOT NULL,
    "scormCloudCourseId" TEXT NOT NULL,
    "cloudImportJobId" TEXT,
    "zipSha256" TEXT,
    "riseProbeJson" JSONB,
    "completeOn" TEXT NOT NULL,
    "passingScore" INTEGER,
    "status" "scorm_package_status" NOT NULL DEFAULT 'PROCESSING',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scorm_packages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scorm_packages_courseId_versionNumber_key" ON "scorm_packages"("courseId", "versionNumber");
CREATE INDEX "scorm_packages_courseId_status_idx" ON "scorm_packages"("courseId", "status");

ALTER TABLE "scorm_packages"
  ADD CONSTRAINT "scorm_packages_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "courses"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
