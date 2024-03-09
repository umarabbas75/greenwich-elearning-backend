-- DropForeignKey
ALTER TABLE "chapters" DROP CONSTRAINT "chapters_quizId_fkey";

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
