import { AssignmentService } from './assignment.service';
import { ResponseDto } from '../dto';
import { AssignmentFileType, AssignmentSubmissionStatus, User } from '@prisma/client';
export declare class AssignmentController {
    private readonly assignmentService;
    constructor(assignmentService: AssignmentService);
    submit(user: User, body: {
        assignmentId: string;
        fileUrl: string;
        fileName?: string;
        fileType: AssignmentFileType;
    }): Promise<ResponseDto>;
    mySubmissions(user: User): Promise<ResponseDto>;
    assignedToMe(user: User, status?: AssignmentSubmissionStatus): Promise<ResponseDto>;
    review(user: User, body: {
        submissionId: string;
        status?: AssignmentSubmissionStatus;
        feedback?: string;
        score?: number;
    }): Promise<ResponseDto>;
    createAssignment(user: User, body: {
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
    adminCreatedAssignments(user: User): Promise<ResponseDto>;
    updateAssignment(user: User, body: {
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
    getAvailableAssignments(user: User): Promise<ResponseDto>;
    getAssignment(id: string): Promise<ResponseDto>;
    getAssignmentStatus(user: User, id: string): Promise<ResponseDto>;
    getAssignmentSubmissions(user: User, id: string, status?: AssignmentSubmissionStatus): Promise<ResponseDto>;
}
