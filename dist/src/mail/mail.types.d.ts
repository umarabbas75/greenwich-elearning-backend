export declare enum ReminderType {
    NEVER_STARTED = "never_started",
    STALLED = "stalled",
    FEEDBACK_REMINDER = "feedback_reminder"
}
export interface EngagementReminderMail {
    to: string;
    userId?: string | null;
    firstName: string;
    courseTitle: string;
    reminderType: ReminderType;
    courseUrl: string;
    courseDuration?: string | null;
    completedSections?: number | null;
    totalSections?: number | null;
}
export interface PasswordResetMail {
    to: string;
    userId?: string | null;
    firstName: string;
    otp: string;
    expiresInMinutes: number;
}
export type NotificationEmail = {
    kind: 'FORUM_THREAD';
    to: string;
    userId?: string | null;
    recipientFirstName: string;
    threadId: string;
    threadTitle: string;
    creatorName: string;
} | {
    kind: 'FORUM_COMMENT';
    to: string;
    userId?: string | null;
    recipientFirstName: string;
    threadId: string;
    threadTitle: string;
    commenterName: string;
    excerpt: string;
} | {
    kind: 'ASSESSMENT_SUBMITTED';
    to: string;
    userId?: string | null;
    recipientFirstName: string;
    studentName: string;
    assessmentTitle: string;
    attemptId: string;
} | {
    kind: 'ASSESSMENT_GRADED';
    to: string;
    userId?: string | null;
    recipientFirstName: string;
    assessmentTitle: string;
    courseId?: string;
    passed?: boolean | null;
    scorePct?: number | null;
} | {
    kind: 'ASSIGNMENT_CREATED';
    to: string;
    userId?: string | null;
    recipientFirstName: string;
    assignmentId: string;
    assignmentTitle: string;
    courseTitle: string;
    dueAt?: string | null;
} | {
    kind: 'ASSIGNMENT_SUBMITTED';
    to: string;
    userId?: string | null;
    recipientFirstName: string;
    studentName: string;
    assignmentId: string;
    assignmentTitle: string;
} | {
    kind: 'ASSIGNMENT_GRADED';
    to: string;
    userId?: string | null;
    recipientFirstName: string;
    assignmentId: string;
    assignmentTitle: string;
    submissionStatus: 'submitted' | 'in_review' | 'approved' | 'rejected' | 'returned';
    score?: number | null;
    maxPoints?: number | null;
    feedback?: string | null;
};
export interface WelcomeMail {
    to: string;
    userId?: string | null;
    firstName: string;
}
export interface ContactMessageMail {
    to: string;
    userId?: string | null;
    senderName: string;
    senderEmail: string;
    message: string;
}
export interface CourseCompletedMail {
    to: string;
    userId?: string | null;
    firstName: string;
    courseTitle: string;
    courseId?: string;
}
export interface FeedbackRequestMail {
    to: string;
    userId?: string | null;
    firstName: string;
    courseTitle: string;
    courseId?: string;
}
export interface PendingFeedbackOutstandingMail {
    to: string;
    userId?: string | null;
    firstName: string;
    courseTitle: string;
    courseId: string;
    completedAt?: string | null;
}
export interface FeedbackReceivedMail {
    to: string;
    userId?: string | null;
    firstName: string;
    courseTitle: string;
    courseId?: string;
}
export interface FeedbackReceivedAdminMail {
    to: string;
    userId?: string | null;
    studentName: string;
    studentEmail: string;
    courseTitle: string;
}
export interface MailSendResult {
    sent: boolean;
    id?: string;
    reason?: string;
}
