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
  /** Recipient user id, recorded to EmailLog for the admin dashboard. */
  userId?: string | null;
  firstName: string;
  courseTitle: string;
  reminderType: ReminderType;
  /** Absolute URL to the course (deep link). Falls back to the app root. */
  courseUrl: string;
  // Optional personalization. Templates render these only when present/valid.
  /** NEVER_STARTED: course's intended duration (e.g. "60 Days"). */
  courseDuration?: string | null;
  /** STALLED: sections the student has completed. */
  completedSections?: number | null;
  /** STALLED: total sections in the course (for the progress fraction/percent). */
  totalSections?: number | null;
}

/** Data needed to render a password-reset OTP email. */
export interface PasswordResetMail {
  to: string;
  /** Recipient user id, recorded to EmailLog for the admin dashboard. */
  userId?: string | null;
  firstName: string;
  /** The 6-digit one-time code (plaintext, only here in memory for sending). */
  otp: string;
  /** Minutes until the code expires (for the copy). */
  expiresInMinutes: number;
}

/**
 * Notification-mirror emails. One discriminated shape per in-app NotificationType
 * the engagement/forum/assessment flows raise. `to` + `userId` identify the
 * recipient; the rest is template data. Deep links are built in the template
 * from BRAND.website + the ids here.
 */
export type NotificationEmail =
  | {
      kind: 'FORUM_THREAD';
      to: string;
      userId?: string | null;
      recipientFirstName: string;
      threadId: string;
      threadTitle: string;
      creatorName: string;
    }
  | {
      kind: 'FORUM_COMMENT';
      to: string;
      userId?: string | null;
      recipientFirstName: string;
      threadId: string;
      threadTitle: string;
      commenterName: string;
      excerpt: string;
    }
  | {
      kind: 'ASSESSMENT_SUBMITTED';
      to: string;
      userId?: string | null;
      recipientFirstName: string; // the admin
      studentName: string;
      assessmentTitle: string;
      attemptId: string;
    }
  | {
      kind: 'ASSESSMENT_GRADED';
      to: string;
      userId?: string | null;
      recipientFirstName: string; // the student
      assessmentTitle: string;
      passed?: boolean | null;
      scorePct?: number | null;
    };

/** Data for the welcome email sent on self-registration. */
export interface WelcomeMail {
  to: string;
  userId?: string | null;
  firstName: string;
}

/** A "contact us" message emailed to an admin. `to` is the admin's address. */
export interface ContactMessageMail {
  to: string;
  /** Admin user id (recipient), for EmailLog. */
  userId?: string | null;
  senderName: string;
  senderEmail: string;
  message: string;
}

/** Result of a send attempt — never throws to the caller; email is best-effort. */
export interface MailSendResult {
  sent: boolean;
  /** Provider message id when sent. */
  id?: string;
  /** Reason it was skipped/failed — for logging only. */
  reason?: string;
}
