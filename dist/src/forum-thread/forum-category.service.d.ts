import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
export declare class ForumCategoryService {
    private prisma;
    constructor(prisma: PrismaService);
    list(user: User, includeInactive?: boolean): Promise<{
        message: string;
        statusCode: number;
        data: {
            threadCount: number;
            lastActivityAt: Date;
            id: string;
            description: string;
            createdAt: Date;
            updatedAt: Date;
            isActive: boolean;
            name: string;
            sortOrder: number;
            slug: string;
            icon: string;
            courseScope: import(".prisma/client").$Enums.ForumCourseScope;
            studentCreatePolicy: import(".prisma/client").$Enums.ForumStudentCreatePolicy;
            notifyOnCreate: import(".prisma/client").$Enums.ForumNotifyOnCreate;
            allowAcceptedAnswer: boolean;
            allowVotes: boolean;
            allowMentions: boolean;
            tagPolicy: import(".prisma/client").$Enums.ForumTagPolicy;
            allowAttachments: boolean;
        }[];
    }>;
    create(user: User, body: any): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            description: string;
            createdAt: Date;
            updatedAt: Date;
            isActive: boolean;
            name: string;
            sortOrder: number;
            slug: string;
            icon: string;
            courseScope: import(".prisma/client").$Enums.ForumCourseScope;
            studentCreatePolicy: import(".prisma/client").$Enums.ForumStudentCreatePolicy;
            notifyOnCreate: import(".prisma/client").$Enums.ForumNotifyOnCreate;
            allowAcceptedAnswer: boolean;
            allowVotes: boolean;
            allowMentions: boolean;
            tagPolicy: import(".prisma/client").$Enums.ForumTagPolicy;
            allowAttachments: boolean;
        };
    }>;
    update(user: User, id: string, body: any): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            description: string;
            createdAt: Date;
            updatedAt: Date;
            isActive: boolean;
            name: string;
            sortOrder: number;
            slug: string;
            icon: string;
            courseScope: import(".prisma/client").$Enums.ForumCourseScope;
            studentCreatePolicy: import(".prisma/client").$Enums.ForumStudentCreatePolicy;
            notifyOnCreate: import(".prisma/client").$Enums.ForumNotifyOnCreate;
            allowAcceptedAnswer: boolean;
            allowVotes: boolean;
            allowMentions: boolean;
            tagPolicy: import(".prisma/client").$Enums.ForumTagPolicy;
            allowAttachments: boolean;
        };
    }>;
    remove(user: User, id: string): Promise<{
        message: string;
        statusCode: number;
        data: {};
    }>;
    moveThreads(user: User, fromId: string, toCategoryId: string | null): Promise<{
        message: string;
        statusCode: number;
        data: {
            moved: number;
            toCategoryId: string;
        };
    }>;
    private parseBool;
    private parseEnum;
    private assertAdmin;
    private fail;
    private wrap;
}
