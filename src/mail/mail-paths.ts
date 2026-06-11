import { BRAND } from './templates/mail-layout';

/** Canonical FE routes — see docs/email-links-frontend-handoff.md */

export function studentCoursesList(): string {
  return `${BRAND.website}/studentCourses`;
}

export function studentCourseDetail(courseId: string): string {
  return `${BRAND.website}/studentCourses/${encodeURIComponent(courseId)}`;
}

export function studentCourseFeedback(courseId: string): string {
  return `${BRAND.website}/studentCourses/${encodeURIComponent(courseId)}/feedback`;
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

export function adminContactInbox(): string {
  return `${BRAND.website}/contact-us`;
}

export function appHome(): string {
  return BRAND.website;
}
