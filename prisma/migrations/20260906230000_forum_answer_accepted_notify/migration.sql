-- Solution-marked replies get their own in-app + email type.
-- PG 15+ allows ADD VALUE IF NOT EXISTS inside a migration transaction.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FORUM_ANSWER_ACCEPTED';
ALTER TYPE "EmailType" ADD VALUE IF NOT EXISTS 'NOTIFICATION_FORUM_ANSWER_ACCEPTED';
