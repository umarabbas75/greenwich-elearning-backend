-- CreateEnum (only if it doesn't exist)
DO $$ BEGIN
    CREATE TYPE "section_type" AS ENUM ('DEFAULT', 'MATCH_AND_LEARN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable (add columns only if they don't exist)
DO $$ BEGIN
    ALTER TABLE "sections" ADD COLUMN "type" "section_type" NOT NULL DEFAULT 'DEFAULT';
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sections" ADD COLUMN "itemLabel" TEXT;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sections" ADD COLUMN "categoryLabel" TEXT;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sections" ADD COLUMN "categories" TEXT[] DEFAULT ARRAY[]::TEXT[];
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sections" ADD COLUMN "maxPerCategory" INTEGER NOT NULL DEFAULT 1;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sections" ADD COLUMN "orderIndex" TEXT NOT NULL DEFAULT '0';
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sections" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sections" ADD COLUMN "items" JSONB;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sections" ADD COLUMN "config" JSONB;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;
