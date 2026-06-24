-- Course Versioning (Pattern 1): schema + enrollment pin column + archive flags

-- CreateEnum
CREATE TYPE "CourseVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- AlterTable: archive flags on live curriculum tree
ALTER TABLE "modules" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "chapters" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sections" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "quizzes" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: pin enrollment to a published version
ALTER TABLE "user_courses" ADD COLUMN "enrolledVersionId" TEXT;

-- CreateTable: course_versions
CREATE TABLE "course_versions" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "CourseVersionStatus" NOT NULL DEFAULT 'PUBLISHED',
    "publishedAt" TIMESTAMP(3),
    "publishedByAdminId" TEXT,
    "changeNotes" TEXT,
    "isLatest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: course_version_modules
CREATE TABLE "course_version_modules" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "sourceModuleId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_version_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable: course_version_chapters
CREATE TABLE "course_version_chapters" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "versionModuleId" TEXT NOT NULL,
    "sourceChapterId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "pdfFile" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "hasQuiz" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_version_chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable: course_version_sections
CREATE TABLE "course_version_sections" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "versionChapterId" TEXT NOT NULL,
    "sourceSectionId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "shortDescription" TEXT,
    "type" "section_type" NOT NULL DEFAULT 'DEFAULT',
    "orderIndex" INTEGER,
    "itemLabel" TEXT,
    "categoryLabel" TEXT,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxPerCategory" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "questionText" TEXT,
    "imageUrl" TEXT,
    "allowMultipleSelection" BOOLEAN NOT NULL DEFAULT false,
    "items" JSONB,
    "options" JSONB,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_version_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable: course_version_quizzes
CREATE TABLE "course_version_quizzes" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "versionChapterId" TEXT NOT NULL,
    "sourceQuizId" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "options" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_version_quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_versions_courseId_versionNumber_key" ON "course_versions"("courseId", "versionNumber");
CREATE INDEX "course_versions_courseId_isLatest_idx" ON "course_versions"("courseId", "isLatest");
CREATE INDEX "course_versions_courseId_status_idx" ON "course_versions"("courseId", "status");
CREATE UNIQUE INDEX "course_versions_one_latest_per_course" ON "course_versions"("courseId") WHERE "isLatest" = true;

CREATE INDEX "course_version_modules_versionId_idx" ON "course_version_modules"("versionId");
CREATE INDEX "course_version_modules_sourceModuleId_idx" ON "course_version_modules"("sourceModuleId");

CREATE INDEX "course_version_chapters_versionId_idx" ON "course_version_chapters"("versionId");
CREATE INDEX "course_version_chapters_versionModuleId_idx" ON "course_version_chapters"("versionModuleId");
CREATE INDEX "course_version_chapters_sourceChapterId_idx" ON "course_version_chapters"("sourceChapterId");

CREATE INDEX "course_version_sections_versionId_idx" ON "course_version_sections"("versionId");
CREATE INDEX "course_version_sections_versionChapterId_idx" ON "course_version_sections"("versionChapterId");
CREATE INDEX "course_version_sections_sourceSectionId_idx" ON "course_version_sections"("sourceSectionId");

CREATE INDEX "course_version_quizzes_versionId_idx" ON "course_version_quizzes"("versionId");
CREATE INDEX "course_version_quizzes_versionChapterId_idx" ON "course_version_quizzes"("versionChapterId");
CREATE INDEX "course_version_quizzes_sourceQuizId_idx" ON "course_version_quizzes"("sourceQuizId");

CREATE INDEX "user_courses_enrolledVersionId_idx" ON "user_courses"("enrolledVersionId");

-- AddForeignKey
ALTER TABLE "user_courses" ADD CONSTRAINT "user_courses_enrolledVersionId_fkey" FOREIGN KEY ("enrolledVersionId") REFERENCES "course_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "course_version_modules" ADD CONSTRAINT "course_version_modules_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "course_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "course_version_chapters" ADD CONSTRAINT "course_version_chapters_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "course_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "course_version_chapters" ADD CONSTRAINT "course_version_chapters_versionModuleId_fkey" FOREIGN KEY ("versionModuleId") REFERENCES "course_version_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "course_version_sections" ADD CONSTRAINT "course_version_sections_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "course_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "course_version_sections" ADD CONSTRAINT "course_version_sections_versionChapterId_fkey" FOREIGN KEY ("versionChapterId") REFERENCES "course_version_chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "course_version_quizzes" ADD CONSTRAINT "course_version_quizzes_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "course_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "course_version_quizzes" ADD CONSTRAINT "course_version_quizzes_versionChapterId_fkey" FOREIGN KEY ("versionChapterId") REFERENCES "course_version_chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
