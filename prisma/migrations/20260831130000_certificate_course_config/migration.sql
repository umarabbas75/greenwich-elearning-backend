-- CreateEnum
CREATE TYPE "CertificateIssueMode" AS ENUM ('AUTO', 'MANUAL', 'NONE');
CREATE TYPE "CertificateSource" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "certificateIssueMode" "CertificateIssueMode" NOT NULL DEFAULT 'NONE';

ALTER TABLE "course_completions" ADD COLUMN IF NOT EXISTS "certificateSource" "CertificateSource";
ALTER TABLE "course_completions" ADD COLUMN IF NOT EXISTS "certificateIssuedByAdminId" TEXT;
