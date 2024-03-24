/*
  Warnings:

  - A unique constraint covering the columns `[userId,quizId]` on the table `quiz_answers` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "quiz_answers_userId_quizId_chapterId_key";

-- CreateIndex
CREATE UNIQUE INDEX "quiz_answers_userId_quizId_key" ON "quiz_answers"("userId", "quizId");
