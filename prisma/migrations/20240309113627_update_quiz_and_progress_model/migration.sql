/*
  Warnings:

  - Added the required column `sectionId` to the `UserCourseProgress` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "UserCourseProgress" ADD COLUMN     "sectionId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "quizzes" ALTER COLUMN "chapterId" DROP NOT NULL;
