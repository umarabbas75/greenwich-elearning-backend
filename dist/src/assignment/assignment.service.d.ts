import { AssignmentSubmissionStatus, AssignmentFileType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ResponseDto } from '../dto';
interface CreateSubmissionInput {
    assignmentId: string;
    fileUrl: string;
    fileName?: string;
    fileType: AssignmentFileType;
}
interface ReviewSubmissionInput {
    submissionId: string;
    status?: AssignmentSubmissionStatus;
    feedback?: string;
    score?: number;
}
export declare class AssignmentService {
    private prisma;
    constructor(prisma: PrismaService);
    createSubmission(studentId: string, input: CreateSubmissionInput): Promise<ResponseDto>;
    getMySubmissions(studentId: string): Promise<ResponseDto>;
    listAssignedToAdmin(adminId: string, status?: AssignmentSubmissionStatus): Promise<ResponseDto>;
    reviewSubmission(reviewerAdminId: string, body: ReviewSubmissionInput): Promise<ResponseDto>;
    createAssignment(adminId: string, body: {
        title: string;
        description?: string;
        instructions?: string;
        courseId: string;
        assignedToAdminId: string;
        dueAt?: string;
        maxPoints?: number;
        allowResubmissions?: boolean;
        maxAttempts?: number;
        assignmentFileUrl?: string;
        assignmentFileName?: string;
        assignmentFileType?: AssignmentFileType;
    }): Promise<ResponseDto>;
    getAdminCreatedAssignments(adminId: string): Promise<ResponseDto>;
    updateAssignment(adminId: string, body: {
        assignmentId: string;
        title?: string;
        description?: string;
        instructions?: string;
        dueAt?: string;
        maxPoints?: number;
        allowResubmissions?: boolean;
        maxAttempts?: number;
        assignmentFileUrl?: string;
        assignmentFileName?: string;
        assignmentFileType?: AssignmentFileType;
        isActive?: boolean;
    }): Promise<ResponseDto>;
    getAvailableAssignments(studentId: string): Promise<ResponseDto>;
    getAssignmentById(assignmentId: string): Promise<ResponseDto>;
    getAssignmentStatusForStudent(studentId: string, assignmentId: string): Promise<ResponseDto>;
    getAssignmentSubmissions(assignmentId: string, adminId: string, status?: AssignmentSubmissionStatus): Promise<ResponseDto>;
    submitCourseFeedback(studentId: string, courseId: string, formData: any): Promise<ResponseDto>;
    getCourseFeedbackStatus(studentId: string, courseId: string): Promise<ResponseDto>;
    getCourseFeedbackSubmissions(courseId: string, adminId: string): Promise<ResponseDto>;
}
export {};
