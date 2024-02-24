/*
  Warnings:

  - You are about to drop the column `completed` on the `UserCourseProgress` table. All the data in the column will be lost.
  - You are about to drop the column `progress` on the `UserCourseProgress` table. All the data in the column will be lost.
  - Added the required column `chapterId` to the `UserCourseProgress` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "UserCourseProgress" DROP COLUMN "completed",
DROP COLUMN "progress",
ADD COLUMN     "chapterId" TEXT NOT NULL;
