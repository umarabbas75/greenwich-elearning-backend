-- Force password change on first login for admin-created accounts.
-- Set true when an admin creates the account; cleared after the user sets their
-- own password. Existing rows default to false (they have chosen passwords or
-- are pre-existing — we don't retroactively force a change).
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
