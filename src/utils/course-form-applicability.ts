/**
 * A course form is only a requirement for learners enrolled on or after the
 * moment it was attached to the course. Learners who were already enrolled
 * keep their access when an admin adds a new required form later.
 */
export function formAppliesToEnrollment(
  formCreatedAt: Date,
  enrolledAt: Date | null | undefined,
): boolean {
  if (!enrolledAt) {
    return true;
  }
  return enrolledAt.getTime() >= formCreatedAt.getTime();
}
