import { ConfigService } from '@nestjs/config';
import { EngagementReminderMail, MailSendResult } from './mail.types';
export declare class MailService {
    private readonly config;
    private readonly logger;
    private readonly client;
    private readonly from;
    constructor(config: ConfigService);
    get isEnabled(): boolean;
    sendEngagementReminder(mail: EngagementReminderMail): Promise<MailSendResult>;
}
