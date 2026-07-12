-- Reconstructed to reconcile divergent migration history.
-- This migration was applied to production on 2026-06-27 but its folder was
-- never committed, causing `prisma migrate deploy` to abort on the divergence.
-- Recorded name is "add_embed_section_type"; production's section_type enum also
-- carries AUTO_GRADED_QUESTION, so both values are added idempotently here.
-- Safe to re-run: ADD VALUE IF NOT EXISTS is a no-op when the value is present.

ALTER TYPE "section_type" ADD VALUE IF NOT EXISTS 'AUTO_GRADED_QUESTION';
ALTER TYPE "section_type" ADD VALUE IF NOT EXISTS 'EMBED';
