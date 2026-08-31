-- Synthetic one-section tree for an imported SCORM package.
-- ALTER TYPE … ADD VALUE cannot share a transaction with a later statement
-- that reads the new value — keep this migration to only the enum addition.
ALTER TYPE "section_type" ADD VALUE IF NOT EXISTS 'SCORM';
