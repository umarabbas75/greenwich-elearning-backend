-- AlterEnum
ALTER TYPE "EmailType" ADD VALUE IF NOT EXISTS 'CERTIFICATE_ISSUED';

-- AlterTable
ALTER TABLE "course_completions" ADD COLUMN IF NOT EXISTS "certificateId" TEXT;
ALTER TABLE "course_completions" ADD COLUMN IF NOT EXISTS "certificateIssuedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "course_completions_certificateId_key" ON "course_completions"("certificateId");
