/*
  Warnings:

  - Added the required column `moduleId` to the `UserCourseProgress` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "UserCourseProgress" ADD COLUMN     "moduleId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "UserCourseProgress" ADD CONSTRAINT "UserCourseProgress_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
