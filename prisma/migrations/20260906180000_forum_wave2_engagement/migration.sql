-- Wave 2: accepted answers, votes, mentions. All additive + defaulted so
-- features can be switched off from category flags without dropping data.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FORUM_MENTION';
ALTER TYPE "EmailType" ADD VALUE IF NOT EXISTS 'NOTIFICATION_FORUM_MENTION';

ALTER TABLE "forum_categories"
  ADD COLUMN "allowAcceptedAnswer" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allowVotes" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allowMentions" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "forum_threads"
  ADD COLUMN "voteScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "acceptedCommentId" TEXT;

ALTER TABLE "forum_comments"
  ADD COLUMN "voteScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "isAccepted" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "forum_votes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT,
    "commentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_votes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "forum_votes_userId_threadId_key" ON "forum_votes"("userId", "threadId");
CREATE UNIQUE INDEX "forum_votes_userId_commentId_key" ON "forum_votes"("userId", "commentId");

ALTER TABLE "forum_votes"
  ADD CONSTRAINT "forum_votes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "forum_votes"
  ADD CONSTRAINT "forum_votes_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "forum_votes"
  ADD CONSTRAINT "forum_votes_commentId_fkey"
  FOREIGN KEY ("commentId") REFERENCES "forum_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "forum_threads"
  ADD CONSTRAINT "forum_threads_acceptedCommentId_fkey"
  FOREIGN KEY ("acceptedCommentId") REFERENCES "forum_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
