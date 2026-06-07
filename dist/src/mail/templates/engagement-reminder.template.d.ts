import { EngagementReminderMail } from '../mail.types';
export interface RenderedEmail {
    subject: string;
    html: string;
    text: string;
}
export declare function renderEngagementReminder(mail: EngagementReminderMail): RenderedEmail;
