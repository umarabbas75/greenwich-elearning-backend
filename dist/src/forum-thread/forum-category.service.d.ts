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
            allowAcceptedAnswer: boolean;
            allowVotes: boolean;
            allowMentions: boolean;
            allowAttachments: boolean;
            slug: string;
            icon: string;
            courseScope: import(".prisma/client").$Enums.ForumCourseScope;
            studentCreatePolicy: import(".prisma/client").$Enums.ForumStudentCreatePolicy;
            notifyOnCreate: import(".prisma/client").$Enums.ForumNotifyOnCreate;
            tagPolicy: import(".prisma/client").$Enums.ForumTagPolicy;
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
            allowAcceptedAnswer: boolean;
            allowVotes: boolean;
            allowMentions: boolean;
            allowAttachments: boolean;
            slug: string;
            icon: string;
            courseScope: import(".prisma/client").$Enums.ForumCourseScope;
            studentCreatePolicy: import(".prisma/client").$Enums.ForumStudentCreatePolicy;
            notifyOnCreate: import(".prisma/client").$Enums.ForumNotifyOnCreate;
            tagPolicy: import(".prisma/client").$Enums.ForumTagPolicy;
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
            allowAcceptedAnswer: boolean;
            allowVotes: boolean;
            allowMentions: boolean;
            allowAttachments: boolean;
            slug: string;
            icon: string;
            courseScope: import(".prisma/client").$Enums.ForumCourseScope;
            studentCreatePolicy: import(".prisma/client").$Enums.ForumStudentCreatePolicy;
            notifyOnCreate: import(".prisma/client").$Enums.ForumNotifyOnCreate;
            tagPolicy: import(".prisma/client").$Enums.ForumTagPolicy;
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
