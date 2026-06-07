-- Forgot-password flow: hashed, single-use, short-TTL OTPs with rate-limit
-- counters. Plaintext codes/tokens are never stored — only argon2 hashes.

CREATE TABLE IF NOT EXISTS "password_resets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "resetTokenHash" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- Hot path: find the latest active (un-consumed) reset for a user.
CREATE INDEX IF NOT EXISTS "password_resets_userId_consumedAt_createdAt_idx"
  ON "password_resets" ("userId", "consumedAt", "createdAt" DESC);

ALTER TABLE "password_resets"
  ADD CONSTRAINT "password_resets_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
