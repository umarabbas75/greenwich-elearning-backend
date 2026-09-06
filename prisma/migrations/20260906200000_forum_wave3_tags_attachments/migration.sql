-- Wave 3: tags + file attachments. Additive, defaulted, detachable.

CREATE TYPE "ForumTagPolicy" AS ENUM ('FREEFORM', 'ADMIN_ONLY', 'DISABLED');

ALTER TABLE "forum_categories"
  ADD COLUMN "tagPolicy" "ForumTagPolicy" NOT NULL DEFAULT 'FREEFORM',
  ADD COLUMN "allowAttachments" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "forum_threads"
  ADD COLUMN "sourcePostId" TEXT;

CREATE UNIQUE INDEX "forum_threads_sourcePostId_key" ON "forum_threads"("sourcePostId");

ALTER TABLE "forum_threads"
  ADD CONSTRAINT "forum_threads_sourcePostId_fkey"
  FOREIGN KEY ("sourcePostId") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "forum_tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "forum_tags_slug_key" ON "forum_tags"("slug");

ALTER TABLE "forum_tags"
  ADD CONSTRAINT "forum_tags_createdByAdminId_fkey"
  FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "forum_thread_tags" (
    "threadId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "forum_thread_tags_pkey" PRIMARY KEY ("threadId","tagId")
);

CREATE INDEX "forum_thread_tags_tagId_idx" ON "forum_thread_tags"("tagId");

ALTER TABLE "forum_thread_tags"
  ADD CONSTRAINT "forum_thread_tags_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "forum_thread_tags"
  ADD CONSTRAINT "forum_thread_tags_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "forum_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "forum_attachments" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "forum_attachments_threadId_idx" ON "forum_attachments"("threadId");

ALTER TABLE "forum_attachments"
  ADD CONSTRAINT "forum_attachments_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
