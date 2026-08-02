import { User } from '@prisma/client';
import { CourseVersionService } from './course-version.service';
declare class PublishVersionDto {
    changeNotes?: string;
}
declare class MigrateEnrollmentDto {
    userCourseId: string;
    targetVersionId: string;
}
export declare class CourseVersionController {
    private readonly courseVersionService;
    constructor(courseVersionService: CourseVersionService);
    publishVersion(admin: User, courseId: string, body: PublishVersionDto): Promise<{
        message: string;
        statusCode: number;
        data: {
            stats: {
                modules: number;
                chapters: number;
                sections: number;
                quizzes: number;
            };
            skipped: boolean;
            id: string;
            courseId: string;
            versionNumber: number;
            status: import(".prisma/client").$Enums.CourseVersionStatus;
            publishedAt: Date;
            publishedByAdminId: string;
            changeNotes: string;
            isLatest: boolean;
            manifest: import(".prisma/client").Prisma.JsonValue;
            sectionCount: number;
            createdAt: Date;
            updatedAt: Date;
        };
    } | {
        message: string;
        statusCode: number;
        data: {
            stats: {
                modules: number;
                chapters: number;
                sections: number;
                quizzes: number;
            };
            id: string;
            courseId: string;
            versionNumber: number;
            status: import(".prisma/client").$Enums.CourseVersionStatus;
            publishedAt: Date;
            publishedByAdminId: string;
            changeNotes: string;
            isLatest: boolean;
            manifest: import(".prisma/client").Prisma.JsonValue;
            sectionCount: number;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    listVersions(courseId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            courseId: string;
            versionNumber: number;
            status: import(".prisma/client").$Enums.CourseVersionStatus;
            isLatest: boolean;
            publishedAt: Date;
            changeNotes: string;
            createdAt: Date;
            sectionCount: number;
            enrollmentCount: number;
        }[];
    }>;
    archiveVersion(admin: User, courseId: string, versionId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            versionId: string;
        };
    }>;
    pruneOrphanVersions(body?: {
        courseId?: string;
    }): Promise<{
        message: string;
        statusCode: number;
        data: {
            deleted: number;
            versionNumbers: number[];
        };
    }>;
    migrateLearner(admin: User, body: MigrateEnrollmentDto): Promise<{
        message: string;
        statusCode: number;
        data: {
            userCourseId: string;
            enrolledVersionId: string;
            versionNumber: number;
        };
    }>;
}
export {};
