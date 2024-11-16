import { Role } from '@prisma/client';
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
    duration: string;
    description: string;
    assessment: string;
    image: string;
    overview: string;
    syllabusOverview: string;
    resourcesOverview: string;
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
    description?: string;
    assessment?: string;
    image?: string;
    overview?: string;
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
