-- CreateEnum
CREATE TYPE "AssignmentGradingMode" AS ENUM ('numeric', 'pass_fail');

-- AlterTable
ALTER TABLE "assignments" ADD COLUMN "gradingMode" "AssignmentGradingMode" NOT NULL DEFAULT 'numeric';
