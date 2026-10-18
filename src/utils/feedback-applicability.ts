import { formAppliesToEnrollment } from './course-form-applicability';

/**
 * Required course feedback is only owed by learners who completed the course
 * on or after the moment feedback became required. Someone who finished
 * before an admin attached (or re-required) the form is never asked for it
 * retroactively. A learner who has not completed yet always falls under the
 * current rule. Same anchor comparison as every other requirement.
 */
export function feedbackAppliesToCompletion(
  requiredSince: Date,
  courseCompletedAt: Date | null | undefined,
): boolean {
  return formAppliesToEnrollment(requiredSince, courseCompletedAt);
}
