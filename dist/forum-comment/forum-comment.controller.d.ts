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
                id: string;
                firstName: string;
                lastName: string;
                email: string;
                phone: string;
                photo: string;
                timezone: string;
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
        })[];
    }>;
    updateForumThreadComment(params: any, body: any): Promise<any>;
    deleteForumThreadComment(params: any): Promise<any>;
}
