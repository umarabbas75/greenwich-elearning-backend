-- Learner registration against one ScormPackage. Cloud posts back payload.id
-- = scormCloudRegistrationId. completeOn is copied at create and never re-read
-- from the live tree (replace-package must not change v1 policy).

CREATE TABLE "scorm_registrations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "completeOn" TEXT NOT NULL,
    "scormCloudRegistrationId" TEXT NOT NULL,
    "completionStatus" TEXT NOT NULL DEFAULT 'unknown',
    "successStatus" TEXT NOT NULL DEFAULT 'unknown',
    "scoreScaled" DOUBLE PRECISION,
    "totalTimeSeconds" DOUBLE PRECISION,
    "firstLaunchAt" TIMESTAMP(3),
    "lastPostbackAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scorm_registrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scorm_registrations_scormCloudRegistrationId_key"
  ON "scorm_registrations"("scormCloudRegistrationId");
CREATE UNIQUE INDEX "scorm_registrations_userId_packageId_key"
  ON "scorm_registrations"("userId", "packageId");
CREATE INDEX "scorm_registrations_courseId_completionStatus_idx"
  ON "scorm_registrations"("courseId", "completionStatus");
CREATE INDEX "scorm_registrations_userId_courseId_idx"
  ON "scorm_registrations"("userId", "courseId");

ALTER TABLE "scorm_registrations"
  ADD CONSTRAINT "scorm_registrations_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scorm_registrations"
  ADD CONSTRAINT "scorm_registrations_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "scorm_packages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
