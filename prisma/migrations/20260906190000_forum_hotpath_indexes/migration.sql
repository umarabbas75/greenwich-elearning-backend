-- Hot-path indexes for Community list, top/latest comment sort, and vote sort.
CREATE INDEX "forum_comments_threadId_isAccepted_voteScore_createdAt_idx"
  ON "forum_comments" ("threadId", "isAccepted" DESC, "voteScore" DESC, "createdAt" DESC);

CREATE INDEX "forum_comments_threadId_isAccepted_createdAt_idx"
  ON "forum_comments" ("threadId", "isAccepted" DESC, "createdAt" DESC);

CREATE INDEX "forum_threads_isPinned_lastActivityAt_idx"
  ON "forum_threads" ("isPinned" DESC, "lastActivityAt" DESC);

CREATE INDEX "forum_threads_isPinned_voteScore_lastActivityAt_idx"
  ON "forum_threads" ("isPinned" DESC, "voteScore" DESC, "lastActivityAt" DESC);
