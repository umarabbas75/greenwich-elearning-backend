-- Ensure new courses default to NONE (certificates opt-in).
ALTER TABLE "courses" ALTER COLUMN "certificateIssueMode" SET DEFAULT 'NONE';
