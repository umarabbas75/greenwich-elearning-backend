-- CreateTable
CREATE TABLE "course_feedback_forms" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "formName" TEXT NOT NULL,
    "formStructure" JSONB NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_feedback_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_feedback_submissions" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feedbackFormId" TEXT NOT NULL,
    "responses" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_feedback_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_feedback_forms_courseId_key" ON "course_feedback_forms"("courseId");

-- CreateIndex
CREATE INDEX "course_feedback_submissions_courseId_idx" ON "course_feedback_submissions"("courseId");

-- CreateIndex
CREATE INDEX "course_feedback_submissions_userId_idx" ON "course_feedback_submissions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "course_feedback_submissions_userId_courseId_key" ON "course_feedback_submissions"("userId", "courseId");

-- AddForeignKey
ALTER TABLE "course_feedback_forms" ADD CONSTRAINT "course_feedback_forms_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_feedback_submissions" ADD CONSTRAINT "course_feedback_submissions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_feedback_submissions" ADD CONSTRAINT "course_feedback_submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_feedback_submissions" ADD CONSTRAINT "course_feedback_submissions_feedbackFormId_fkey" FOREIGN KEY ("feedbackFormId") REFERENCES "course_feedback_forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
