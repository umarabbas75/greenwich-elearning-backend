-- A course has at most one active assessment. Learners only need to pass one
-- to complete the course (course_completions is one row per user per course),
-- so two live assessments meant a learner could pick the easier one.
--
-- Any course that already has more than one active keeps the most recently
-- updated and the rest go back to draft, so the index below can be built.
UPDATE "assessments" a
SET "isActive" = false
WHERE a."isActive" = true
  AND EXISTS (
    SELECT 1 FROM "assessments" b
    WHERE b."courseId" = a."courseId"
      AND b."isActive" = true
      AND (b."updatedAt", b."id") > (a."updatedAt", a."id")
  );

-- Partial unique index, not expressible in schema.prisma.
CREATE UNIQUE INDEX "assessments_one_active_per_course" ON "assessments"("courseId") WHERE "isActive" = true;
