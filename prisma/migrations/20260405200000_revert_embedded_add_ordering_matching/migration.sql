-- Revert AUTO_GRADED_QUESTION storage (attempts table + section columns + grading enum)
DROP TABLE IF EXISTS "section_question_attempts";

ALTER TABLE "sections" DROP COLUMN IF EXISTS "embeddedQuestionType";
ALTER TABLE "sections" DROP COLUMN IF EXISTS "embeddedQuestionContent";
ALTER TABLE "sections" DROP COLUMN IF EXISTS "embeddedQuestionMaxMarks";
ALTER TABLE "sections" DROP COLUMN IF EXISTS "sectionQuestionGradingMode";
ALTER TABLE "sections" DROP COLUMN IF EXISTS "embeddedQuestionMaxAttempts";
ALTER TABLE "sections" DROP COLUMN IF EXISTS "embeddedRequireCorrectToProceed";

DROP TYPE IF EXISTS "SectionQuestionGradingMode";

-- Any legacy rows using removed app enum value — move to DEFAULT so app can read them
UPDATE "sections" SET "type" = 'DEFAULT' WHERE "type" = 'AUTO_GRADED_QUESTION';

-- New lesson section kinds (PostgreSQL cannot remove old enum labels safely; AUTO_GRADED_QUESTION may remain unused in DB)
ALTER TYPE "section_type" ADD VALUE IF NOT EXISTS 'ORDERING';
ALTER TYPE "section_type" ADD VALUE IF NOT EXISTS 'MATCHING';
