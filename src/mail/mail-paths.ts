import { BRAND } from './templates/mail-layout';

/** Canonical FE routes — see docs/email-links-frontend-handoff.md */

export function studentCoursesList(): string {
  return `${BRAND.website}/studentCourses`;
}

export function studentCourseDetail(courseId: string): string {
  return `${BRAND.website}/studentCourses/${encodeURIComponent(courseId)}`;
}

export function certificateVerify(certificateId: string): string {
  return `${BRAND.website}/certificates/verify/${encodeURIComponent(
    certificateId,
  )}`;
}

export function studentCourseFeedback(courseId: string): string {
  return `${BRAND.website}/studentCourses/${encodeURIComponent(
    courseId,
  )}/feedback`;
}

export function forumThread(threadId: string): string {
  return `${BRAND.website}/forum/${encodeURIComponent(threadId)}`;
}

export function assessmentGrade(attemptId: string): string {
  return `${BRAND.website}/assessment/grade/${encodeURIComponent(attemptId)}`;
}

export function adminFeedback(): string {
  return `${BRAND.website}/feedback`;
}

export function studentAssignmentDetail(assignmentId: string): string {
  return `${BRAND.website}/assignments/${encodeURIComponent(assignmentId)}`;
}

export function adminAssignmentSubmissions(assignmentId: string): string {
  return `${BRAND.website}/admin/assignments/${encodeURIComponent(
    assignmentId,
  )}/submissions`;
}

export function adminContactInbox(): string {
  return `${BRAND.website}/contact-us`;
}

export function adminIssuedCertificates(): string {
  return `${BRAND.website}/admin/certificates`;
}

export function advisorRegistrationReview(args: {
  userId: string;
  courseId: string;
  courseFormId: string;
}): string {
  const params = new URLSearchParams({
    viewOnly: '1',
    courseId: args.courseId,
    formId: 'registration-form',
    courseFormId: args.courseFormId,
  });
  return `${BRAND.website}/user/${encodeURIComponent(
    args.userId,
  )}/forms/course-booking-form/advisor-review?${params.toString()}`;
}

export function studentCourseFormPage(courseId: string): string {
  return `${BRAND.website}/studentCourses/${encodeURIComponent(
    courseId,
  )}/course-form-page`;
}

export function studentRegistrationFormView(courseId: string): string {
  const params = new URLSearchParams({
    viewOnly: '1',
    courseId,
  });
  return `${BRAND.website}/studentCourses/${encodeURIComponent(
    courseId,
  )}/course-form-page/forms/course-booking-form?${params.toString()}`;
}

export function appHome(): string {
  return BRAND.website;
}
