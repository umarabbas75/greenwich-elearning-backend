/*
  Warnings:

  - A unique constraint covering the columns `[userId,courseId,chapterId,sectionId]` on the table `UserCourseProgress` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "UserCourseProgress_userId_courseId_key";

-- CreateIndex
CREATE UNIQUE INDEX "UserCourseProgress_userId_courseId_chapterId_sectionId_key" ON "UserCourseProgress"("userId", "courseId", "chapterId", "sectionId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");
