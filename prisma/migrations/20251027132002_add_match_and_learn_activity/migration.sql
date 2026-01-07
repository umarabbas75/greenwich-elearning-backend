-- CreateTable
CREATE TABLE "match_and_learn" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "itemLabel" TEXT NOT NULL,
    "categoryLabel" TEXT NOT NULL,
    "chapterId" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "maxPerCategory" INTEGER NOT NULL DEFAULT 1,
    "categories" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_and_learn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_and_learn_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "correctCategory" TEXT NOT NULL,
    "matchAndLearnId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_and_learn_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_and_learn_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "matchAndLearnId" TEXT NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "correctMatches" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_and_learn_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "match_and_learn_chapterId_idx" ON "match_and_learn"("chapterId");

-- CreateIndex
CREATE INDEX "match_and_learn_chapterId_orderIndex_idx" ON "match_and_learn"("chapterId", "orderIndex");

-- CreateIndex
CREATE INDEX "match_and_learn_items_matchAndLearnId_idx" ON "match_and_learn_items"("matchAndLearnId");

-- CreateIndex
CREATE INDEX "match_and_learn_progress_userId_chapterId_idx" ON "match_and_learn_progress"("userId", "chapterId");

-- CreateIndex
CREATE INDEX "match_and_learn_progress_matchAndLearnId_isCompleted_idx" ON "match_and_learn_progress"("matchAndLearnId", "isCompleted");

-- CreateIndex
CREATE UNIQUE INDEX "match_and_learn_progress_userId_chapterId_matchAndLearnId_key" ON "match_and_learn_progress"("userId", "chapterId", "matchAndLearnId");

-- AddForeignKey
ALTER TABLE "match_and_learn" ADD CONSTRAINT "match_and_learn_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_and_learn_items" ADD CONSTRAINT "match_and_learn_items_matchAndLearnId_fkey" FOREIGN KEY ("matchAndLearnId") REFERENCES "match_and_learn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_and_learn_progress" ADD CONSTRAINT "match_and_learn_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_and_learn_progress" ADD CONSTRAINT "match_and_learn_progress_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_and_learn_progress" ADD CONSTRAINT "match_and_learn_progress_matchAndLearnId_fkey" FOREIGN KEY ("matchAndLearnId") REFERENCES "match_and_learn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
