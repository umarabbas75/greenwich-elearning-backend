-- Admin audit log — captures sensitive admin actions that previously left no
-- trace (course version migration/archival, forced unassign with progress wipe,
-- etc). Best-effort writes from the application layer.

-- CreateTable
-- adminId is nullable + SetNull so the audit row survives when the actor is
-- hard-deleted from the users table. adminEmail is denormalised at write time
-- as an attributable fallback.
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "adminId" TEXT,
    "adminEmail" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "courseId" TEXT,
    "userId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_logs_adminId_createdAt_idx" ON "admin_audit_logs"("adminId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "admin_audit_logs_action_createdAt_idx" ON "admin_audit_logs"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "admin_audit_logs_courseId_createdAt_idx" ON "admin_audit_logs"("courseId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "admin_audit_logs_userId_createdAt_idx" ON "admin_audit_logs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "admin_audit_logs_targetType_targetId_idx" ON "admin_audit_logs"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
