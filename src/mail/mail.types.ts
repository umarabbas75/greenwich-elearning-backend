/**
 * Reminder taxonomy shared across the engagement sweep, in-app notification
 * payloads, and email templates. Kept here (mail) because both layers depend on
 * it and mail has no dependency back on engagement.
 */
export enum ReminderType {
  /** Enrolled but never opened the course (zero activity). */
  NEVER_STARTED = 'never_started',
  /** Was active, then went quiet past the stalled threshold. */
  STALLED = 'stalled',
}

/** Data needed to render a single engagement reminder email. */
export interface EngagementReminderMail {
  to: string;
  firstName: string;
  courseTitle: string;
  reminderType: ReminderType;
  /** Absolute URL to the course (deep link). Falls back to the app root. */
  courseUrl: string;
}

/** Result of a send attempt — never throws to the caller; email is best-effort. */
export interface MailSendResult {
  sent: boolean;
  /** Provider message id when sent. */
  id?: string;
  /** Reason it was skipped/failed — for logging only. */
  reason?: string;
}
