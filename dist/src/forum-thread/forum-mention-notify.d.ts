import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
export declare function notifyForumMentions(args: {
    prisma: PrismaService;
    notifications: NotificationService;
    actor: {
        id: string;
        firstName: string;
        lastName: string;
    };
    content: string;
    threadId: string;
    threadTitle: string;
    allowMentions: boolean;
    sourceKey: string;
    commentId?: string;
    excludeUserIds?: string[];
}): Promise<string[]>;
