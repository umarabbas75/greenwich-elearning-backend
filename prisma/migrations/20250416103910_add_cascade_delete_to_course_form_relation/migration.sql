-- DropForeignKey
ALTER TABLE "user_form_completions" DROP CONSTRAINT "user_form_completions_courseFormId_fkey";

-- AddForeignKey
ALTER TABLE "user_form_completions" ADD CONSTRAINT "user_form_completions_courseFormId_fkey" FOREIGN KEY ("courseFormId") REFERENCES "course_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
