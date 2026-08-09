import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { FeedbackService } from '../feedback/feedback.service';
import { CourseVersionService } from '../course-version/course-version.service';
export declare class CourseCompletionService {
    private prisma;
    private mail;
    private feedbackService;
    private courseVersionService;
    private static readonly logger;
    constructor(prisma: PrismaService, mail: MailService, feedbackService: FeedbackService, courseVersionService: CourseVersionService);
    checkContentCompletion(userId: string, courseId: string): Promise<void>;
    private sendCompletionEmails;
}
