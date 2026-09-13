-- In-app bell when a certificate is issued. Email already uses EmailType.CERTIFICATE_ISSUED.
-- PG 15+ allows ADD VALUE IF NOT EXISTS inside a migration transaction.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CERTIFICATE_ISSUED';
