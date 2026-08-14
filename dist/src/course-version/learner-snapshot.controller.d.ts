import { LearnerSnapshotService } from './learner-snapshot.service';
export declare class LearnerSnapshotController {
    private readonly snapshotService;
    constructor(snapshotService: LearnerSnapshotService);
    getLearnerVersioning(userId: string, includeAudit?: string, auditLimit?: string, includeAssessments?: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            auditTrail?: any[];
            learner: any;
            summary: {
                totalCourses: number;
                activeCourses: number;
                completedCourses: number;
                coursesOnLatestVersion: number;
                coursesBehindLatest: number;
                coursesNotPinned: number;
                coursesAwaitingQuiz: number;
                totalTimeSpentSeconds: number;
            };
            courses: any[];
        };
    } | {
        message: string;
        statusCode: number;
        data: {
            assessments?: any[];
            auditTrail?: {
                id: string;
                action: string;
                actorEmail: string;
                courseId: string;
                courseTitle: string;
                isActor: boolean;
                metadata: import(".prisma/client").Prisma.JsonValue;
                createdAt: Date;
            }[];
            learner: {
                id: string;
                firstName: string;
                lastName: string;
                email: string;
                phone: string;
                timezone: string;
                mustChangePassword: boolean;
                role: import(".prisma/client").$Enums.Role;
                createdAt: Date;
                deletedAt: Date;
                status: import(".prisma/client").$Enums.UserStatus;
            };
            summary: {
                totalCourses: number;
                activeCourses: number;
                completedCourses: number;
                coursesOnLatestVersion: number;
                coursesBehindLatest: number;
                coursesNotPinned: number;
                coursesAwaitingQuiz: number;
                totalTimeSpentSeconds: any;
            };
            courses: {
                courseId: string;
                courseTitle: string;
                courseImage: string;
                enrollment: {
                    userCourseId: string;
                    isActive: boolean;
                    isPaid: boolean;
                    activatedAt: Date;
                    enrolledAt: Date;
                };
                pinnedVersion: {
                    versionId: string;
                    versionNumber: number;
                    status: import(".prisma/client").$Enums.CourseVersionStatus;
                    isLatest: boolean;
                    publishedAt: Date;
                    changeNotes: string;
                    sectionCount: number;
                };
                latestPublishedVersion: {
                    versionId: string;
                    versionNumber: number;
                    publishedAt: Date;
                    sectionCount: number;
                };
                versionStatus: import("./learner-snapshot.service").VersionStatus;
                versionsBehind: number;
                progress: {
                    percentage: number;
                    numerator: number;
                    denominator: number;
                    denominatorSource: import("./learner-percentage").DenominatorSource;
                    isCompleted: boolean;
                    courseCompletedAt: Date;
                    assessmentPassedAt: Date;
                    isPassed: boolean;
                    certificateUrl: string;
                };
                quizGate: any;
                activity: {
                    timeSpentSeconds: number;
                    firstActivityAt: Date;
                    lastActivityAt: Date;
                };
            }[];
        };
    }>;
    getLearnerCourseDetail(userId: string, courseId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            courseId: string;
            courseTitle: string;
            curriculumSource: string;
            pinnedVersion: {
                versionId: string;
                versionNumber: number;
                status: import(".prisma/client").$Enums.CourseVersionStatus;
            };
            answersAreLatestAttemptOnly: boolean;
            modules: {
                moduleId: string;
                title: string;
                completedAt: Date;
                chaptersTotal: number;
                chaptersCompleted: number;
                chapters: {
                    chapterId: any;
                    title: any;
                    completedAt: Date;
                    sectionsTotal: any;
                    sectionsCompleted: any;
                    timeSpentSeconds: any;
                    sections: any;
                    quiz: {
                        totalQuestions: number;
                        answered: number;
                        correct: number;
                        attempts: number;
                        score: number;
                        passingCriteria: number;
                        isPassed: boolean;
                        questions: {
                            quizId: string;
                            question: string;
                            options: string[];
                            correctAnswer: string;
                            givenAnswer: string;
                            isCorrect: boolean;
                            answeredAt: Date;
                        }[];
                    };
                }[];
            }[];
        };
    }>;
}
