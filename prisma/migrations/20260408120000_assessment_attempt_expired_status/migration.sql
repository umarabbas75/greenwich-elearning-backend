-- Add EXPIRED to assessment attempt lifecycle (timed assessments that were never submitted)
ALTER TYPE "AssessmentAttemptStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
