-- Course feedback contract: normalised columns, notification + email types.

CREATE TYPE "FeedbackOverallRating" AS ENUM (
  'excellent',
  'very_good',
  'good',
  'fair',
  'poor'
);

ALTER TABLE "course_feedback_submissions"
  ADD COLUMN "formVersion" TEXT,
  ADD COLUMN "meanRating" DECIMAL(3, 2),
  ADD COLUMN "overallRating" "FeedbackOverallRating",
  ADD COLUMN "learnerEmail" TEXT;

CREATE INDEX "course_feedback_submissions_courseId_submittedAt_idx"
  ON "course_feedback_submissions"("courseId", "submittedAt" DESC);

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COURSE_FEEDBACK_REQUIRED';
ALTER TYPE "EmailType" ADD VALUE IF NOT EXISTS 'FEEDBACK_REMINDER';
