-- DropForeignKey
ALTER TABLE "match_and_learn" DROP CONSTRAINT IF EXISTS "match_and_learn_chapterId_fkey";

-- DropForeignKey
ALTER TABLE "match_and_learn_items" DROP CONSTRAINT IF EXISTS "match_and_learn_items_matchAndLearnId_fkey";

-- DropForeignKey
ALTER TABLE "match_and_learn_progress" DROP CONSTRAINT IF EXISTS "match_and_learn_progress_userId_fkey";

-- DropForeignKey
ALTER TABLE "match_and_learn_progress" DROP CONSTRAINT IF EXISTS "match_and_learn_progress_chapterId_fkey";

-- DropForeignKey
ALTER TABLE "match_and_learn_progress" DROP CONSTRAINT IF EXISTS "match_and_learn_progress_matchAndLearnId_fkey";

-- DropTable
DROP TABLE IF EXISTS "match_and_learn_progress";

-- DropTable
DROP TABLE IF EXISTS "match_and_learn_items";

-- DropTable
DROP TABLE IF EXISTS "match_and_learn";
