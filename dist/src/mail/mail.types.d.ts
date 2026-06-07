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
}
export interface MailSendResult {
    sent: boolean;
    id?: string;
    reason?: string;
}
