import { ForumThreadService } from './forum-thread.service';
import { User } from '@prisma/client';
export declare class ForumThreadController {
    private readonly forumThreadService;
    constructor(forumThreadService: ForumThreadService);
    subscribeForumThread(body: any, user: User): Promise<any>;
    unSubscribeForumThread(params: any, user: User): Promise<any>;
    createFavoriteForumThread(body: any, user: User): Promise<any>;
    unFavoriteForumThread(params: any, user: User): Promise<any>;
    createForumThread(body: any, user: User): Promise<any>;
    getAllForumThreads(user: User, categoryId?: string, courseId?: string, q?: string, sort?: string, tagId?: string, tag?: string): Promise<any>;
    deleteForumAttachment(forumThreadId: string, attachmentId: string, user: User): Promise<{
        message: string;
        statusCode: number;
        data: {};
    }>;
    voteForumThread(forumThreadId: string, body: unknown, user: User): Promise<{
        message: string;
        statusCode: number;
        data: {
            voteScore: number;
            isVotedByMe: boolean;
        };
    }>;
    getForumThread(params: any, user: User): Promise<any>;
    updateForumThread(params: any, body: any, user: User): Promise<any>;
    deleteForumThread(params: any, user: User): Promise<any>;
}
