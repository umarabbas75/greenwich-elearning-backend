/*
  Warnings:

  - A unique constraint covering the columns `[userId,quizId,chapterId]` on the table `quiz_answers` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "quiz_answers_userId_quizId_chapterId_key" ON "quiz_answers"("userId", "quizId", "chapterId");
