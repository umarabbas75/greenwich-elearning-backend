export const DEFAULT_VALIDITY_DAYS = 365;

/**
 * When a learner's post-completion access ends. The window granted at
 * completion is a floor: lowering course.validityDays later never shortens it,
 * while raising it extends everyone who already finished. Completions recorded
 * before the window was stored fall back to the course's current value.
 */
export function courseAccessExpiresAt(
  completedAt: Date,
  validityDaysAtCompletion: number | null | undefined,
  currentValidityDays: number | null | undefined,
): Date {
  const current = currentValidityDays ?? DEFAULT_VALIDITY_DAYS;
  const days = Math.max(validityDaysAtCompletion ?? current, current);
  const expiresAt = new Date(completedAt);
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
}
