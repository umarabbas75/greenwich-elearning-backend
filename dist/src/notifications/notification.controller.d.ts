import { NotificationType, User } from '@prisma/client';
import { NotificationService } from './notification.service';
export declare class NotificationController {
    private readonly notificationService;
    constructor(notificationService: NotificationService);
    list(user: User, cursor?: string, limit?: string, filter?: 'all' | 'unread', type?: NotificationType): Promise<{
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
                payload: import(".prisma/client").Prisma.JsonValue;
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
    unreadCount(user: User): Promise<{
        message: string;
        statusCode: number;
        data: {
            unread: number;
            unseen: number;
        };
    }>;
    markAllAsRead(user: User): Promise<{
        message: string;
        statusCode: number;
        data: {
            updated: number;
        };
    }>;
    markAllAsSeen(user: User): Promise<{
        message: string;
        statusCode: number;
        data: {
            updated: number;
        };
    }>;
    markOneAsRead(id: string, user: User): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            readAt: string;
            seenAt: string;
        };
    }>;
    legacyMarkAsRead(body: {
        id?: string;
    }, user: User): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            readAt: string;
            seenAt: string;
        };
    }>;
    legacyMarkAllAsRead(user: User): Promise<{
        message: string;
        statusCode: number;
        data: {
            updated: number;
        };
    }>;
}
