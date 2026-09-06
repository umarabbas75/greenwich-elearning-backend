import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
export declare class ForumCommentService {
    private prisma;
    private notificationService;
    constructor(prisma: PrismaService, notificationService: NotificationService);
    createForumThreadComment(body: any, user: User): Promise<any>;
    getForumCommentsByThreadId(threadId: string, user: User, sort?: string): Promise<{
        message: string;
        statusCode: number;
        data: ({
            id: string;
            content: string;
            parentId: string;
            voteScore: number;
            isAccepted: boolean;
            createdAt: Date;
            threadId: string;
            isVotedByMe: boolean;
            user: {
                id: string;
                firstName: string;
                lastName: string;
                photo: string;
                role: string;
            };
        } & {
            replies: {
                id: string;
                content: string;
                parentId: string;
                voteScore: number;
                isAccepted: boolean;
                createdAt: Date;
                threadId: string;
                isVotedByMe: boolean;
                user: {
                    id: string;
                    firstName: string;
                    lastName: string;
                    photo: string;
                    role: string;
                };
            }[];
        })[];
    }>;
    voteForumComment(commentId: string, body: unknown, user: User): Promise<{
        message: string;
        statusCode: number;
        data: {
            voteScore: number;
            isVotedByMe: boolean;
        };
    }>;
    acceptForumComment(commentId: string, user: User, body?: {
        accepted?: boolean;
    }): Promise<{
        message: string;
        statusCode: number;
        data: {
            acceptedCommentId: string;
            isAccepted: boolean;
        };
    }>;
    getAllForumThreads(): Promise<any>;
    updateForumThreadComment(commentId: string, body: any, user: User): Promise<any>;
    deleteForumThreadComment(commentId: string, user: User): Promise<any>;
    getForumThread(forumThreadId: any): Promise<any>;
    private wrap;
}
