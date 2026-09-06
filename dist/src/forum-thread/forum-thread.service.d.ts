import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
export type ForumThreadListQuery = {
    categoryId?: string;
    courseId?: string;
    q?: string;
    sort?: string;
    tagId?: string;
    tag?: string;
};
export declare class ForumThreadService {
    private prisma;
    private notificationService;
    private static readonly logger;
    constructor(prisma: PrismaService, notificationService: NotificationService);
    subscribeForumThread(body: any, userId: string): Promise<any>;
    unSubscribeForumThread(params: any, userId: string): Promise<any>;
    createFavoriteForumThread(body: any, userId: string): Promise<any>;
    unFavoriteForumThread(params: any, userId: string): Promise<any>;
    getAllForumThreads(user: User, query?: ForumThreadListQuery): Promise<any>;
    createForumThread(body: any, user: User): Promise<any>;
    updateForumThread(forumThreadId: string, body: any, user: User): Promise<any>;
    deleteForumThread(forumThreadId: string, user: User): Promise<any>;
    getForumThread(forumThreadId: string, user: User): Promise<any>;
    deleteForumAttachment(threadId: string, attachmentId: string, user: User): Promise<{
        message: string;
        statusCode: number;
        data: {};
    }>;
    voteForumThread(threadId: string, body: unknown, user: User): Promise<{
        message: string;
        statusCode: number;
        data: {
            voteScore: number;
            isVotedByMe: boolean;
        };
    }>;
    searchMentions(user: User, query: {
        q?: string;
        threadId?: string;
        courseId?: string;
    }): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            firstName: string;
            lastName: string;
            photo: string;
            role: import(".prisma/client").$Enums.Role;
        }[];
    }>;
    private recordForumView;
    private withTags;
    private resolveWriteExtras;
    private assertCourseVisible;
}
