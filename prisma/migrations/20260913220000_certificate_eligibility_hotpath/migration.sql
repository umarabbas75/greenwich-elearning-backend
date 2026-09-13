-- Sidebar eligibility is a per-request EXISTS check (see CertificateService.getLearnerEligibility).
-- Partial indexes keep that lookup to issued rows / active enrollments only.

CREATE INDEX IF NOT EXISTS "course_completions_userId_issued_idx"
  ON "course_completions" ("userId")
  WHERE "certificateUrl" IS NOT NULL AND "certificateIssuedAt" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "user_courses_userId_isActive_idx"
  ON "user_courses" ("userId", "isActive");
