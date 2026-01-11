-- AlterEnum: Add VISUAL_ACTIVITY to section_type enum
ALTER TYPE "section_type" ADD VALUE IF NOT EXISTS 'VISUAL_ACTIVITY';

-- AlterTable: Add Visual Activity specific fields to sections table
DO $$ BEGIN
    ALTER TABLE "sections" ADD COLUMN "questionText" TEXT;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sections" ADD COLUMN "imageUrl" TEXT;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sections" ADD COLUMN "allowMultipleSelection" BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sections" ADD COLUMN "options" JSONB;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;
