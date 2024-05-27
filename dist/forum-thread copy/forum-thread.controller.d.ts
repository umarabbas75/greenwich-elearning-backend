import { ForumThreadService } from './forum-thread.service';
import { User } from '@prisma/client';
export declare class ForumThreadController {
    private readonly forumThreadService;
    constructor(forumThreadService: ForumThreadService);
    createForumThread(body: any, user: User): Promise<any>;
    getAllForumThreads(user: User): Promise<any>;
    getForumThread(params: any): Promise<any>;
    updateForumThread(params: any, body: any): Promise<any>;
    deleteForumThread(params: any): Promise<any>;
}
