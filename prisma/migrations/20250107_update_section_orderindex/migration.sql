-- AlterTable: Change orderIndex from String with default "0" to Int? with NULL default
-- Drop the old column and recreate as INTEGER (nullable, no default)
DO $$ BEGIN
    ALTER TABLE "sections" DROP COLUMN IF EXISTS "orderIndex";
EXCEPTION
    WHEN undefined_column THEN null;
END $$;

-- Add the new orderIndex column as INTEGER (nullable, NULL default)
DO $$ BEGIN
    ALTER TABLE "sections" ADD COLUMN "orderIndex" INTEGER;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;
