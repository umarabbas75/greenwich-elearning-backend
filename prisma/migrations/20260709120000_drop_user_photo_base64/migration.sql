-- Drop the wide, write-only base64 avatar column. Avatars are served from the
-- `photo` URL column; `photoBase64` was never read by the application and was
-- driving significant Neon data-transfer egress on every user query.

-- AlterTable
ALTER TABLE "users" DROP COLUMN "photoBase64";
