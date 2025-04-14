import { PrismaService } from '../prisma/prisma.service';
export declare class ForumThreadService {
    private prisma;
    constructor(prisma: PrismaService);
    subscribeForumThread(body: any, userId: string): Promise<any>;
    unSubscribeForumThread(params: any, userId: string): Promise<any>;
    createFavoriteForumThread(body: any, userId: string): Promise<any>;
    unFavoriteForumThread(params: any, userId: string): Promise<any>;
    getAllForumThreads(user: any): Promise<any>;
    createForumThread(body: any, userId: string): Promise<any>;
    updateForumThread(forumThreadId: string, body: any, userId: any): Promise<any>;
    deleteForumThread(forumThreadId: any): Promise<any>;
    getForumThread(forumThreadId: any): Promise<any>;
}
