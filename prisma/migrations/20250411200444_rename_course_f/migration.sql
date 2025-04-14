/*
  Warnings:

  - Added the required column `courseFormId` to the `user_form_completions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "user_form_completions" ADD COLUMN     "courseFormId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "user_form_completions" ADD CONSTRAINT "user_form_completions_courseFormId_fkey" FOREIGN KEY ("courseFormId") REFERENCES "course_forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
