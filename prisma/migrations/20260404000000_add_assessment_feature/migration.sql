-- =============================================================================
-- Migration: add_assessment_feature
-- Safe, additive-only migration. No existing columns or tables are dropped.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: New enums
-- ---------------------------------------------------------------------------

CREATE TYPE "NotificationType" AS ENUM ('FORUM_COMMENT', 'FORUM_THREAD', 'ASSESSMENT_SUBMITTED', 'ASSESSMENT_GRADED');

CREATE TYPE "QuestionType" AS ENUM (
  'SINGLE_CHOICE',
  'MULTIPLE_CHOICE',
  'TRUE_FALSE',
  'FILL_IN_THE_BLANK',
  'SHORT_ANSWER',
  'LONG_ANSWER',
  'ORDERING',
  'MATCHING',
  'VISUAL_ACTIVITY'
);

CREATE TYPE "QuestionDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');
CREATE TYPE "AssessmentMode" AS ENUM ('MANUAL', 'AUTOMATIC');
CREATE TYPE "AssessmentAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'AUTO_GRADED', 'GRADED', 'FINALIZED');

-- ---------------------------------------------------------------------------
-- Step 2: Alter notifications table (SAFE — existing rows retain their threadId)
-- ---------------------------------------------------------------------------

-- 2a. Drop existing FK so we can alter the column
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_threadId_fkey";

-- 2b. Make threadId nullable (existing rows keep their values — no data loss)
ALTER TABLE "notifications" ALTER COLUMN "threadId" DROP NOT NULL;

-- 2c. Re-add FK as nullable-compatible
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "forum_threads"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2d. Add new columns with defaults (idempotent)
DO $$ BEGIN
  ALTER TABLE "notifications" ADD COLUMN "type" "NotificationType" NOT NULL DEFAULT 'FORUM_COMMENT';
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "notifications" ADD COLUMN "referenceId" TEXT;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- ---------------------------------------------------------------------------
-- Step 3: Create new tables (in FK dependency order)
-- ---------------------------------------------------------------------------

-- 3a. question_categories (depends on: courses)
CREATE TABLE "question_categories" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "courseId"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "question_categories_pkey" PRIMARY KEY ("id")
);

