import { AssignmentService } from './assignment.service';
import { FeedbackService } from '../feedback/feedback.service';
import { ResponseDto } from '../dto';
import { AssignmentFileType, AssignmentSubmissionStatus, User } from '@prisma/client';
export declare class AssignmentController {
    private readonly assignmentService;
    private readonly feedbackService;
    constructor(assignmentService: AssignmentService, feedbackService: FeedbackService);
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
    getPendingFeedback(user: User): Promise<ResponseDto>;
    getFeedbackAggregate(user: User, courseId?: string): Promise<ResponseDto>;
    listFeedbackSubmissions(user: User, courseId?: string, from?: string, to?: string, search?: string, page?: string, limit?: string): Promise<ResponseDto>;
    getFeedbackSubmissionDetail(user: User, submissionId: string): Promise<ResponseDto>;
    submitCourseFeedback(user: User, courseId: string, body: {
        formVersion?: string;
        formData: unknown;
    }): Promise<ResponseDto>;
    getCourseFeedbackStatus(user: User, courseId: string): Promise<ResponseDto>;
    getCourseFeedbackSubmissions(user: User, courseId: string): Promise<ResponseDto>;
    getAvailableAssignments(user: User): Promise<ResponseDto>;
    getAssignment(id: string): Promise<ResponseDto>;
    getAssignmentStatus(user: User, id: string): Promise<ResponseDto>;
    getAssignmentSubmissions(user: User, id: string, status?: AssignmentSubmissionStatus): Promise<ResponseDto>;
}
