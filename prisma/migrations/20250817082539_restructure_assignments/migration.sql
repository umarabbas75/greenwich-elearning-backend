/*
  Warnings:

  - You are about to drop the column `courseId` on the `assignment_submissions` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[assignmentId,studentId]` on the table `assignment_submissions` will be added. If there are existing duplicate values, this will fail.
  - Made the column `assignmentId` on table `assignment_submissions` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `assignedToAdminId` to the `assignments` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "assignment_submissions" DROP CONSTRAINT "assignment_submissions_assignmentId_fkey";

-- DropForeignKey
ALTER TABLE "assignment_submissions" DROP CONSTRAINT "assignment_submissions_courseId_fkey";

-- DropIndex
DROP INDEX "assignment_submissions_assignmentId_studentId_idx";

-- DropIndex
DROP INDEX "assignment_submissions_courseId_idx";

-- AlterTable
ALTER TABLE "assignment_submissions" DROP COLUMN "courseId",
ALTER COLUMN "assignmentId" SET NOT NULL;

-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "assignedToAdminId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "assignment_submissions_assignmentId_idx" ON "assignment_submissions"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submissions_assignmentId_studentId_key" ON "assignment_submissions"("assignmentId", "studentId");

-- CreateIndex
CREATE INDEX "assignments_assignedToAdminId_idx" ON "assignments"("assignedToAdminId");

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assignedToAdminId_fkey" FOREIGN KEY ("assignedToAdminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
