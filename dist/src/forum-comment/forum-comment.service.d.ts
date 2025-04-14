import { PrismaService } from '../prisma/prisma.service';
export declare class ForumCommentService {
    private prisma;
    constructor(prisma: PrismaService);
    createForumThreadComment(body: any, userId: string): Promise<any>;
    getForumCommentsByThreadId(threadId: string): Promise<{
        message: string;
        statusCode: number;
        data: ({
            user: {
                firstName: string;
                lastName: string;
                email: string;
                phone: string;
                role: import(".prisma/client").$Enums.Role;
                photo: string;
                id: string;
                createdAt: Date;
                updatedAt: Date;
                timezone: string;
            };
        } & {
            id: string;
            content: string;
            userId: string;
            threadId: string;
            createdAt: Date;
            updatedAt: Date;
        })[];
    }>;
    getAllForumThreads(): Promise<any>;
    updateForumThreadComment(forumThreadId: string, body: any): Promise<any>;
    deleteForumThreadComment(forumThreadId: any): Promise<any>;
    getForumThread(forumThreadId: any): Promise<any>;
}
