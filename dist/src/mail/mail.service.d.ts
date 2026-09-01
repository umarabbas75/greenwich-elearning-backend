import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ContactMessageMail, CertificateIssuedMail, CourseCompletedMail, EngagementReminderMail, FeedbackReceivedAdminMail, FeedbackReceivedMail, FeedbackRequestMail, PendingFeedbackOutstandingMail, MailSendResult, NotificationEmail, PasswordResetMail, RegistrationReceivedMail, WelcomeMail } from './mail.types';
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
    sendRegistrationReceived(mail: RegistrationReceivedMail): Promise<MailSendResult>;
    sendWelcome(mail: WelcomeMail): Promise<MailSendResult>;
    sendContactMessage(mail: ContactMessageMail): Promise<MailSendResult>;
    sendCourseCompleted(mail: CourseCompletedMail): Promise<MailSendResult>;
    sendCertificateIssued(mail: CertificateIssuedMail): Promise<MailSendResult>;
    sendFeedbackRequest(mail: FeedbackRequestMail): Promise<MailSendResult>;
    sendPendingFeedbackOutstanding(mail: PendingFeedbackOutstandingMail): Promise<MailSendResult>;
    sendFeedbackReminder(mail: FeedbackRequestMail): Promise<MailSendResult>;
    sendFeedbackReceived(mail: FeedbackReceivedMail): Promise<MailSendResult>;
    sendFeedbackReceivedAdmin(mail: FeedbackReceivedAdminMail): Promise<MailSendResult>;
    private send;
    private recordEmailLog;
}
