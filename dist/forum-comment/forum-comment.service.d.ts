import { PrismaService } from '../prisma/prisma.service';
export declare class ForumCommentService {
    private prisma;
    constructor(prisma: PrismaService);
    createForumThreadComment(body: any, userId: string): Promise<any>;
    getForumCommentsByThreadId(threadId: string): Promise<({
        user: {
            id: string;
            firstName: string;
            lastName: string;
            email: string;
            phone: string;
            photo: string;
            password: string;
            role: import(".prisma/client").$Enums.Role;
            createdAt: Date;
            updatedAt: Date;
        };
    } & {
        id: string;
        content: string;
        userId: string;
        threadId: string;
        createdAt: Date;
        updatedAt: Date;
    })[]>;
    getAllForumThreads(): Promise<any>;
    updateForumThreadComment(forumThreadId: string, body: any): Promise<any>;
    deleteForumThreadComment(forumThreadId: any): Promise<any>;
    getForumThread(forumThreadId: any): Promise<any>;
}
