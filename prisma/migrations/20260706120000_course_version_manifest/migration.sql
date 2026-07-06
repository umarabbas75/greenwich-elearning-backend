-- AlterTable
ALTER TABLE "course_versions" ADD COLUMN "manifest" JSONB;
ALTER TABLE "course_versions" ADD COLUMN "sectionCount" INTEGER;
