-- DropIndex
DROP INDEX "match_and_learn_chapterId_orderIndex_idx";

-- AlterTable
ALTER TABLE "match_and_learn" ALTER COLUMN "orderIndex" SET DEFAULT '0',
ALTER COLUMN "orderIndex" SET DATA TYPE TEXT;
