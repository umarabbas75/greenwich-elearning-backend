-- Existing courses were created when the column default was MANUAL.
-- Opt-in only: reset legacy MANUAL rows to NONE (AUTO courses unchanged).
UPDATE "courses" SET "certificateIssueMode" = 'NONE' WHERE "certificateIssueMode" = 'MANUAL';
