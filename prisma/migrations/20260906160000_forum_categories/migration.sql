-- Community boards. All new columns are nullable or defaulted so we can
-- detach categories / course-scoping / student posting later without a wipe.

CREATE TYPE "ForumCourseScope" AS ENUM ('REQUIRED', 'OPTIONAL', 'FORBIDDEN');
CREATE TYPE "ForumStudentCreatePolicy" AS ENUM ('ALLOWED', 'MODERATED', 'DISABLED');
CREATE TYPE "ForumNotifyOnCreate" AS ENUM ('ADMIN_ONLY', 'ALL', 'NONE');

CREATE TABLE "forum_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "courseScope" "ForumCourseScope" NOT NULL DEFAULT 'OPTIONAL',
    "studentCreatePolicy" "ForumStudentCreatePolicy" NOT NULL DEFAULT 'ALLOWED',
    "notifyOnCreate" "ForumNotifyOnCreate" NOT NULL DEFAULT 'ADMIN_ONLY',
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "forum_categories_slug_key" ON "forum_categories"("slug");

ALTER TABLE "forum_categories"
  ADD CONSTRAINT "forum_categories_createdByAdminId_fkey"
  FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Stable ids so backfill and later seeds are idempotent.
INSERT INTO "forum_categories"
  ("id", "name", "slug", "description", "icon", "sortOrder", "courseScope")
VALUES
  ('10000000-0000-4000-8000-000000000001', 'Support', 'support',
    'Account, login, and platform help', 'headset', 0, 'OPTIONAL'),
  ('10000000-0000-4000-8000-000000000002', 'Study', 'study',
    'Course discussion — pick the course this thread belongs to', 'book', 1, 'REQUIRED'),
  ('10000000-0000-4000-8000-000000000003', 'Technical', 'technical',
    'Tools, content bugs, and technical questions', 'wrench', 2, 'OPTIONAL'),
  ('10000000-0000-4000-8000-000000000004', 'General', 'general',
    'Everything else', 'message', 3, 'OPTIONAL');

ALTER TABLE "forum_threads"
  ADD COLUMN "categoryId" TEXT,
  ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "forum_threads"
SET "categoryId" = '10000000-0000-4000-8000-000000000004',
    "lastActivityAt" = "updatedAt"
WHERE "categoryId" IS NULL;

ALTER TABLE "forum_threads"
  ADD CONSTRAINT "forum_threads_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "forum_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "forum_threads_categoryId_isPinned_lastActivityAt_idx"
  ON "forum_threads"("categoryId", "isPinned" DESC, "lastActivityAt" DESC);
