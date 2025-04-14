import { NotificationService } from './notification.service';
import { User } from '@prisma/client';
export declare class NotificationController {
    private readonly forumThreadService;
    constructor(forumThreadService: NotificationService);
    getUserNotifications(user: User): Promise<any>;
    markNotificationAsRead(body: any): Promise<any>;
}
