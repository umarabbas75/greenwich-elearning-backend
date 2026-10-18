/**
 * A course form is only a requirement for learners enrolled on or after the
 * moment it was attached to the course. Learners who were already enrolled
 * keep their access when an admin adds a new required form later.
 *
 * This is the anchor comparison shared by every requirement — forms, policies,
 * policy items and course feedback: a missing moment (unknown enrolment, not
 * completed yet) falls under the current rule.
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

type CourseFormAnchors = {
  createdAt: Date;
  requiredSince: Date;
  detachedWindows: unknown;
};

/** True when the enrolment was created while the form was removed from the course. */
function enrolledWhileDetached(windows: unknown, enrolledAt: Date): boolean {
  if (!Array.isArray(windows)) {
    return false;
  }
  const enrolled = enrolledAt.getTime();
  return windows.some((window) => {
    const from = Date.parse(window?.from);
    const until = Date.parse(window?.until);
    return (
      Number.isFinite(from) &&
      Number.isFinite(until) &&
      enrolled >= from &&
      enrolled < until
    );
  });
}

/**
 * Whether the form was part of the course for this enrolment: attached before
 * they enrolled and not removed at that moment. Decides whether the learner
 * sees the form, may submit it, and falls under its advisor review.
 */
export function courseFormAttachedForEnrollment(
  form: Omit<CourseFormAnchors, 'requiredSince'>,
  enrolledAt: Date | null | undefined,
): boolean {
  if (!formAppliesToEnrollment(form.createdAt, enrolledAt)) {
    return false;
  }
  return !(
    enrolledAt && enrolledWhileDetached(form.detachedWindows, enrolledAt)
  );
}

/**
 * Whether the form is required of this enrolment: it was part of the course
 * for them and was already required when they enrolled. Switching an
 * optional form to required therefore only reaches later enrolments.
 */
export function courseFormAppliesToEnrollment(
  form: CourseFormAnchors,
  enrolledAt: Date | null | undefined,
): boolean {
  return (
    courseFormAttachedForEnrollment(form, enrolledAt) &&
    formAppliesToEnrollment(form.requiredSince, enrolledAt)
  );
}
