import { User } from '@prisma/client';
import { ForumTagService } from './forum-tag.service';
export declare class ForumTagController {
    private readonly tags;
    constructor(tags: ForumTagService);
    list(q?: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            name: string;
            slug: string;
        }[];
    }>;
    create(user: User, body: {
        name?: string;
    }): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            name: string;
            slug: string;
        };
    }>;
    update(user: User, id: string, body: {
        name?: string;
    }): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            name: string;
            slug: string;
        };
    }>;
    remove(user: User, id: string): Promise<{
        message: string;
        statusCode: number;
        data: {};
    }>;
}
