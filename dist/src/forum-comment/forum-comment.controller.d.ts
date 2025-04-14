import { ForumCommentService } from './forum-comment.service';
import { User } from '@prisma/client';
export declare class ForumCommentController {
    private readonly forumThreadService;
    constructor(forumThreadService: ForumCommentService);
    createForumThreadComment(body: any, user: User): Promise<any>;
    getForumCommentsByThreadId(params: any): Promise<{
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
    updateForumThreadComment(params: any, body: any): Promise<any>;
    deleteForumThreadComment(params: any): Promise<any>;
}
