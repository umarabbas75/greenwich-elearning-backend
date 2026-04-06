import { AssessmentAttemptStatus, Prisma, QuestionDifficulty, QuestionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifiications/notification.service';
import { AddAssessmentQuestionDto, CreateAssessmentDto, CreateQuestionCategoryDto, CreateQuestionDto, GradeAttemptDto, ReorderAssessmentQuestionsDto, SetCertificateDto, StartAttemptDto, SubmitAttemptDto, UpdateAssessmentDto, UpdateQuestionCategoryDto, UpdateQuestionDto } from '../dto';
export declare class CourseAssessmentService {
    private prisma;
    private notificationService;
    constructor(prisma: PrismaService, notificationService: NotificationService);
    private throwQuestionCategoryError;
    createCategory(adminId: string, body: CreateQuestionCategoryDto): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            name: string;
            courseId: string;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    getCategoriesByCourse(courseId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            name: string;
            courseId: string;
            createdAt: Date;
            updatedAt: Date;
        }[];
    }>;
    updateCategory(categoryId: string, body: UpdateQuestionCategoryDto): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            name: string;
            courseId: string;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    deleteCategory(categoryId: string): Promise<{
        message: string;
        statusCode: number;
        data: {};
    }>;
    createQuestion(adminId: string, body: CreateQuestionDto): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            courseId: string;
            categoryId: string;
            type: import(".prisma/client").$Enums.QuestionType;
            difficulty: import(".prisma/client").$Enums.QuestionDifficulty;
            text: string;
            imageUrl: string;
            content: Prisma.JsonValue;
            maxMarks: number;
            isActive: boolean;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    getQuestions(courseId: string, filters: {
        categoryId?: string;
        difficulty?: QuestionDifficulty;
        type?: QuestionType;
        isActive?: boolean;
    }): Promise<{
        message: string;
        statusCode: number;
        data: ({
            category: {
                id: string;
                name: string;
            };
        } & {
            id: string;
            courseId: string;
            categoryId: string;
            type: import(".prisma/client").$Enums.QuestionType;
            difficulty: import(".prisma/client").$Enums.QuestionDifficulty;
            text: string;
            imageUrl: string;
            content: Prisma.JsonValue;
            maxMarks: number;
            isActive: boolean;
            createdAt: Date;
            updatedAt: Date;
        })[];
    }>;
    getQuestionById(questionId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            category: {
                id: string;
                name: string;
                courseId: string;
                createdAt: Date;
                updatedAt: Date;
            };
        } & {
            id: string;
            courseId: string;
            categoryId: string;
            type: import(".prisma/client").$Enums.QuestionType;
            difficulty: import(".prisma/client").$Enums.QuestionDifficulty;
            text: string;
            imageUrl: string;
            content: Prisma.JsonValue;
            maxMarks: number;
            isActive: boolean;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    updateQuestion(questionId: string, body: UpdateQuestionDto): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            courseId: string;
            categoryId: string;
            type: import(".prisma/client").$Enums.QuestionType;
            difficulty: import(".prisma/client").$Enums.QuestionDifficulty;
            text: string;
            imageUrl: string;
            content: Prisma.JsonValue;
            maxMarks: number;
            isActive: boolean;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    deleteQuestion(questionId: string, permanent: boolean): Promise<{
        message: string;
        statusCode: number;
        data: {};
    } | {
        message: string;
        statusCode: number;
        data: {
            id: string;
            courseId: string;
            categoryId: string;
            type: import(".prisma/client").$Enums.QuestionType;
            difficulty: import(".prisma/client").$Enums.QuestionDifficulty;
            text: string;
            imageUrl: string;
            content: Prisma.JsonValue;
            maxMarks: number;
            isActive: boolean;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    createAssessment(adminId: string, body: CreateAssessmentDto): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            courseId: string;
            title: string;
            description: string;
            mode: import(".prisma/client").$Enums.AssessmentMode;
            isActive: boolean;
            passingPercentage: number;
            timeLimitMinutes: number;
            maxAttempts: number;
            autoConfig: Prisma.JsonValue;
            createdByAdminId: string;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    updateAssessment(assessmentId: string, body: UpdateAssessmentDto): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            courseId: string;
            title: string;
            description: string;
            mode: import(".prisma/client").$Enums.AssessmentMode;
            isActive: boolean;
            passingPercentage: number;
            timeLimitMinutes: number;
            maxAttempts: number;
            autoConfig: Prisma.JsonValue;
            createdByAdminId: string;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    activateAssessment(assessmentId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            courseId: string;
            title: string;
            description: string;
            mode: import(".prisma/client").$Enums.AssessmentMode;
            isActive: boolean;
            passingPercentage: number;
            timeLimitMinutes: number;
            maxAttempts: number;
            autoConfig: Prisma.JsonValue;
            createdByAdminId: string;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    deactivateAssessment(assessmentId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            courseId: string;
            title: string;
            description: string;
            mode: import(".prisma/client").$Enums.AssessmentMode;
            isActive: boolean;
            passingPercentage: number;
            timeLimitMinutes: number;
            maxAttempts: number;
            autoConfig: Prisma.JsonValue;
            createdByAdminId: string;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    getAssessmentsByCourse(courseId: string): Promise<{
        message: string;
        statusCode: number;
        data: ({
            _count: {
                assessmentQuestions: number;
                attempts: number;
            };
        } & {
            id: string;
            courseId: string;
            title: string;
            description: string;
            mode: import(".prisma/client").$Enums.AssessmentMode;
            isActive: boolean;
            passingPercentage: number;
            timeLimitMinutes: number;
            maxAttempts: number;
            autoConfig: Prisma.JsonValue;
            createdByAdminId: string;
            createdAt: Date;
            updatedAt: Date;
        })[];
    }>;
    getAssessmentById(assessmentId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            _count: {
                attempts: number;
            };
            assessmentQuestions: ({
                question: {
                    id: string;
                    courseId: string;
                    categoryId: string;
                    type: import(".prisma/client").$Enums.QuestionType;
                    difficulty: import(".prisma/client").$Enums.QuestionDifficulty;
                    text: string;
                    imageUrl: string;
                    content: Prisma.JsonValue;
                    maxMarks: number;
                    isActive: boolean;
                    createdAt: Date;
                    updatedAt: Date;
                };
            } & {
                id: string;
                assessmentId: string;
                questionId: string;
                orderIndex: number;
                marksOverride: number;
                createdAt: Date;
            })[];
        } & {
            id: string;
            courseId: string;
            title: string;
            description: string;
            mode: import(".prisma/client").$Enums.AssessmentMode;
            isActive: boolean;
            passingPercentage: number;
            timeLimitMinutes: number;
            maxAttempts: number;
            autoConfig: Prisma.JsonValue;
            createdByAdminId: string;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    addQuestionToAssessment(assessmentId: string, body: AddAssessmentQuestionDto): Promise<{
        message: string;
        statusCode: number;
        data: {
            question: {
                id: string;
                courseId: string;
                categoryId: string;
                type: import(".prisma/client").$Enums.QuestionType;
                difficulty: import(".prisma/client").$Enums.QuestionDifficulty;
                text: string;
                imageUrl: string;
                content: Prisma.JsonValue;
                maxMarks: number;
                isActive: boolean;
                createdAt: Date;
                updatedAt: Date;
            };
        } & {
            id: string;
            assessmentId: string;
            questionId: string;
            orderIndex: number;
            marksOverride: number;
            createdAt: Date;
        };
    }>;
    removeQuestionFromAssessment(assessmentId: string, questionId: string): Promise<{
        message: string;
        statusCode: number;
        data: {};
    }>;
    reorderAssessmentQuestions(assessmentId: string, body: ReorderAssessmentQuestionsDto): Promise<{
        message: string;
        statusCode: number;
        data: {};
    }>;
    getActiveAssessmentForStudent(userId: string, courseId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            assessment: {
                id: string;
                title: string;
                description: string;
                mode: import(".prisma/client").$Enums.AssessmentMode;
                passingPercentage: number;
                timeLimitMinutes: number;
                maxAttempts: number;
            };
            isEligible: boolean;
            remainingAttempts: number;
            canStart: boolean;
            inProgressAttemptId: string;
            attempts: {
                status: import(".prisma/client").$Enums.AssessmentAttemptStatus;
                id: string;
                totalMarks: number;
                marksObtained: number;
                percentage: number;
                isPassed: boolean;
                startedAt: Date;
                submittedAt: Date;
                finalizedAt: Date;
            }[];
        }[];
    }>;
    startAttempt(userId: string, body: StartAttemptDto): Promise<{
        message: string;
        statusCode: number;
        data: any;
    }>;
    getAttempt(userId: string, attemptId: string): Promise<{
        message: string;
        statusCode: number;
        data: any;
    }>;
    submitAttempt(userId: string, attemptId: string, body: SubmitAttemptDto): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            assessmentId: string;
            userId: string;
            status: import(".prisma/client").$Enums.AssessmentAttemptStatus;
            snapshotTitle: string;
            snapshotPassingPct: number;
            snapshotMaxAttempts: number;
            snapshotTimeLimitMin: number;
            totalMarks: number;
            marksObtained: number;
            percentage: number;
            isPassed: boolean;
            startedAt: Date;
            submittedAt: Date;
            gradedAt: Date;
            finalizedAt: Date;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    getStudentAttemptHistory(userId: string, courseId: string): Promise<{
        message: string;
        statusCode: number;
        data: ({
            questionSnapshots: {
                id: string;
                maxMarks: number;
                orderIndex: number;
                questionType: import(".prisma/client").$Enums.QuestionType;
                questionText: string;
                questionImageUrl: string;
                studentAnswer: Prisma.JsonValue;
                isAnswered: boolean;
                isLocked: boolean;
                systemScore: number;
                finalScore: number;
                adminFeedback: string;
            }[];
        } & {
            id: string;
            assessmentId: string;
            userId: string;
            status: import(".prisma/client").$Enums.AssessmentAttemptStatus;
            snapshotTitle: string;
            snapshotPassingPct: number;
            snapshotMaxAttempts: number;
            snapshotTimeLimitMin: number;
            totalMarks: number;
            marksObtained: number;
            percentage: number;
            isPassed: boolean;
            startedAt: Date;
            submittedAt: Date;
            gradedAt: Date;
            finalizedAt: Date;
            createdAt: Date;
            updatedAt: Date;
        })[];
    }>;
    getStudentCompletion(userId: string, courseId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            bestAttempt: {
                id: string;
                percentage: number;
                isPassed: boolean;
                submittedAt: Date;
                finalizedAt: Date;
            };
        } & {
            id: string;
            userId: string;
            courseId: string;
            isPassed: boolean;
            bestAttemptId: string;
            certificateUrl: string;
            courseCompletedAt: Date;
            assessmentPassedAt: Date;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    getAdminAttempts(courseId: string, filters: {
        status?: AssessmentAttemptStatus;
        userId?: string;
    }): Promise<{
        message: string;
        statusCode: number;
        data: ({
            assessment: {
                id: string;
                title: string;
            };
            user: {
                id: string;
                firstName: string;
                lastName: string;
                email: string;
            };
        } & {
            id: string;
            assessmentId: string;
            userId: string;
            status: import(".prisma/client").$Enums.AssessmentAttemptStatus;
            snapshotTitle: string;
            snapshotPassingPct: number;
            snapshotMaxAttempts: number;
            snapshotTimeLimitMin: number;
            totalMarks: number;
            marksObtained: number;
            percentage: number;
            isPassed: boolean;
            startedAt: Date;
            submittedAt: Date;
            gradedAt: Date;
            finalizedAt: Date;
            createdAt: Date;
            updatedAt: Date;
        })[];
    }>;
    getAdminAttemptDetail(attemptId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            user: {
                id: string;
                firstName: string;
                lastName: string;
                email: string;
            };
            questionSnapshots: {
                id: string;
                attemptId: string;
                questionId: string;
                orderIndex: number;
                questionType: import(".prisma/client").$Enums.QuestionType;
                questionText: string;
                questionImageUrl: string;
                questionContent: Prisma.JsonValue;
                maxMarks: number;
                studentAnswer: Prisma.JsonValue;
                isAnswered: boolean;
                isLocked: boolean;
                systemScore: number;
                adminScore: number;
                finalScore: number;
                adminFeedback: string;
                gradedAt: Date;
                createdAt: Date;
                updatedAt: Date;
            }[];
        } & {
            id: string;
            assessmentId: string;
            userId: string;
            status: import(".prisma/client").$Enums.AssessmentAttemptStatus;
            snapshotTitle: string;
            snapshotPassingPct: number;
            snapshotMaxAttempts: number;
            snapshotTimeLimitMin: number;
            totalMarks: number;
            marksObtained: number;
            percentage: number;
            isPassed: boolean;
            startedAt: Date;
            submittedAt: Date;
            gradedAt: Date;
            finalizedAt: Date;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    gradeAttempt(attemptId: string, body: GradeAttemptDto): Promise<{
        message: string;
        statusCode: number;
        data: {
            attempt: {
                questionSnapshots: {
                    id: string;
                    attemptId: string;
                    questionId: string;
                    orderIndex: number;
                    questionType: import(".prisma/client").$Enums.QuestionType;
                    questionText: string;
                    questionImageUrl: string;
                    questionContent: Prisma.JsonValue;
                    maxMarks: number;
                    studentAnswer: Prisma.JsonValue;
                    isAnswered: boolean;
                    isLocked: boolean;
                    systemScore: number;
                    adminScore: number;
                    finalScore: number;
                    adminFeedback: string;
                    gradedAt: Date;
                    createdAt: Date;
                    updatedAt: Date;
                }[];
            } & {
                id: string;
                assessmentId: string;
                userId: string;
                status: import(".prisma/client").$Enums.AssessmentAttemptStatus;
                snapshotTitle: string;
                snapshotPassingPct: number;
                snapshotMaxAttempts: number;
                snapshotTimeLimitMin: number;
                totalMarks: number;
                marksObtained: number;
                percentage: number;
                isPassed: boolean;
                startedAt: Date;
                submittedAt: Date;
                gradedAt: Date;
                finalizedAt: Date;
                createdAt: Date;
                updatedAt: Date;
            };
            previewMarks: number;
            previewPercentage: number;
        };
    }>;
    finalizeGrade(adminId: string, attemptId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            questionSnapshots: {
                id: string;
                attemptId: string;
                questionId: string;
                orderIndex: number;
                questionType: import(".prisma/client").$Enums.QuestionType;
                questionText: string;
                questionImageUrl: string;
                questionContent: Prisma.JsonValue;
                maxMarks: number;
                studentAnswer: Prisma.JsonValue;
                isAnswered: boolean;
                isLocked: boolean;
                systemScore: number;
                adminScore: number;
                finalScore: number;
                adminFeedback: string;
                gradedAt: Date;
                createdAt: Date;
                updatedAt: Date;
            }[];
        } & {
            id: string;
            assessmentId: string;
            userId: string;
            status: import(".prisma/client").$Enums.AssessmentAttemptStatus;
            snapshotTitle: string;
            snapshotPassingPct: number;
            snapshotMaxAttempts: number;
            snapshotTimeLimitMin: number;
            totalMarks: number;
            marksObtained: number;
            percentage: number;
            isPassed: boolean;
            startedAt: Date;
            submittedAt: Date;
            gradedAt: Date;
            finalizedAt: Date;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    setCertificate(userId: string, courseId: string, body: SetCertificateDto): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            userId: string;
            courseId: string;
            isPassed: boolean;
            bestAttemptId: string;
            certificateUrl: string;
            courseCompletedAt: Date;
            assessmentPassedAt: Date;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    private _isCourseContentCompleted;
    private _buildQuestionList;
    private _shuffle;
    private _calculateAutoScore;
    private _stripCorrectAnswers;
    private _upsertCourseCompletion;
}
