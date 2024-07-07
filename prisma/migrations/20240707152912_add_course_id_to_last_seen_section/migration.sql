/*
  Warnings:

  - Added the required column `courseId` to the `LastSeenSection` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "LastSeenSection" ADD COLUMN     "courseId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "LastSeenSection" ADD CONSTRAINT "LastSeenSection_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
