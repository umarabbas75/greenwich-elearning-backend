/*
  Warnings:

  - Made the column `courseId` on table `assignment_submissions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `courseId` on table `assignments` required. This step will fail if there are existing NULL values in that column.
  - Made the column `createdByAdminId` on table `assignments` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "assignment_submissions" DROP CONSTRAINT "assignment_submissions_courseId_fkey";

-- DropForeignKey
ALTER TABLE "assignments" DROP CONSTRAINT "assignments_courseId_fkey";

-- DropForeignKey
ALTER TABLE "assignments" DROP CONSTRAINT "assignments_createdByAdminId_fkey";

-- AlterTable
ALTER TABLE "assignment_submissions" ALTER COLUMN "courseId" SET NOT NULL;

-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "assignmentFileName" TEXT,
ADD COLUMN     "assignmentFileType" "AssignmentFileType",
ADD COLUMN     "assignmentFileUrl" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "courseId" SET NOT NULL,
ALTER COLUMN "createdByAdminId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "assignments_isActive_idx" ON "assignments"("isActive");

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
