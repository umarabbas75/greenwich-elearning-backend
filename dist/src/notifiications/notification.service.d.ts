import { PrismaService } from '../prisma/prisma.service';
export declare class NotificationService {
    private prisma;
    constructor(prisma: PrismaService);
    getUserNotifications(userId: string): Promise<any>;
    notifyAllUsersForNewThread(threadId: string, commenterId: string): Promise<void>;
    markNotificationAsRead(notificationId: string): Promise<any>;
}
