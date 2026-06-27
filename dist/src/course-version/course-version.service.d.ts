import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
declare const versionInclude: {
    modules: {
        orderBy: {
            orderIndex: "asc";
        };
        include: {
            chapters: {
                orderBy: {
                    orderIndex: "asc";
                };
                include: {
                    sections: true;
                    quizzes: true;
                };
            };
        };
    };
};
export type CurriculumResolveResult = {
    mode: 'live';
} | {
    mode: 'versioned';
    versionId: string;
    versionNumber: number;
    version: Prisma.CourseVersionGetPayload<{
        include: typeof versionInclude;
    }>;
};
export declare class CourseVersionService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    resolveCurriculumTree(userId: string, courseId: string): Promise<CurriculumResolveResult>;
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
        courseId: string;
        versionNumber: number;
        status: import(".prisma/client").$Enums.CourseVersionStatus;
        publishedAt: Date;
        publishedByAdminId: string;
        changeNotes: string;
        isLatest: boolean;
        createdAt: Date;
        updatedAt: Date;
    }>;
    private countLiveTreeStats;
    private countVersionStats;
    isLiveTreeDriftedFromLatest(courseId: string): Promise<boolean>;
    syncPublishedVersionWithLiveTree(courseId: string, adminId?: string | null, changeNotes?: string): Promise<{
        versionNumber: number;
        versionId: string;
    } | null>;
    pinEnrollmentToLatest(userCourseId: string, tx?: Prisma.TransactionClient): Promise<void>;
    syncSectionToLatestVersion(sectionId: string): Promise<void>;
    syncChapterSectionOrderToLatestVersion(chapterId: string): Promise<void>;
    syncModuleToLatestVersion(moduleId: string): Promise<void>;
    syncQuizToLatestVersion(quizId: string): Promise<void>;
    syncChapterToLatestVersion(chapterId: string): Promise<void>;
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
            id: string;
            courseId: string;
            versionNumber: number;
            status: import(".prisma/client").$Enums.CourseVersionStatus;
            publishedAt: Date;
            publishedByAdminId: string;
            changeNotes: string;
            isLatest: boolean;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    autoPublishAfterStructuralChange(courseId: string, adminId: string | null | undefined, changeNotes: string): Promise<{
        versionNumber: number;
        versionId: string;
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
            moduleCount: number;
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
    countCompletionDenominator(userId: string, courseId: string): Promise<{
        total: number;
        liveSectionIds: string[];
    }>;
    countVersionSectionsForCourse(versionId: string): Promise<number>;
    buildUserModulesFromVersion(version: Prisma.CourseVersionGetPayload<{
        include: typeof versionInclude;
    }>, userId: string, progressByChapter: Map<string, number>, progressByModule: Map<string, number>): {
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
    findVersionChapterBySourceId(version: Prisma.CourseVersionGetPayload<{
        include: typeof versionInclude;
    }>, sourceChapterId: string): {
        module: {
            chapters: ({
                sections: {
                    id: string;
                    versionId: string;
                    versionChapterId: string;
                    sourceSectionId: string;
                    title: string;
                    description: string;
                    shortDescription: string;
                    type: import(".prisma/client").$Enums.SectionType;
                    orderIndex: number;
                    itemLabel: string;
                    categoryLabel: string;
                    categories: string[];
                    maxPerCategory: number;
                    isActive: boolean;
                    questionText: string;
                    imageUrl: string;
                    allowMultipleSelection: boolean;
                    items: Prisma.JsonValue;
                    options: Prisma.JsonValue;
                    config: Prisma.JsonValue;
                    createdAt: Date;
                    updatedAt: Date;
                }[];
                quizzes: {
                    id: string;
                    versionId: string;
                    versionChapterId: string;
                    sourceQuizId: string;
                    question: string;
                    answer: string;
                    options: string[];
                    createdAt: Date;
                    updatedAt: Date;
                }[];
            } & {
                id: string;
                versionId: string;
                versionModuleId: string;
                sourceChapterId: string;
                title: string;
                description: string;
                pdfFile: string;
                orderIndex: number;
                hasQuiz: boolean;
                createdAt: Date;
                updatedAt: Date;
            })[];
        } & {
            id: string;
            versionId: string;
            sourceModuleId: string;
            title: string;
            description: string;
            orderIndex: number;
            createdAt: Date;
            updatedAt: Date;
        };
        chapter: {
            sections: {
                id: string;
                versionId: string;
                versionChapterId: string;
                sourceSectionId: string;
                title: string;
                description: string;
                shortDescription: string;
                type: import(".prisma/client").$Enums.SectionType;
                orderIndex: number;
                itemLabel: string;
                categoryLabel: string;
                categories: string[];
                maxPerCategory: number;
                isActive: boolean;
                questionText: string;
                imageUrl: string;
                allowMultipleSelection: boolean;
                items: Prisma.JsonValue;
                options: Prisma.JsonValue;
                config: Prisma.JsonValue;
                createdAt: Date;
                updatedAt: Date;
            }[];
            quizzes: {
                id: string;
                versionId: string;
                versionChapterId: string;
                sourceQuizId: string;
                question: string;
                answer: string;
                options: string[];
                createdAt: Date;
                updatedAt: Date;
            }[];
        } & {
            id: string;
            versionId: string;
            versionModuleId: string;
            sourceChapterId: string;
            title: string;
            description: string;
            pdfFile: string;
            orderIndex: number;
            hasQuiz: boolean;
            createdAt: Date;
            updatedAt: Date;
        };
    };
    mapVersionSectionsForLearner(sections: Prisma.CourseVersionSectionGetPayload<object>[]): {
        id: string;
        title: string;
        description: string;
        chapterId: string;
        moduleId: string;
        createdAt: Date;
        updatedAt: Date;
        shortDescription: string;
        type: string;
        orderIndex: number;
        itemLabel: string;
        categoryLabel: string;
        categories: string[];
        maxPerCategory: number;
        isActive: boolean;
        questionText: string;
        imageUrl: string;
        allowMultipleSelection: boolean;
        items: unknown;
        options: unknown;
        config: unknown;
    }[];
    mapVersionQuizzesForLearner(quizzes: Prisma.CourseVersionQuizGetPayload<object>[], includeAnswers: boolean): {
        id: string;
        question: string;
        options: string[];
    }[];
    summarizeNewSincePinnedVersion(userId: string, courseId: string): Promise<{
        newChapters: number;
        newSections: number;
        addedAt: Date | null;
    } | null>;
    isReferencedByAnyVersion(table: 'section' | 'chapter' | 'module' | 'quiz', sourceId: string): Promise<boolean>;
}
export {};
