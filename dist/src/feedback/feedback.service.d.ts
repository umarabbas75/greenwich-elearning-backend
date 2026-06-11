import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from '../notifications/notification.service';
import { ResponseDto } from '../dto';
export interface SubmitCourseFeedbackInput {
    formVersion?: string;
    formData: unknown;
}
export interface AdminFeedbackListQuery {
    courseId?: string;
    from?: string;
    to?: string;
    search?: string;
    page?: number;
    limit?: number;
}
export declare class FeedbackService {
    private readonly prisma;
    private readonly mail;
    private readonly notifications;
    private static readonly logger;
    constructor(prisma: PrismaService, mail: MailService, notifications: NotificationService);
    submitCourseFeedback(studentId: string, courseId: string, input: SubmitCourseFeedbackInput): Promise<ResponseDto>;
    getCourseFeedbackStatus(studentId: string, courseId: string): Promise<ResponseDto>;
    getPendingFeedbackForUser(userId: string): Promise<ResponseDto>;
    listAdminSubmissions(adminId: string, query: AdminFeedbackListQuery): Promise<ResponseDto>;
    getAdminSubmissionDetail(adminId: string, submissionId: string): Promise<ResponseDto>;
    getAdminAggregate(adminId: string, courseId?: string): Promise<ResponseDto>;
    getCourseFeedbackSubmissions(courseId: string, adminId: string): Promise<ResponseDto>;
    notifyFeedbackRequiredIfNeeded(userId: string, courseId: string): Promise<void>;
    markFeedbackNotificationsRead(userId: string, courseId: string): Promise<void>;
    assertFeedbackSubmittedForCertificate(userId: string, courseId: string): Promise<void>;
    private assertAdminAsync;
    private buildAdminListWhere;
    private toAdminListRow;
    private toSubmissionDetail;
    private extractTrainerName;
}
