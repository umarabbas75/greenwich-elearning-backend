/*
  Warnings:

  - A unique constraint covering the columns `[quizId]` on the table `chapters` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "chapters_quizId_key" ON "chapters"("quizId");

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
