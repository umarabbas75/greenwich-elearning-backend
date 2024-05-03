import { PrismaService } from '../prisma/prisma.service';
export declare class ForumThreadService {
    private prisma;
    constructor(prisma: PrismaService);
    getAllForumThreads(user: any): Promise<any>;
    createForumThread(body: any, userId: string): Promise<any>;
    updateForumThread(forumThreadId: string, body: any): Promise<any>;
    deleteForumThread(forumThreadId: any): Promise<any>;
    getForumThread(forumThreadId: any): Promise<any>;
}
