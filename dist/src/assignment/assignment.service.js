"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssignmentService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
let AssignmentService = class AssignmentService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createSubmission(studentId, input) {
        try {
            const assignment = await this.prisma.assignment.findUnique({
                where: { id: input.assignmentId },
                include: { course: true },
            });
            if (!assignment) {
                throw new Error('Assignment not found');
            }
            if (!assignment.isActive) {
                throw new Error('Assignment is not active');
            }
            const enrollment = await this.prisma.userCourse.findFirst({
                where: {
                    userId: studentId,
                    courseId: assignment.courseId,
                    isActive: true,
                },
            });
            if (!enrollment) {
                throw new Error('You are not enrolled in this course');
            }
            const existingSubmission = await this.prisma.assignmentSubmission.findFirst({
                where: {
                    assignmentId: input.assignmentId,
                    studentId: studentId,
                },
            });
            if (existingSubmission) {
                throw new Error('You have already submitted to this assignment');
            }
            const created = await this.prisma.assignmentSubmission.create({
                data: {
                    assignmentId: input.assignmentId,
                    studentId,
                    assignedToAdminId: assignment.assignedToAdminId,
                    fileUrl: input.fileUrl,
                    fileName: input.fileName || null,
                    fileType: input.fileType,
                    status: client_1.AssignmentSubmissionStatus.submitted,
                },
            });
            return {
                message: 'Assignment submitted successfully',
                statusCode: 200,
                data: created,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to create submission',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async getMySubmissions(studentId) {
        try {
            const submissions = await this.prisma.assignmentSubmission.findMany({
                where: { studentId },
                orderBy: { createdAt: 'desc' },
            });
            return {
                message: 'Fetched submissions',
                statusCode: 200,
                data: submissions,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to fetch submissions',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async listAssignedToAdmin(adminId, status) {
        try {
            const where = {
                assignedToAdminId: adminId,
            };
            if (status)
                where.status = status;
            const submissions = await this.prisma.assignmentSubmission.findMany({
                where,
                orderBy: { createdAt: 'desc' },
            });
            return {
                message: 'Fetched assigned submissions',
                statusCode: 200,
                data: submissions,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to fetch assigned submissions',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async reviewSubmission(reviewerAdminId, body) {
        try {
            const submission = await this.prisma.assignmentSubmission.findUnique({
                where: { id: body.submissionId },
            });
            if (!submission)
                throw new Error('Submission not found');
            const updated = await this.prisma.assignmentSubmission.update({
                where: { id: body.submissionId },
                data: {
                    reviewedByAdminId: reviewerAdminId,
                    status: body.status ?? client_1.AssignmentSubmissionStatus.in_review,
                    feedback: body.feedback ?? submission.feedback,
                    score: typeof body.score === 'number' ? body.score : submission.score,
                    gradedAt: body.status && ['approved', 'rejected'].includes(body.status)
                        ? new Date()
                        : submission.gradedAt,
                },
            });
            return { message: 'Submission updated', statusCode: 200, data: updated };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to update submission',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async createAssignment(adminId, body) {
        try {
            const admin = await this.prisma.user.findUnique({
                where: { id: adminId },
            });
            if (!admin || admin.role !== 'admin') {
                throw new Error('Only admins can create assignments');
            }
            const course = await this.prisma.course.findUnique({
                where: { id: body.courseId },
            });
            if (!course) {
                throw new Error('Course not found');
            }
            const assignment = await this.prisma.assignment.create({
                data: {
                    title: body.title,
                    description: body.description,
                    instructions: body.instructions,
                    courseId: body.courseId,
                    assignedToAdminId: body.assignedToAdminId,
                    dueAt: body.dueAt ? new Date(body.dueAt) : null,
                    maxPoints: body.maxPoints,
                    allowResubmissions: body.allowResubmissions ?? true,
                    maxAttempts: body.maxAttempts,
                    createdByAdminId: adminId,
                    assignmentFileUrl: body.assignmentFileUrl,
                    assignmentFileName: body.assignmentFileName,
                    assignmentFileType: body.assignmentFileType,
                    isActive: true,
                },
            });
            return {
                message: 'Assignment created successfully',
                statusCode: 200,
                data: assignment,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to create assignment',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async getAdminCreatedAssignments(adminId) {
        try {
            const assignments = await this.prisma.assignment.findMany({
                where: { createdByAdminId: adminId },
                orderBy: { createdAt: 'desc' },
                include: {
                    course: { select: { title: true } },
                },
            });
            return {
                message: 'Fetched admin assignments',
                statusCode: 200,
                data: assignments,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to fetch assignments',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async updateAssignment(adminId, body) {
        try {
            const assignment = await this.prisma.assignment.findUnique({
                where: { id: body.assignmentId },
            });
            if (!assignment) {
                throw new Error('Assignment not found');
            }
            if (assignment.createdByAdminId !== adminId) {
                throw new Error('You can only update your own assignments');
            }
            const updated = await this.prisma.assignment.update({
                where: { id: body.assignmentId },
                data: {
                    title: body.title,
                    description: body.description,
                    instructions: body.instructions,
                    dueAt: body.dueAt ? new Date(body.dueAt) : body.dueAt,
                    maxPoints: body.maxPoints,
                    allowResubmissions: body.allowResubmissions,
                    maxAttempts: body.maxAttempts,
                    assignmentFileUrl: body.assignmentFileUrl,
                    assignmentFileName: body.assignmentFileName,
                    assignmentFileType: body.assignmentFileType,
                    isActive: body.isActive,
                },
            });
            return {
                message: 'Assignment updated successfully',
                statusCode: 200,
                data: updated,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to update assignment',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async getAvailableAssignments(studentId) {
        try {
            const enrolledCourses = await this.prisma.userCourse.findMany({
                where: { userId: studentId, isActive: true },
                select: { courseId: true },
            });
            const courseIds = enrolledCourses.map((ec) => ec.courseId);
            if (courseIds.length === 0) {
                return {
                    message: 'No enrolled courses found',
                    statusCode: 200,
                    data: [],
                };
            }
            const assignments = await this.prisma.assignment.findMany({
                where: {
                    courseId: { in: courseIds },
                    isActive: true,
                },
                orderBy: { createdAt: 'desc' },
                include: {
                    course: { select: { title: true } },
                },
            });
            return {
                message: 'Fetched available assignments',
                statusCode: 200,
                data: assignments,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to fetch assignments',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async getAssignmentById(assignmentId) {
        try {
            const assignment = await this.prisma.assignment.findUnique({
                where: { id: assignmentId },
                include: {
                    course: { select: { title: true } },
                },
            });
            if (!assignment) {
                throw new Error('Assignment not found');
            }
            return {
                message: 'Assignment fetched successfully',
                statusCode: 200,
                data: assignment,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to fetch assignment',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async getAssignmentStatusForStudent(studentId, assignmentId) {
        try {
            const submission = await this.prisma.assignmentSubmission.findFirst({
                where: {
                    studentId,
                    assignmentId,
                },
                orderBy: { createdAt: 'desc' },
            });
            const assignment = await this.prisma.assignment.findUnique({
                where: { id: assignmentId },
                include: {
                    course: { select: { title: true } },
                },
            });
            if (!assignment) {
                throw new Error('Assignment not found');
            }
            const status = {
                assignment,
                submission: submission || null,
                isSubmitted: !!submission,
                status: submission?.status || null,
                isOverdue: assignment.dueAt ? new Date() > assignment.dueAt : false,
            };
            return {
                message: 'Assignment status fetched successfully',
                statusCode: 200,
                data: status,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to fetch assignment status',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async getAssignmentSubmissions(assignmentId, adminId, status) {
        try {
            const assignment = await this.prisma.assignment.findUnique({
                where: { id: assignmentId },
                include: {
                    course: { select: { title: true } },
                },
            });
            if (!assignment) {
                throw new Error('Assignment not found');
            }
            if (assignment.createdByAdminId !== adminId &&
                assignment.assignedToAdminId !== adminId) {
                throw new Error('You do not have access to view submissions for this assignment');
            }
            const where = {
                assignmentId: assignmentId,
            };
            if (status) {
                where.status = status;
            }
            const submissions = await this.prisma.assignmentSubmission.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                include: {
                    student: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                },
            });
            const totalSubmissions = submissions.length;
            const submittedCount = submissions.filter((s) => s.status === client_1.AssignmentSubmissionStatus.submitted).length;
            const inReviewCount = submissions.filter((s) => s.status === client_1.AssignmentSubmissionStatus.in_review).length;
            const approvedCount = submissions.filter((s) => s.status === client_1.AssignmentSubmissionStatus.approved).length;
            const rejectedCount = submissions.filter((s) => s.status === client_1.AssignmentSubmissionStatus.rejected).length;
            const returnedCount = submissions.filter((s) => s.status === client_1.AssignmentSubmissionStatus.returned).length;
            const stats = {
                total: totalSubmissions,
                submitted: submittedCount,
                inReview: inReviewCount,
                approved: approvedCount,
                rejected: rejectedCount,
                returned: returnedCount,
            };
            return {
                message: 'Assignment submissions fetched successfully',
                statusCode: 200,
                data: {
                    assignment,
                    submissions,
                    statistics: stats,
                },
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to fetch assignment submissions',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async submitCourseFeedback(studentId, courseId, formData) {
        try {
            const course = await this.prisma.course.findUnique({
                where: { id: courseId },
            });
            if (!course) {
                throw new Error('Course not found');
            }
            const feedbackForm = await this.prisma.courseFeedbackForm.findFirst({
                where: {
                    courseId: courseId,
                },
            });
            if (!feedbackForm) {
                throw new Error('No feedback form found for this course');
            }
            const enrollment = await this.prisma.userCourse.findFirst({
                where: {
                    userId: studentId,
                    courseId: courseId,
                    isActive: true,
                },
            });
            if (!enrollment) {
                throw new Error('You are not enrolled in this course');
            }
            const existingCompletion = await this.prisma.courseFeedbackSubmission.findFirst({
                where: {
                    userId: studentId,
                    courseId: courseId,
                },
            });
            if (existingCompletion) {
                throw new Error('You have already completed the feedback form for this course');
            }
            const completion = await this.prisma.courseFeedbackSubmission.create({
                data: {
                    userId: studentId,
                    courseId: courseId,
                    feedbackFormId: feedbackForm.id,
                    responses: formData,
                },
            });
            return {
                message: 'Course feedback submitted successfully',
                statusCode: 200,
                data: completion,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to submit feedback',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async getCourseFeedbackStatus(studentId, courseId) {
        try {
            const feedbackForm = await this.prisma.courseFeedbackForm.findFirst({
                where: {
                    courseId: courseId,
                },
            });
            if (!feedbackForm) {
                return {
                    message: 'No feedback form found for this course',
                    statusCode: 200,
                    data: {
                        hasFeedbackForm: false,
                        isCompleted: false,
                        feedbackForm: null,
                    },
                };
            }
            const completion = await this.prisma.courseFeedbackSubmission.findFirst({
                where: {
                    userId: studentId,
                    courseId: courseId,
                },
            });
            return {
                message: 'Course feedback status fetched successfully',
                statusCode: 200,
                data: {
                    hasFeedbackForm: true,
                    isCompleted: !!completion,
                    feedbackForm: {
                        formName: feedbackForm.formName,
                        isRequired: feedbackForm.isRequired,
                        submittedAt: completion?.submittedAt || null,
                    },
                },
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to fetch feedback status',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async getCourseFeedbackSubmissions(courseId, adminId) {
        try {
            const admin = await this.prisma.user.findUnique({
                where: { id: adminId },
            });
            if (!admin || admin.role !== 'admin') {
                throw new Error('Only admins can view feedback submissions');
            }
            const completions = await this.prisma.courseFeedbackSubmission.findMany({
                where: {
                    courseId: courseId,
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                },
                orderBy: { submittedAt: 'desc' },
            });
            return {
                message: 'Course feedback submissions fetched successfully',
                statusCode: 200,
                data: {
                    courseId,
                    submissions: completions.map((completion) => ({
                        user: completion.user,
                        submittedAt: completion.submittedAt,
                        responses: completion.responses,
                    })),
                    totalSubmissions: completions.length,
                },
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to fetch feedback submissions',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
};
exports.AssignmentService = AssignmentService;
exports.AssignmentService = AssignmentService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AssignmentService);
//# sourceMappingURL=assignment.service.js.map