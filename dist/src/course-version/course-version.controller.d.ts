import { User } from '@prisma/client';
import { CourseVersionService } from './course-version.service';
declare class PublishVersionDto {
    changeNotes?: string;
}
declare class MigrateEnrollmentDto {
    userCourseId: string;
    targetVersionId: string;
}
declare class BulkMigrateEnrollmentDto {
    userIds: string[];
    targetVersionId: string;
    dryRun: boolean;
    acceptRegressionFor?: string[];
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
    getRoster(courseId: string, page?: string, pageSize?: string, sort?: string, search?: string, versionFilter?: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            latestPublishedVersionId: string;
            latestPublishedVersionNumber: number;
            rows: {
                userId: string;
                userLabel: string;
                email: string;
                enrolledVersionId: string;
                enrolledVersionNumber: number;
                percentage: number;
                isCompleted: boolean;
                isActive: boolean;
                isPaid: boolean;
            }[];
            total: number;
            page: number;
            pageSize: number;
        };
    }>;
    diffVersions(courseId: string, from: string, to: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            fromVersionNumber: number;
            toVersionNumber: number;
        } & import("./course-version.manifest").DiffTitledResult;
    }>;
    getDrift(courseId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            hasDrift: boolean;
            changeCount: {
                added: number;
                removed: number;
                moved: number;
                renamed: number;
            };
            latestPublishedVersionId: string;
            latestPublishedVersionNumber: number;
            latestPublishedAt: Date;
            liveFingerprint: string;
            publishedFingerprint: string;
        };
    }>;
    getVersionTree(courseId: string, versionId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            versionId: string;
            versionNumber: number;
            status: string;
            publishedAt: Date;
            modules: {
                id: string;
                sourceId: string;
                title: string;
                orderIndex: number;
                chapters: {
                    id: string;
                    sourceId: string;
                    title: string;
                    orderIndex: number;
                    hasQuiz: boolean;
                    sections: {
                        id: string;
                        sourceId: string;
                        title: string;
                        type: string;
                        orderIndex: number;
                    }[];
                    quizzes: {
                        id: string;
                        sourceId: string;
                        question: string;
                        orderIndex: number;
                    }[];
                }[];
            }[];
        };
    }>;
    getCoverage(): Promise<{
        message: string;
        statusCode: number;
        data: {
            rows: {
                courseId: string;
                courseTitle: string;
                activeEnrollmentsWithNullPin: number;
            }[];
            coursesWithoutV1: {
                courseId: string;
                courseTitle: string;
            }[];
        };
    }>;
    bulkMigrate(admin: User, courseId: string, body: BulkMigrateEnrollmentDto): Promise<{
        message: string;
        statusCode: number;
        data: {
            dryRun: true;
            targetVersionNumber: number;
            results: {
                userId: string;
                userLabel: string;
                email: string;
                fromVersionId: string;
                fromVersionNumber: number;
                fromSectionCount: number;
                toSectionCount: number;
                currentPercentage: number;
                projectedPercentage: number;
                wouldRegress: boolean;
                isCertified: boolean;
            }[];
            summary: {
                total: number;
                wouldRegress: number;
                certifiedAndWouldRegress: number;
                notEnrolled: number;
                alreadyOnTarget: number;
            };
        } | {
            dryRun: false;
            migrated: string[];
            skipped: {
                userId: string;
                reason: "would_regress_not_accepted" | "migration_failed" | "user_not_enrolled" | "already_on_target_version";
                errorMessage?: string;
            }[];
        };
    }>;
}
export {};
