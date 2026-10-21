import { PrismaService } from '../prisma/prisma.service';
export declare const courseCategorySelect: {
    id: true;
    name: true;
    slug: true;
};
export declare class CourseCategoryService {
    private prisma;
    constructor(prisma: PrismaService);
    list(): Promise<{
        message: string;
        statusCode: number;
        data: {
            courseCount: number;
            id: string;
            name: string;
            slug: string;
            description: string;
            sortOrder: number;
            createdAt: Date;
            updatedAt: Date;
        }[];
    }>;
    create(body: {
        name: string;
        description?: string;
        sortOrder?: number;
        slug?: string;
    }): Promise<{
        message: string;
        statusCode: number;
        data: {
            courseCount: number;
            id: string;
            name: string;
            slug: string;
            description: string;
            sortOrder: number;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    update(id: string, body: {
        name?: string;
        description?: string | null;
        sortOrder?: number;
        slug?: string;
    }): Promise<{
        message: string;
        statusCode: number;
        data: {
            courseCount: number;
            id: string;
            name: string;
            slug: string;
            description: string;
            sortOrder: number;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    remove(id: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
        };
    }>;
    assign(courseId: string, categoryId: string | null, adminId?: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            title: string;
            categoryId: string;
            category: {
                id: string;
                name: string;
                slug: string;
            };
        };
    }>;
    private resolveSortOrder;
    private resolveSlug;
    private optionalText;
    private fail;
    private missing;
    private wrapUnique;
}
