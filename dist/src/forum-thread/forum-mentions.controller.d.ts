import { User } from '@prisma/client';
import { ForumThreadService } from './forum-thread.service';
export declare class ForumMentionsController {
    private readonly threads;
    constructor(threads: ForumThreadService);
    search(user: User, q?: string, threadId?: string, courseId?: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            firstName: string;
            lastName: string;
            photo: string;
            role: import(".prisma/client").$Enums.Role;
        }[];
    }>;
}
