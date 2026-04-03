import { Role, QuestionType, QuestionDifficulty, AssessmentMode } from '@prisma/client';
export declare class BodyDto {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    phone: string;
    role: Role;
    photo?: string;
    photoBase64?: string;
}
export declare class BodyUpdateDto {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    photo?: string;
    status?: string;
}
export declare class ChangePasswordDto {
    password: string;
    oldPassword: string;
}
export declare class LoginDto {
    email: string;
    password: string;
}
export declare class CourseDto {
    title: string;
    price: string;
    duration: string;
    description: string;
    assessment: string;
    image: string;
    overview: string;
    syllabusOverview: string;
    resourcesOverview: string;
    tutorInfo?: string;
    assessments: Array<{
        file: string;
        isSeen: boolean;
    }>;
    resources: Array<{
        file: string;
        isSeen: boolean;
    }>;
    syllabus: Array<{
        file: string;
        isSeen: boolean;
    }>;
    courseForms?: Array<{
        value: string;
        label: string;
        isRequired?: boolean;
    }>;
    feedbackForm?: {
        isRequired: boolean;
        formName: string;
        formStructure: any;
    };
    policies?: Array<any>;
}
export declare class QuizDto {
    question: string;
    options: string[];
    answer: string;
}
export declare class UpdateQuizDto {
    question: string;
    options: string[];
    answer: string;
}
export declare class AssignQuizDto {
    chapterId: string;
    quizId: string;
}
export declare class UpdateCourseDto {
    title?: string;
    pdfFile?: string;
    price?: string;
    description?: string;
    assessment?: string;
    image?: string;
    overview?: string;
    tutorInfo?: string;
    courseForms?: Array<{
        value: string;
        label: string;
        isRequired?: boolean;
    }>;
    feedbackForm?: {
        isRequired: boolean;
        formName: string;
        formStructure: any;
    };
    policies?: Array<any>;
}
export declare class UpdateCourseProgress {
    courseId: string;
    chapterId: string;
    sectionId: string;
}
export declare class AssignCourseDto {
    userId: string;
    courseId: string;
    chapterId: string;
}
export declare class ModuleDto {
    title: string;
    description: string;
    id: string;
    pdfFile: string;
}
export declare class ParamsDto {
    id: string;
}
export declare class ParamsDto1 {
    id: string;
    courseId: string;
}
export declare class CheckQuiz {
    quizId: string;
    chapterId: string;
    answer: string;
}
export declare class GetUpdateLastSeen {
    userId: string;
    chapterId: string;
}
export declare class UpdateLastSeen {
    chapterId: string;
    sectionId: string;
}
export interface ResponseDto {
    message: string;
    statusCode: number;
    data: object | object[];
}
export declare enum SectionType {
    DEFAULT = "DEFAULT",
    MATCH_AND_LEARN = "MATCH_AND_LEARN",
    VISUAL_ACTIVITY = "VISUAL_ACTIVITY"
}
export declare class CreateSectionDto {
    title: string;
    description: string;
    shortDescription?: string;
    type?: SectionType;
    chapterId: string;
    moduleId?: string;
    orderIndex?: number;
}
export declare class MatchAndLearnItemDto {
    id: string;
    name: string;
    correctCategory: string;
}
export declare class CreateMatchAndLearnSectionDto extends CreateSectionDto {
    itemLabel: string;
    categoryLabel: string;
    items: MatchAndLearnItemDto[];
    categories?: string[];
    maxPerCategory?: number;
    isActive?: boolean;
}
export declare class UpdateSectionDto {
    title?: string;
    description?: string;
    shortDescription?: string;
    chapterId?: string;
    moduleId?: string;
    orderIndex?: number;
}
export declare class UpdateMatchAndLearnSectionDto extends UpdateSectionDto {
    itemLabel?: string;
    categoryLabel?: string;
    items?: MatchAndLearnItemDto[];
    categories?: string[];
    maxPerCategory?: number;
    isActive?: boolean;
}
export declare class VisualActivityOptionDto {
    id: string;
    text: string;
    isCorrect: boolean;
}
export declare class CreateVisualActivitySectionDto extends CreateSectionDto {
    questionText: string;
    imageUrl?: string;
    allowMultipleSelection?: boolean;
    options: VisualActivityOptionDto[];
}
export declare class UpdateVisualActivitySectionDto extends UpdateSectionDto {
    questionText?: string;
    imageUrl?: string;
    allowMultipleSelection?: boolean;
    options?: VisualActivityOptionDto[];
}
export declare class SectionOrderItemDto {
    id: string;
    orderIndex: number;
}
export declare class UpdateSectionOrderDto {
    chapterId: string;
    sections: SectionOrderItemDto[];
}
export declare class CreateQuestionCategoryDto {
    courseId: string;
    name: string;
}
export declare class UpdateQuestionCategoryDto {
    name: string;
}
export declare class CreateQuestionDto {
    courseId: string;
    categoryId: string;
    type: QuestionType;
    difficulty: QuestionDifficulty;
    text: string;
    imageUrl?: string;
    content: Record<string, any>;
    maxMarks: number;
}
export declare class UpdateQuestionDto {
    categoryId?: string;
    type?: QuestionType;
    difficulty?: QuestionDifficulty;
    text?: string;
    imageUrl?: string;
    content?: Record<string, any>;
    maxMarks?: number;
    isActive?: boolean;
}
export declare class AutoConfigCategoryDto {
    categoryId: string;
    count: number;
}
export declare class AutoConfigDifficultyDto {
    difficulty: QuestionDifficulty;
    count: number;
}
export declare class AssessmentAutoConfigDto {
    totalQuestions: number;
    byCategory: AutoConfigCategoryDto[];
    byDifficulty: AutoConfigDifficultyDto[];
}
export declare class CreateAssessmentDto {
    courseId: string;
    title: string;
    description?: string;
    mode: AssessmentMode;
    passingPercentage: number;
    timeLimitMinutes?: number;
    maxAttempts?: number;
    autoConfig?: AssessmentAutoConfigDto;
}
export declare class UpdateAssessmentDto {
    title?: string;
    description?: string;
    passingPercentage?: number;
    timeLimitMinutes?: number;
    maxAttempts?: number;
    autoConfig?: AssessmentAutoConfigDto;
}
export declare class AddAssessmentQuestionDto {
    questionId: string;
    orderIndex?: number;
    marksOverride?: number;
}
export declare class ReorderQuestionItemDto {
    questionId: string;
    orderIndex: number;
}
export declare class ReorderAssessmentQuestionsDto {
    questions: ReorderQuestionItemDto[];
}
export declare class StartAttemptDto {
    courseId: string;
}
export declare class SaveAnswerDto {
    snapshotId: string;
    studentAnswer: Record<string, any>;
}
export declare class QuestionScoreDto {
    snapshotId: string;
    adminScore: number;
    adminFeedback?: string;
}
export declare class GradeAttemptDto {
    scores: QuestionScoreDto[];
}
export declare class SetCertificateDto {
    certificateUrl: string;
}
