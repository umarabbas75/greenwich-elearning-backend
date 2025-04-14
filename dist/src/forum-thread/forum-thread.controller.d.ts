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
    getAllForumThreads(user: User): Promise<any>;
    getForumThread(params: any): Promise<any>;
    updateForumThread(params: any, body: any, user: User): Promise<any>;
    deleteForumThread(params: any): Promise<any>;
}
