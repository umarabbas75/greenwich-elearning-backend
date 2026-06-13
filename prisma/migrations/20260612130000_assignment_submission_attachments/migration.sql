-- CreateTable
CREATE TABLE "assignment_submission_attachments" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "fileType" "AssignmentFileType" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_submission_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assignment_submission_attachments_submissionId_idx" ON "assignment_submission_attachments"("submissionId");

-- AddForeignKey
ALTER TABLE "assignment_submission_attachments" ADD CONSTRAINT "assignment_submission_attachments_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "assignment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing single-file submissions into attachment rows
INSERT INTO "assignment_submission_attachments" ("id", "submissionId", "fileUrl", "fileName", "fileType", "sortOrder", "createdAt", "updatedAt")
SELECT
    "id" || '-attachment-0',
    "id",
    "fileUrl",
    "fileName",
    "fileType",
    0,
    "createdAt",
    "updatedAt"
FROM "assignment_submissions";
