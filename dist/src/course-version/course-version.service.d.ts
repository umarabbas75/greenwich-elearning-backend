import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DiffTitledResult, getChapterIdsFromManifest, getQuizIdsFromManifest, getSectionIdsFromManifest, PinnedCurriculumModule, PinnedCurriculumQuiz, PinnedCurriculumSection, PinnedCurriculumTree, ReportCurriculumTree } from './course-version.manifest';
export type CurriculumResolveResult = {
    mode: 'live';
} | {
    mode: 'versioned';
    versionId: string;
    versionNumber: number;
    tree: PinnedCurriculumTree;
};
export type ReportCurriculumResolveResult = {
    mode: 'live';
} | {
    mode: 'versioned';
    versionId: string;
    versionNumber: number;
    tree: ReportCurriculumTree;
};
export declare class CourseVersionService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    resolveCurriculumTree(userId: string, courseId: string): Promise<CurriculumResolveResult>;
    resolveCurriculumTreeForReport(userId: string, courseId: string, preloadedUc?: {
        id: string;
        enrolledVersionId: string | null;
    } | null): Promise<ReportCurriculumResolveResult>;
    resolveEnrolledVersionId(userId: string, courseId: string, preloadedUc?: {
        id: string;
        enrolledVersionId: string | null;
    } | null): Promise<string | null>;
    getVersionQuizzesForChapter(userId: string, courseId: string, sourceChapterId: string, includeAnswers?: boolean, preResolvedVersionId?: string | null): Promise<Array<{
        id: string;
        question: string;
        options: string[];
        answer?: string;
    }> | null>;
    resolveCurriculumByEnrollment(enrolledVersionId: string | null | undefined): Promise<CurriculumResolveResult>;
    getLatestPublishedVersion(courseId: string): Promise<{
        id: string;
        manifest: Prisma.JsonValue;
        sectionCount: number;
        versionNumber: number;
        publishedAt: Date;
    }>;
    pinEnrollmentToLatest(userCourseId: string, tx?: Prisma.TransactionClient): Promise<void>;
    publishNewVersion(adminId: string | null | undefined, courseId: string, changeNotes?: string): Promise<{
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
            manifest: Prisma.JsonValue;
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
            manifest: Prisma.JsonValue;
            sectionCount: number;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    autoPublishAfterStructuralChange(courseId: string, adminId: string | null | undefined, changeNotes: string): Promise<{
        versionNumber: number;
        versionId: string;
    } | null>;
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
    archiveVersion(adminId: string, courseId: string, versionId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            versionId: string;
        };
    }>;
    migrateLearnerToVersion(adminId: string, userCourseId: string, targetVersionId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            userCourseId: string;
            enrolledVersionId: string;
            versionNumber: number;
        };
    }>;
    private _migrateOneLearner;
    writeAudit(entry: {
        adminId: string;
        action: string;
        targetType: string;
        targetId?: string | null;
        courseId?: string | null;
        userId?: string | null;
        metadata?: Record<string, unknown> | null;
    }, tx?: Prisma.TransactionClient): Promise<void>;
    countCompletionDenominator(userId: string, courseId: string): Promise<{
        total: number;
        liveSectionIds: string[];
    }>;
    countVersionSectionsForCourse(versionId: string): Promise<number>;
    buildUserModulesFromVersion(tree: PinnedCurriculumTree, progressByChapter: Map<string, number>, progressByModule: Map<string, number>): {
        id: string;
        title: string;
        chapters: {
            id: string;
            title: string;
            _count: {
                UserCourseProgress: number;
                sections: number;
                quizzes: number;
            };
            QuizProgress: unknown[];
        }[];
        _count: {
            UserCourseProgress: number;
            sections: number;
        };
    }[];
    findVersionChapterBySourceId(tree: PinnedCurriculumTree, sourceChapterId: string): {
        module: PinnedCurriculumModule;
        chapter: PinnedCurriculumChapter;
    } | null;
    mapVersionSectionsForLearner(sections: PinnedCurriculumSection[]): PinnedCurriculumSection[];
    mapVersionQuizzesForLearner(quizzes: PinnedCurriculumQuiz[], includeAnswers: boolean): (Omit<PinnedCurriculumQuiz, "answer"> & {
        answer?: string;
    })[];
    summarizeNewSincePinnedVersion(userId: string, courseId: string, enrolledVersionId?: string | null): Promise<{
        newChapters: number;
        newSections: number;
        addedAt: Date | null;
    } | null>;
    isReferencedByAnyVersion(table: 'section' | 'chapter' | 'module' | 'quiz', sourceId: string, courseId?: string): Promise<boolean>;
    buildArchiveMessage(entity: 'Module' | 'Chapter' | 'Section' | 'Quiz', stillServedTo: number, versions: Array<{
        versionNumber: number;
    }>): string;
    getReferencingVersionsWithEnrollments(table: 'section' | 'chapter' | 'module' | 'quiz', sourceId: string, courseId?: string): Promise<{
        stillServedTo: number;
        versions: Array<{
            versionId: string;
            versionNumber: number;
            status: string;
            enrollmentCount: number;
        }>;
    }>;
    getReferencingVersionsWithEnrollmentsBatch(table: 'section' | 'chapter' | 'module' | 'quiz', sourceIds: string[], courseId?: string): Promise<Map<string, {
        stillServedTo: number;
        versions: Array<{
            versionId: string;
            versionNumber: number;
            status: string;
            enrollmentCount: number;
        }>;
    }>>;
    buildRestoreNote(latestVersionNumber: number | null | undefined): string;
    getRoster(courseId: string, opts: {
        page?: number;
        pageSize?: number;
        sort?: string;
        search?: string;
        versionFilter?: string;
    }): Promise<{
        message: string;
        statusCode: number;
        data: {
            latestPublishedVersionId: string | null;
            latestPublishedVersionNumber: number | null;
            rows: Array<{
                userId: string;
                userLabel: string;
                email: string;
                enrolledVersionId: string | null;
                enrolledVersionNumber: number | null;
                percentage: number;
                isCompleted: boolean;
                isActive: boolean;
                isPaid: boolean;
            }>;
            total: number;
            page: number;
            pageSize: number;
        };
    }>;
    private _buildRosterOrderBy;
    getVersionTree(courseId: string, versionId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            versionId: string;
            versionNumber: number;
            status: string;
            publishedAt: Date | null;
            modules: Array<{
                id: string;
                sourceId: string;
                title: string;
                orderIndex: number;
                chapters: Array<{
                    id: string;
                    sourceId: string;
                    title: string;
                    orderIndex: number;
                    hasQuiz: boolean;
                    sections: Array<{
                        id: string;
                        sourceId: string;
                        title: string;
                        type: string;
                        orderIndex: number | null;
                    }>;
                    quizzes: Array<{
                        id: string;
                        sourceId: string;
                        question: string;
                        orderIndex: number | null;
                    }>;
                }>;
            }>;
        };
    }>;
    diffVersionsTitled(courseId: string, fromVersionId: string, toVersionId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            fromVersionNumber: number;
            toVersionNumber: number;
        } & DiffTitledResult;
    }>;
    getCoverage(): Promise<{
        message: string;
        statusCode: number;
        data: {
            rows: Array<{
                courseId: string;
                courseTitle: string;
                activeEnrollmentsWithNullPin: number;
            }>;
            coursesWithoutV1: Array<{
                courseId: string;
                courseTitle: string;
            }>;
        };
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
            latestPublishedVersionId: string | null;
            latestPublishedVersionNumber: number | null;
            latestPublishedAt: Date | null;
            liveFingerprint: string;
            publishedFingerprint: string | null;
        };
    }>;
    migrateLearnersToVersionBulk(adminId: string, courseId: string, params: {
        userIds: string[];
        targetVersionId: string;
        dryRun: boolean;
        acceptRegressionFor?: string[];
    }): Promise<{
        message: string;
        statusCode: number;
        data: {
            dryRun: true;
            targetVersionNumber: number;
            results: Array<{
                userId: string;
                userLabel: string;
                email: string;
                fromVersionId: string | null;
                fromVersionNumber: number | null;
                fromSectionCount: number | null;
                toSectionCount: number | null;
                currentPercentage: number;
                projectedPercentage: number;
                wouldRegress: boolean;
                isCertified: boolean;
            }>;
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
            skipped: Array<{
                userId: string;
                reason: 'would_regress_not_accepted' | 'migration_failed' | 'user_not_enrolled' | 'already_on_target_version';
                errorMessage?: string;
            }>;
        };
    }>;
    pruneOrphanVersions(courseId?: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            deleted: number;
            versionNumbers: number[];
        };
    }>;
    getManifestForVersion(versionId: string): Promise<import("./course-version.manifest").CourseVersionManifest>;
    getChapterIdsFromManifest: typeof getChapterIdsFromManifest;
    getSectionIdsFromManifest: typeof getSectionIdsFromManifest;
    getQuizIdsFromManifest: typeof getQuizIdsFromManifest;
}
type PinnedCurriculumChapter = PinnedCurriculumModule['chapters'][number];
export {};
