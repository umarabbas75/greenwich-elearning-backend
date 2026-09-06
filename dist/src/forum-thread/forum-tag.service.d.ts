import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
export declare class ForumTagService {
    private prisma;
    constructor(prisma: PrismaService);
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
    private assertAdmin;
    private fail;
    private wrap;
}
