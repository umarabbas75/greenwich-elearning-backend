import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ContactMessageMail, CourseCompletedMail, EngagementReminderMail, FeedbackReceivedAdminMail, FeedbackReceivedMail, FeedbackRequestMail, MailSendResult, NotificationEmail, PasswordResetMail, WelcomeMail } from './mail.types';
export declare class MailService {
    private readonly config;
    private readonly prisma;
    private readonly logger;
    private readonly client;
    private readonly from;
    constructor(config: ConfigService, prisma: PrismaService);
    get isEnabled(): boolean;
    sendEngagementReminder(mail: EngagementReminderMail): Promise<MailSendResult>;
    sendPasswordReset(mail: PasswordResetMail): Promise<MailSendResult>;
    sendNotificationEmail(mail: NotificationEmail): Promise<MailSendResult>;
    sendWelcome(mail: WelcomeMail): Promise<MailSendResult>;
    sendContactMessage(mail: ContactMessageMail): Promise<MailSendResult>;
    sendCourseCompleted(mail: CourseCompletedMail): Promise<MailSendResult>;
    sendFeedbackRequest(mail: FeedbackRequestMail): Promise<MailSendResult>;
    sendFeedbackReminder(mail: FeedbackRequestMail): Promise<MailSendResult>;
    sendFeedbackReceived(mail: FeedbackReceivedMail): Promise<MailSendResult>;
    sendFeedbackReceivedAdmin(mail: FeedbackReceivedAdminMail): Promise<MailSendResult>;
    private send;
    private recordEmailLog;
}
