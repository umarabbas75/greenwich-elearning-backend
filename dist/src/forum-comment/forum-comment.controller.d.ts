import { ForumCommentService } from './forum-comment.service';
import { User } from '@prisma/client';
export declare class ForumCommentController {
    private readonly forumThreadService;
    constructor(forumThreadService: ForumCommentService);
    createForumThreadComment(body: any, user: User): Promise<any>;
    acceptForumComment(id: string, user: User, body?: {
        accepted?: boolean;
    }): Promise<{
        message: string;
        statusCode: number;
        data: {
            acceptedCommentId: string;
            isAccepted: boolean;
        };
    }>;
    voteForumComment(id: string, body: unknown, user: User): Promise<{
        message: string;
        statusCode: number;
        data: {
            voteScore: number;
            isVotedByMe: boolean;
        };
    }>;
    getForumCommentsByThreadId(forumThreadId: string, user: User, sort?: string): Promise<{
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
    updateForumThreadComment(forumThreadId: string, body: any, user: User): Promise<any>;
    deleteForumThreadComment(forumThreadId: string, user: User): Promise<any>;
}
