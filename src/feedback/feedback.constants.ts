import { FeedbackOverallRating } from '@prisma/client';

/** Current LMS feedback form version (mirrors FE `FEEDBACK_FORM_VERSION`). */
export const FEEDBACK_FORM_VERSION = 'lms-elearning-v1-2026-06';

/** Section 2 — 18 × 5-point Likert keys (values must be "1".."5"). */
export const FEEDBACK_LIKERT_KEYS = [
  'objectivesClear',
  'contentRelevant',
  'lmsEasyToUse',
  'materialsAccurate',
  'videosEffective',
  'structureLogical',
  'paceAppropriate',
  'assessmentsReflectContent',
  'instructionsClear',
  'tutorSupportProfessional',
  'tutorFeedbackTimely',
  'technicalSupportAvailable',
  'engagingInteractive',
  'knowledgeImproved',
  'confidentInApplication',
  'metExpectations',
  'overallSatisfied',
  'wouldRecommend',
] as const;

export type FeedbackLikertKey = (typeof FEEDBACK_LIKERT_KEYS)[number];

export const FEEDBACK_OVERALL_RATINGS: FeedbackOverallRating[] = [
  'excellent',
  'very_good',
  'good',
  'fair',
  'poor',
];

export const FEEDBACK_REMINDER_AFTER_DAYS = 2;
export const FEEDBACK_REMINDER_COOLDOWN_DAYS = 3;
export const FEEDBACK_REMINDER_LIFETIME_CAP = 4;

export function feedbackGroupKey(courseId: string): string {
  return `feedback:${courseId}`;
}

export function feedbackDedupeKey(
  courseId: string,
  userId: string,
  bucket: number | string,
): string {
  return `feedback:${courseId}:${userId}:${bucket}`;
}

export function feedbackReminderBucket(now: Date, cooldownDays: number): number {
  const msPerDay = 86_400_000;
  const epochDays = Math.floor(now.getTime() / msPerDay);
  return Math.floor(epochDays / Math.max(1, cooldownDays));
}

export function computeMeanLikertRating(
  formData: Record<string, unknown>,
): number {
  const values = FEEDBACK_LIKERT_KEYS.map((key) => {
    const raw = formData[key];
    if (typeof raw !== 'string' || !/^[1-5]$/.test(raw)) return null;
    return Number(raw);
  }).filter((v): v is number => v !== null);

  if (values.length !== FEEDBACK_LIKERT_KEYS.length) {
    throw new Error('Invalid Likert responses');
  }

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.round(mean * 100) / 100;
}

export function validateFeedbackFormData(formData: unknown): Record<string, unknown> {
  if (!formData || typeof formData !== 'object' || Array.isArray(formData)) {
    throw new Error('formData must be an object');
  }

  const data = formData as Record<string, unknown>;

  for (const key of FEEDBACK_LIKERT_KEYS) {
    const value = data[key];
    if (typeof value !== 'string' || !/^[1-5]$/.test(value)) {
      throw new Error(`Invalid or missing Likert response: ${key}`);
    }
  }

  const overall = data.overallRating;
  if (
    typeof overall !== 'string' ||
    !FEEDBACK_OVERALL_RATINGS.includes(overall as FeedbackOverallRating)
  ) {
    throw new Error('Invalid or missing overallRating');
  }

  return data;
}
