import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
type NotificationListFilter = 'all' | 'unread';
export interface NotificationListParams {
    cursor?: string;
    limit?: number;
    filter?: NotificationListFilter;
    type?: NotificationType;
}
interface CreateNotificationInput {
    userId: string;
    type: NotificationType;
    message: string;
    payload?: Prisma.InputJsonValue | null;
    groupKey?: string | null;
    dedupeKey?: string | null;
    referenceId?: string | null;
    threadId?: string | null;
    commenterId?: string | null;
}
interface BulkCreateNotificationInput extends Omit<CreateNotificationInput, 'userId'> {
    userIds: string[];
    dedupeKeyFor?: (userId: string) => string | null;
}
export declare class NotificationService {
    private prisma;
    private static readonly DEFAULT_LIMIT;
    private static readonly MAX_LIMIT;
    constructor(prisma: PrismaService);
    listNotifications(userId: string, params: NotificationListParams): Promise<{
        message: string;
        statusCode: number;
        data: {
            data: {
                id: string;
                userId: string;
                threadId: string;
                message: string;
                seenAt: Date;
                readAt: Date;
                payload: Prisma.JsonValue;
                groupKey: string;
                dedupeKey: string;
                createdAt: Date;
                updatedAt: Date;
                commenterId: string;
                type: import(".prisma/client").$Enums.NotificationType;
                referenceId: string;
            }[];
            nextCursor: string;
            unreadCount: number;
            unseenCount: number;
        };
    }>;
    getCounts(userId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            unread: number;
            unseen: number;
        };
    }>;
    markOneAsRead(notificationId: string, userId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            readAt: string;
            seenAt: string;
        };
    }>;
    markAllAsRead(userId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            updated: number;
        };
    }>;
    markAllAsSeen(userId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            updated: number;
        };
    }>;
    createNotification(input: CreateNotificationInput): Promise<void>;
    createNotificationForMany(input: BulkCreateNotificationInput): Promise<void>;
    notifyAllUsersForNewThread(args: {
        threadId: string;
        threadTitle: string;
        courseId?: string | null;
        creator: {
            id: string;
            firstName: string;
            lastName: string;
        };
    }): Promise<void>;
}
export {};
