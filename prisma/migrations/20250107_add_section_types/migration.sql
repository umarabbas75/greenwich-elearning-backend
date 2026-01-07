-- CreateEnum
CREATE TYPE "section_type" AS ENUM ('DEFAULT', 'MATCH_AND_LEARN');

-- AlterTable
ALTER TABLE "sections" ADD COLUMN "type" "section_type" NOT NULL DEFAULT 'DEFAULT';

-- AlterTable
ALTER TABLE "sections" ADD COLUMN "itemLabel" TEXT;

-- AlterTable
ALTER TABLE "sections" ADD COLUMN "categoryLabel" TEXT;

-- AlterTable
ALTER TABLE "sections" ADD COLUMN "categories" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "sections" ADD COLUMN "maxPerCategory" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "sections" ADD COLUMN "orderIndex" TEXT NOT NULL DEFAULT '0';

-- AlterTable
ALTER TABLE "sections" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "sections" ADD COLUMN "items" JSONB;

-- AlterTable
ALTER TABLE "sections" ADD COLUMN "config" JSONB;
