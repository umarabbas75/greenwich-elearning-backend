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
var AssignmentService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssignmentService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const notification_service_1 = require("../notifications/notification.service");
const mail_layout_1 = require("../mail/templates/mail-layout");
const MAX_FILES = 5;
const assignmentAttachmentsInclude = {
    attachments: { orderBy: { sortOrder: 'asc' } },
};
const submissionAttachmentsInclude = {
    attachments: { orderBy: { sortOrder: 'asc' } },
};
function resolveFiles(filesArray, legacy) {
    if (filesArray !== undefined) {
        return filesArray;
    }
    if (legacy.fileUrl && legacy.fileType) {
        return [
            {
                fileUrl: legacy.fileUrl,
                fileName: legacy.fileName,
                fileType: legacy.fileType,
            },
        ];
    }
    if (legacy.fileUrl || legacy.fileName || legacy.fileType) {
        throw new Error('fileUrl and fileType are required when uploading a file');
    }
    return undefined;
}
function validateFiles(files, options = {}) {
    const { min = 0, max = MAX_FILES, label = 'file' } = options;
    if (files.length < min) {
        throw new Error(`At least ${min} ${label} is required`);
    }
    if (files.length > max) {
        throw new Error(`A maximum of ${max} ${label}s is allowed`);
    }
    for (const file of files) {
        if (!file.fileUrl?.trim()) {
            throw new Error(`Each ${label} requires a fileUrl`);
        }
        if (!file.fileType) {
            throw new Error(`Each ${label} requires a fileType`);
        }
    }
}
function resolveAssignmentFiles(body) {
    return resolveFiles(body.assignmentFiles, {
        fileUrl: body.assignmentFileUrl,
        fileName: body.assignmentFileName,
        fileType: body.assignmentFileType,
    });
}
function resolveAssignmentFilesForUpdate(body) {
    if (body.assignmentFiles !== undefined) {
        return { shouldUpdate: true, files: body.assignmentFiles };
    }
    const hasLegacyField = body.assignmentFileUrl !== undefined ||
        body.assignmentFileName !== undefined ||
        body.assignmentFileType !== undefined;
    if (!hasLegacyField) {
        return { shouldUpdate: false };
    }
    const files = resolveFiles(undefined, {
        fileUrl: body.assignmentFileUrl,
        fileName: body.assignmentFileName,
        fileType: body.assignmentFileType,
    });
    return { shouldUpdate: true, files };
}
function validateAssignmentFiles(files) {
    validateFiles(files, { label: 'assignment file' });
}
function legacyAssignmentFieldsFromFiles(files) {
    const first = files[0];
    if (!first) {
        return {
            assignmentFileUrl: null,
            assignmentFileName: null,
            assignmentFileType: null,
        };
    }
    return {
        assignmentFileUrl: first.fileUrl,
        assignmentFileName: first.fileName ?? null,
        assignmentFileType: first.fileType,
    };
}
function legacySubmissionFieldsFromFiles(files) {
    const first = files[0];
    return {
        fileUrl: first.fileUrl,
        fileName: first.fileName ?? null,
        fileType: first.fileType,
    };
}
function formatAssignment(assignment) {
    const { attachments = [], ...rest } = assignment;
    return {
        ...rest,
        assignmentFiles: attachments.map(({ fileUrl, fileName, fileType }) => ({
            fileUrl,
            fileName,
            fileType,
        })),
    };
}
function formatAssignments(assignments) {
    return assignments.map(formatAssignment);
}
function formatSubmission(submission) {
    const { attachments = [], ...rest } = submission;
    const mappedAttachments = attachments.map(({ fileUrl, fileName, fileType }) => ({
        fileUrl,
        fileName,
        fileType,
    }));
    return {
        ...rest,
        submissionAttachments: mappedAttachments,
    };
}
function formatSubmissions(submissions) {
    return submissions.map(formatSubmission);
}
function submissionSummaryFromSubmission(submission) {
    if (!submission) {
        return {
            submissionStatus: null,
            lastSubmissionDate: null,
            attemptsUsed: 0,
            bestScore: null,
        };
    }
    return {
        submissionStatus: submission.status,
        lastSubmissionDate: submission.submittedAt,
        attemptsUsed: 1,
        bestScore: submission.score,
    };
}
function formatAvailableAssignments(assignments, submissionsByAssignmentId) {
    return assignments.map((assignment) => ({
        ...formatAssignment(assignment),
        ...submissionSummaryFromSubmission(submissionsByAssignmentId.get(assignment.id)),
    }));
}
function resolveSubmissionFiles(input) {
    return resolveFiles(input.submissionAttachments ?? input.submissionFiles, {
        fileUrl: input.fileUrl,
        fileName: input.fileName,
        fileType: input.fileType,
    });
}
let AssignmentService = AssignmentService_1 = class AssignmentService {
    constructor(prisma, notificationService) {
        this.prisma = prisma;
        this.notificationService = notificationService;
    }
    async safeNotify(label, runner) {
        try {
            await runner();
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            AssignmentService_1.logger.warn(`Assignment notification "${label}" failed (best-effort): ${message}`);
        }
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
            const files = resolveSubmissionFiles(input);
            if (!files?.length) {
                throw new Error('At least one submission file is required');
            }
            validateFiles(files, { min: 1, label: 'submission file' });
            const created = await this.prisma.assignmentSubmission.create({
                data: {
                    assignmentId: input.assignmentId,
                    studentId,
                    assignedToAdminId: assignment.assignedToAdminId,
                    ...legacySubmissionFieldsFromFiles(files),
                    status: client_1.AssignmentSubmissionStatus.submitted,
                    attachments: {
                        create: files.map((file, index) => ({
                            fileUrl: file.fileUrl,
                            fileName: file.fileName ?? null,
                            fileType: file.fileType,
                            sortOrder: index,
                        })),
                    },
                },
                include: submissionAttachmentsInclude,
            });
            await this.notifyAssignmentSubmitted({
                submissionId: created.id,
                assignmentId: assignment.id,
                assignmentTitle: assignment.title,
                assignedToAdminId: assignment.assignedToAdminId,
                studentId,
            });
            return {
                message: 'Assignment submitted successfully',
                statusCode: 200,
                data: formatSubmission(created),
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
                include: submissionAttachmentsInclude,
            });
            return {
                message: 'Fetched submissions',
                statusCode: 200,
                data: formatSubmissions(submissions),
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
                include: submissionAttachmentsInclude,
            });
            return {
                message: 'Fetched assigned submissions',
                statusCode: 200,
                data: formatSubmissions(submissions),
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
                include: submissionAttachmentsInclude,
            });
            await this.notifyAssignmentGraded({
                submissionId: updated.id,
                studentId: updated.studentId,
                assignmentId: updated.assignmentId,
                reviewerAdminId,
                submissionStatus: updated.status,
                score: updated.score,
                feedback: updated.feedback,
            });
            return {
                message: 'Submission updated',
                statusCode: 200,
                data: formatSubmission(updated),
            };
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
            const files = resolveAssignmentFiles(body);
            if (files) {
                validateAssignmentFiles(files);
            }
            const legacyFields = legacyAssignmentFieldsFromFiles(files ?? []);
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
                    ...legacyFields,
                    isActive: true,
                    ...(files?.length
                        ? {
                            attachments: {
                                create: files.map((file, index) => ({
                                    fileUrl: file.fileUrl,
                                    fileName: file.fileName ?? null,
                                    fileType: file.fileType,
                                    sortOrder: index,
                                })),
                            },
                        }
                        : {}),
                },
                include: assignmentAttachmentsInclude,
            });
            await this.notifyAssignmentCreated({
                assignmentId: assignment.id,
                assignmentTitle: assignment.title,
                courseId: assignment.courseId,
                courseTitle: course.title,
                dueAt: assignment.dueAt,
                creatorAdminId: adminId,
            });
            return {
                message: 'Assignment created successfully',
                statusCode: 200,
                data: formatAssignment(assignment),
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
                    ...assignmentAttachmentsInclude,
                    _count: { select: { submissions: true } },
                },
            });
            const assignmentIds = assignments.map((assignment) => assignment.id);
            const statusBreakdown = assignmentIds.length
                ? await this.prisma.assignmentSubmission.groupBy({
                    by: ['assignmentId', 'status'],
                    where: { assignmentId: { in: assignmentIds } },
                    _count: { _all: true },
                })
                : [];
            const breakdownByAssignmentId = new Map();
            for (const row of statusBreakdown) {
                const existing = breakdownByAssignmentId.get(row.assignmentId) ??
                    {
                        submitted: 0,
                        in_review: 0,
                        approved: 0,
                        rejected: 0,
                        returned: 0,
                    };
                existing[row.status] = row._count._all;
                breakdownByAssignmentId.set(row.assignmentId, existing);
            }
            const data = assignments.map((assignment) => {
                const { _count, ...rest } = assignment;
                const breakdown = breakdownByAssignmentId.get(assignment.id) ?? {
                    submitted: 0,
                    in_review: 0,
                    approved: 0,
                    rejected: 0,
                    returned: 0,
                };
                return {
                    ...formatAssignment(rest),
                    submissionCount: _count.submissions,
                    submissionStats: {
                        total: _count.submissions,
                        submitted: breakdown.submitted,
                        inReview: breakdown.in_review,
                        approved: breakdown.approved,
                        rejected: breakdown.rejected,
                        returned: breakdown.returned,
                    },
                };
            });
            return {
                message: 'Fetched admin assignments',
                statusCode: 200,
                data,
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
            const fileUpdate = resolveAssignmentFilesForUpdate(body);
            if (fileUpdate.shouldUpdate) {
                validateAssignmentFiles(fileUpdate.files ?? []);
            }
            const updated = await this.prisma.$transaction(async (tx) => {
                if (fileUpdate.shouldUpdate) {
                    await tx.assignmentAttachment.deleteMany({
                        where: { assignmentId: body.assignmentId },
                    });
                }
                const legacyFields = fileUpdate.shouldUpdate
                    ? legacyAssignmentFieldsFromFiles(fileUpdate.files ?? [])
                    : {};
                return tx.assignment.update({
                    where: { id: body.assignmentId },
                    data: {
                        title: body.title,
                        description: body.description,
                        instructions: body.instructions,
                        dueAt: body.dueAt ? new Date(body.dueAt) : body.dueAt,
                        maxPoints: body.maxPoints,
                        allowResubmissions: body.allowResubmissions,
                        maxAttempts: body.maxAttempts,
                        isActive: body.isActive,
                        ...legacyFields,
                        ...(fileUpdate.shouldUpdate && fileUpdate.files?.length
                            ? {
                                attachments: {
                                    create: fileUpdate.files.map((file, index) => ({
                                        fileUrl: file.fileUrl,
                                        fileName: file.fileName ?? null,
                                        fileType: file.fileType,
                                        sortOrder: index,
                                    })),
                                },
                            }
                            : {}),
                    },
                    include: assignmentAttachmentsInclude,
                });
            });
            return {
                message: 'Assignment updated successfully',
                statusCode: 200,
                data: formatAssignment(updated),
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
                    ...assignmentAttachmentsInclude,
                },
            });
            const submissions = await this.prisma.assignmentSubmission.findMany({
                where: {
                    studentId,
                    assignmentId: { in: assignments.map((assignment) => assignment.id) },
                },
                select: {
                    assignmentId: true,
                    status: true,
                    submittedAt: true,
                    score: true,
                },
            });
            const submissionsByAssignmentId = new Map(submissions.map((submission) => [submission.assignmentId, submission]));
            return {
                message: 'Fetched available assignments',
                statusCode: 200,
                data: formatAvailableAssignments(assignments, submissionsByAssignmentId),
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
                    ...assignmentAttachmentsInclude,
                },
            });
            if (!assignment) {
                throw new Error('Assignment not found');
            }
            return {
                message: 'Assignment fetched successfully',
                statusCode: 200,
                data: formatAssignment(assignment),
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
                include: submissionAttachmentsInclude,
            });
            const assignment = await this.prisma.assignment.findUnique({
                where: { id: assignmentId },
                include: {
                    course: { select: { title: true } },
                    ...assignmentAttachmentsInclude,
                },
            });
            if (!assignment) {
                throw new Error('Assignment not found');
            }
            const status = {
                assignment: formatAssignment(assignment),
                submission: submission ? formatSubmission(submission) : null,
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
                    ...assignmentAttachmentsInclude,
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
                    ...submissionAttachmentsInclude,
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
                    assignment: formatAssignment(assignment),
                    submissions: formatSubmissions(submissions),
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
    async notifyAssignmentCreated(args) {
        await this.safeNotify('assignment-created', async () => {
            const enrolled = await this.prisma.userCourse.findMany({
                where: { courseId: args.courseId, isActive: true },
                select: { userId: true },
            });
            const userIds = enrolled
                .map((row) => row.userId)
                .filter((id) => id && id !== args.creatorAdminId);
            if (userIds.length === 0)
                return;
            const dueAtIso = args.dueAt ? args.dueAt.toISOString() : null;
            await this.notificationService.createNotificationForMany({
                userIds,
                emailCcAddresses: [mail_layout_1.ADMIN_EMAIL],
                type: client_1.NotificationType.ASSIGNMENT_CREATED,
                message: `A new assignment "${args.assignmentTitle}" has been added to ${args.courseTitle}.`,
                payload: {
                    assignmentId: args.assignmentId,
                    assignmentTitle: args.assignmentTitle,
                    courseId: args.courseId,
                    courseTitle: args.courseTitle,
                    dueAt: dueAtIso,
                },
                groupKey: `assignment-created:${args.assignmentId}`,
                referenceId: args.assignmentId,
                commenterId: args.creatorAdminId,
                dedupeKeyFor: (userId) => `assignment-created:${args.assignmentId}:${userId}`,
                email: {
                    excludeUserId: args.creatorAdminId,
                    build: (recipient) => ({
                        kind: 'ASSIGNMENT_CREATED',
                        to: recipient.email,
                        userId: recipient.id,
                        recipientFirstName: recipient.firstName,
                        assignmentId: args.assignmentId,
                        assignmentTitle: args.assignmentTitle,
                        courseTitle: args.courseTitle,
                        dueAt: dueAtIso,
                    }),
                },
            });
        });
    }
    async notifyAssignmentSubmitted(args) {
        await this.safeNotify('assignment-submitted', async () => {
            const student = await this.prisma.user.findUnique({
                where: { id: args.studentId },
                select: { firstName: true, lastName: true },
            });
            const studentName = student
                ? `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() ||
                    'A student'
                : 'A student';
            await this.notificationService.createNotification({
                userId: args.assignedToAdminId,
                emailCcAddresses: [mail_layout_1.ADMIN_EMAIL],
                type: client_1.NotificationType.ASSIGNMENT_SUBMITTED,
                message: `A student has submitted to the assignment: ${args.assignmentTitle}`,
                payload: {
                    assignmentId: args.assignmentId,
                    assignmentTitle: args.assignmentTitle,
                    submissionId: args.submissionId,
                    studentId: args.studentId,
                    studentName,
                },
                groupKey: `assignment-submitted:${args.assignmentId}`,
                dedupeKey: `assignment-submitted:${args.submissionId}`,
                referenceId: args.submissionId,
                commenterId: args.studentId,
                email: {
                    excludeUserId: args.studentId,
                    build: (recipient) => ({
                        kind: 'ASSIGNMENT_SUBMITTED',
                        to: recipient.email,
                        userId: recipient.id,
                        recipientFirstName: recipient.firstName,
                        studentName,
                        assignmentId: args.assignmentId,
                        assignmentTitle: args.assignmentTitle,
                    }),
                },
            });
        });
    }
    async notifyAssignmentGraded(args) {
        await this.safeNotify('assignment-graded', async () => {
            const assignment = await this.prisma.assignment.findUnique({
                where: { id: args.assignmentId },
                select: { title: true, maxPoints: true },
            });
            if (!assignment)
                return;
            const dedupeKey = `assignment-graded:${args.submissionId}:${args.submissionStatus}:${args.score ?? 'no-score'}:${args.feedback ? args.feedback.length : 0}`;
            await this.notificationService.createNotification({
                userId: args.studentId,
                emailCcAddresses: [mail_layout_1.ADMIN_EMAIL],
                type: client_1.NotificationType.ASSIGNMENT_GRADED,
                message: `Your submission for "${assignment.title}" has been updated to ${args.submissionStatus}.`,
                payload: {
                    assignmentId: args.assignmentId,
                    assignmentTitle: assignment.title,
                    submissionId: args.submissionId,
                    submissionStatus: args.submissionStatus,
                    score: args.score,
                    maxPoints: assignment.maxPoints,
                    feedback: args.feedback,
                },
                dedupeKey,
                referenceId: args.submissionId,
                commenterId: args.reviewerAdminId,
                email: {
                    excludeUserId: args.reviewerAdminId,
                    build: (recipient) => ({
                        kind: 'ASSIGNMENT_GRADED',
                        to: recipient.email,
                        userId: recipient.id,
                        recipientFirstName: recipient.firstName,
                        assignmentId: args.assignmentId,
                        assignmentTitle: assignment.title,
                        submissionStatus: args.submissionStatus,
                        score: args.score,
                        maxPoints: assignment.maxPoints,
                        feedback: args.feedback,
                    }),
                },
            });
        });
    }
};
exports.AssignmentService = AssignmentService;
AssignmentService.logger = new common_1.Logger(AssignmentService_1.name);
exports.AssignmentService = AssignmentService = AssignmentService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        notification_service_1.NotificationService])
], AssignmentService);
//# sourceMappingURL=assignment.service.js.map