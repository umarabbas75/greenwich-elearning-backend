-- CreateTable
CREATE TABLE "user_chapter_completions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_chapter_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_module_completions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_module_completions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_chapter_completions_userId_chapterId_key" ON "user_chapter_completions"("userId", "chapterId");

-- CreateIndex
CREATE INDEX "user_chapter_completions_userId_courseId_idx" ON "user_chapter_completions"("userId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "user_module_completions_userId_moduleId_key" ON "user_module_completions"("userId", "moduleId");

-- CreateIndex
CREATE INDEX "user_module_completions_userId_courseId_idx" ON "user_module_completions"("userId", "courseId");

-- AddForeignKey
ALTER TABLE "user_chapter_completions" ADD CONSTRAINT "user_chapter_completions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_chapter_completions" ADD CONSTRAINT "user_chapter_completions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_chapter_completions" ADD CONSTRAINT "user_chapter_completions_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_chapter_completions" ADD CONSTRAINT "user_chapter_completions_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_module_completions" ADD CONSTRAINT "user_module_completions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_module_completions" ADD CONSTRAINT "user_module_completions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_module_completions" ADD CONSTRAINT "user_module_completions_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