-- 3b. questions (depends on: courses, question_categories)
CREATE TABLE "questions" (
  "id"         TEXT NOT NULL,
  "courseId"   TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "type"       "QuestionType" NOT NULL,
  "difficulty" "QuestionDifficulty" NOT NULL DEFAULT 'MEDIUM',
  "text"       TEXT NOT NULL,
  "imageUrl"   TEXT,
  "content"    JSONB NOT NULL,
  "maxMarks"   DOUBLE PRECISION NOT NULL DEFAULT 1,
  "isActive"   BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- 3c. assessments (depends on: courses, users)
CREATE TABLE "assessments" (
  "id"                TEXT NOT NULL,
  "courseId"          TEXT NOT NULL,
  "title"             TEXT NOT NULL,
  "description"       TEXT,
  "mode"              "AssessmentMode" NOT NULL DEFAULT 'MANUAL',
  "isActive"          BOOLEAN NOT NULL DEFAULT false,
  "passingPercentage" DOUBLE PRECISION NOT NULL DEFAULT 60,
  "timeLimitMinutes"  INTEGER,
  "maxAttempts"       INTEGER,
  "autoConfig"        JSONB,
  "createdByAdminId"  TEXT NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- 3d. assessment_questions (depends on: assessments, questions)
CREATE TABLE "assessment_questions" (
  "id"            TEXT NOT NULL,
  "assessmentId"  TEXT NOT NULL,
  "questionId"    TEXT NOT NULL,
  "orderIndex"    INTEGER NOT NULL DEFAULT 0,
  "marksOverride" DOUBLE PRECISION,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assessment_questions_pkey" PRIMARY KEY ("id")
);

-- 3e. assessment_attempts (depends on: assessments, users)
CREATE TABLE "assessment_attempts" (
  "id"                   TEXT NOT NULL,
  "assessmentId"         TEXT NOT NULL,
  "userId"               TEXT NOT NULL,
  "status"               "AssessmentAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "snapshotTitle"        TEXT NOT NULL,
  "snapshotPassingPct"   DOUBLE PRECISION NOT NULL,
  "snapshotMaxAttempts"  INTEGER,
  "snapshotTimeLimitMin" INTEGER,
  "totalMarks"           DOUBLE PRECISION,
  "marksObtained"        DOUBLE PRECISION,
  "percentage"           DOUBLE PRECISION,
  "isPassed"             BOOLEAN,
  "startedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt"          TIMESTAMP(3),
  "gradedAt"             TIMESTAMP(3),
  "finalizedAt"          TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assessment_attempts_pkey" PRIMARY KEY ("id")
);

-- 3f. attempt_question_snapshots (depends on: assessment_attempts)
CREATE TABLE "attempt_question_snapshots" (
  "id"               TEXT NOT NULL,
  "attemptId"        TEXT NOT NULL,
  "questionId"       TEXT NOT NULL,
  "orderIndex"       INTEGER NOT NULL DEFAULT 0,
  "questionType"     "QuestionType" NOT NULL,
  "questionText"     TEXT NOT NULL,
  "questionImageUrl" TEXT,
  "questionContent"  JSONB NOT NULL,
  "maxMarks"         DOUBLE PRECISION NOT NULL,
  "studentAnswer"    JSONB,
  "isAnswered"       BOOLEAN NOT NULL DEFAULT false,
  "isLocked"         BOOLEAN NOT NULL DEFAULT false,
  "systemScore"      DOUBLE PRECISION,
  "adminScore"       DOUBLE PRECISION,
  "finalScore"       DOUBLE PRECISION,
  "adminFeedback"    TEXT,
  "gradedAt"         TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attempt_question_snapshots_pkey" PRIMARY KEY ("id")
);

-- 3g. course_completions (depends on: users, courses, assessment_attempts)
CREATE TABLE "course_completions" (
  "id"                 TEXT NOT NULL,
  "userId"             TEXT NOT NULL,
  "courseId"           TEXT NOT NULL,
  "isPassed"           BOOLEAN NOT NULL DEFAULT false,
  "bestAttemptId"      TEXT,
  "certificateUrl"     TEXT,
  "courseCompletedAt"  TIMESTAMP(3),
  "assessmentPassedAt" TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "course_completions_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Step 4: Unique constraints
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "question_categories_courseId_name_key" ON "question_categories"("courseId", "name");
CREATE UNIQUE INDEX "assessment_questions_assessmentId_questionId_key" ON "assessment_questions"("assessmentId", "questionId");
CREATE UNIQUE INDEX "course_completions_userId_courseId_key" ON "course_completions"("userId", "courseId");
CREATE UNIQUE INDEX "course_completions_bestAttemptId_key" ON "course_completions"("bestAttemptId");

-- ---------------------------------------------------------------------------
-- Step 5: Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX "question_categories_courseId_idx" ON "question_categories"("courseId");
CREATE INDEX "questions_courseId_idx" ON "questions"("courseId");
CREATE INDEX "questions_courseId_categoryId_idx" ON "questions"("courseId", "categoryId");
CREATE INDEX "questions_courseId_difficulty_idx" ON "questions"("courseId", "difficulty");
CREATE INDEX "questions_courseId_type_idx" ON "questions"("courseId", "type");
CREATE INDEX "questions_isActive_idx" ON "questions"("isActive");
CREATE INDEX "assessments_courseId_idx" ON "assessments"("courseId");
CREATE INDEX "assessments_courseId_isActive_idx" ON "assessments"("courseId", "isActive");
CREATE INDEX "assessments_createdByAdminId_idx" ON "assessments"("createdByAdminId");
CREATE INDEX "assessment_questions_assessmentId_idx" ON "assessment_questions"("assessmentId");
CREATE INDEX "assessment_attempts_assessmentId_idx" ON "assessment_attempts"("assessmentId");
CREATE INDEX "assessment_attempts_userId_idx" ON "assessment_attempts"("userId");
CREATE INDEX "assessment_attempts_userId_assessmentId_idx" ON "assessment_attempts"("userId", "assessmentId");
CREATE INDEX "assessment_attempts_status_idx" ON "assessment_attempts"("status");
CREATE INDEX "attempt_question_snapshots_attemptId_idx" ON "attempt_question_snapshots"("attemptId");
CREATE INDEX "attempt_question_snapshots_questionId_idx" ON "attempt_question_snapshots"("questionId");
CREATE INDEX "attempt_question_snapshots_attemptId_isAnswered_idx" ON "attempt_question_snapshots"("attemptId", "isAnswered");
CREATE INDEX "course_completions_userId_courseId_idx" ON "course_completions"("userId", "courseId");
CREATE INDEX "course_completions_userId_isPassed_idx" ON "course_completions"("userId", "isPassed");

-- ---------------------------------------------------------------------------
-- Step 6: Foreign key constraints
-- ---------------------------------------------------------------------------

ALTER TABLE "question_categories"
  ADD CONSTRAINT "question_categories_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "questions"
  ADD CONSTRAINT "questions_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "questions"
  ADD CONSTRAINT "questions_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "question_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assessments"
  ADD CONSTRAINT "assessments_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assessments"
  ADD CONSTRAINT "assessments_createdByAdminId_fkey"
  FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assessment_questions"
  ADD CONSTRAINT "assessment_questions_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assessment_questions"
  ADD CONSTRAINT "assessment_questions_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assessment_attempts"
  ADD CONSTRAINT "assessment_attempts_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assessment_attempts"
  ADD CONSTRAINT "assessment_attempts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attempt_question_snapshots"
  ADD CONSTRAINT "attempt_question_snapshots_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "assessment_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "course_completions"
  ADD CONSTRAINT "course_completions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "course_completions"
  ADD CONSTRAINT "course_completions_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "course_completions"
  ADD CONSTRAINT "course_completions_bestAttemptId_fkey"
  FOREIGN KEY ("bestAttemptId") REFERENCES "assessment_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
