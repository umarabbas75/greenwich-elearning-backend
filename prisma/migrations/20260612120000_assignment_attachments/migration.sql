-- CreateTable
CREATE TABLE "assignment_attachments" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "fileType" "AssignmentFileType" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assignment_attachments_assignmentId_idx" ON "assignment_attachments"("assignmentId");

-- AddForeignKey
ALTER TABLE "assignment_attachments" ADD CONSTRAINT "assignment_attachments_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing single-file assignments into attachment rows
INSERT INTO "assignment_attachments" ("id", "assignmentId", "fileUrl", "fileName", "fileType", "sortOrder", "createdAt", "updatedAt")
SELECT
    "id" || '-attachment-0',
    "id",
    "assignmentFileUrl",
    "assignmentFileName",
    "assignmentFileType",
    0,
    "createdAt",
    "updatedAt"
FROM "assignments"
WHERE "assignmentFileUrl" IS NOT NULL
  AND "assignmentFileType" IS NOT NULL;
