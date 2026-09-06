import { stripTrailingSlash } from './strip-trailing-slash';

/** Where SCORM Cloud sends the learner after they exit the player. */
export function scormPlayerReturnUrl(
  frontendBaseUrl: string,
  courseId: string,
): string {
  const base = stripTrailingSlash(frontendBaseUrl.trim());
  const id = encodeURIComponent(courseId);
  return `${base}/studentCourses/${id}/scorm`;
}
