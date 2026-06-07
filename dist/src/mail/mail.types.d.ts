export declare enum ReminderType {
    NEVER_STARTED = "never_started",
    STALLED = "stalled"
}
export interface EngagementReminderMail {
    to: string;
    firstName: string;
    courseTitle: string;
    reminderType: ReminderType;
    courseUrl: string;
    courseDuration?: string | null;
    completedSections?: number | null;
    totalSections?: number | null;
}
export interface MailSendResult {
    sent: boolean;
    id?: string;
    reason?: string;
}
