import { ReminderType } from '../mail/mail.types';
export declare const ENGAGEMENT_ENV: {
    readonly neverStartedDays: "ENGAGEMENT_NEVER_STARTED_DAYS";
    readonly stalledDays: "ENGAGEMENT_STALLED_DAYS";
    readonly neverStartedCooldownDays: "ENGAGEMENT_NEVER_STARTED_COOLDOWN_DAYS";
    readonly stalledCooldownDays: "ENGAGEMENT_STALLED_COOLDOWN_DAYS";
    readonly batchLimit: "ENGAGEMENT_BATCH_LIMIT";
    readonly emailConcurrency: "ENGAGEMENT_EMAIL_CONCURRENCY";
    readonly appBaseUrl: "APP_BASE_URL";
};
export declare const ENGAGEMENT_DEFAULTS: {
    readonly neverStartedDays: 3;
    readonly stalledDays: 7;
    readonly neverStartedCooldownDays: 3;
    readonly stalledCooldownDays: 7;
    readonly batchLimit: 50;
    readonly emailConcurrency: 5;
    readonly appBaseUrl: "https://www.greenwichtc-elearning.com";
};
export declare function cooldownBucket(now: Date, cooldownDays: number): number;
export declare function engagementDedupeKey(args: {
    reminderType: ReminderType;
    courseId: string;
    userId: string;
    bucket: number;
}): string;
export declare function engagementGroupKey(reminderType: ReminderType, courseId: string): string;
