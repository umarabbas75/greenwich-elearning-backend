-- CreateEnum
CREATE TYPE "SectionQuestionGradingMode" AS ENUM ('PRACTICE', 'COUNTS_TOWARD_PROGRESS', 'INFORMATIONAL');

-- AlterEnum
ALTER TYPE "section_type" ADD VALUE IF NOT EXISTS 'AUTO_GRADED_QUESTION';

-- AlterTable
ALTER TABLE "sections" ADD COLUMN     "embeddedQuestionType" "QuestionType",
ADD COLUMN     "embeddedQuestionContent" JSONB,
ADD COLUMN     "embeddedQuestionMaxMarks" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "sectionQuestionGradingMode" "SectionQuestionGradingMode" NOT NULL DEFAULT 'INFORMATIONAL',
ADD COLUMN     "embeddedQuestionMaxAttempts" INTEGER,
ADD COLUMN     "embeddedRequireCorrectToProceed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "section_question_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "studentAnswer" JSONB NOT NULL,
    "systemScore" DOUBLE PRECISION NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "isFullyCorrect" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "section_question_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "section_question_attempts_userId_sectionId_idx" ON "section_question_attempts"("userId", "sectionId");

-- CreateIndex
CREATE INDEX "section_question_attempts_sectionId_idx" ON "section_question_attempts"("sectionId");

-- AddForeignKey
ALTER TABLE "section_question_attempts" ADD CONSTRAINT "section_question_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_question_attempts" ADD CONSTRAINT "section_question_attempts_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
