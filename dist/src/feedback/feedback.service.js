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
var FeedbackService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeedbackService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const mail_service_1 = require("../mail/mail.service");
const notification_service_1 = require("../notifications/notification.service");
const mail_layout_1 = require("../mail/templates/mail-layout");
const feedback_constants_1 = require("./feedback.constants");
let FeedbackService = FeedbackService_1 = class FeedbackService {
    constructor(prisma, mail, notifications) {
        this.prisma = prisma;
        this.mail = mail;
        this.notifications = notifications;
    }
    async submitCourseFeedback(studentId, courseId, input) {
        try {
            const course = await this.prisma.course.findUnique({
                where: { id: courseId },
            });
            if (!course) {
                throw new Error('Course not found');
            }
            const feedbackForm = await this.prisma.courseFeedbackForm.findFirst({
                where: { courseId, isActive: true },
            });
            if (!feedbackForm) {
                throw new Error('No feedback form found for this course');
            }
            const enrollment = await this.prisma.userCourse.findFirst({
                where: { userId: studentId, courseId, isActive: true },
            });
            if (!enrollment) {
                throw new Error('You are not enrolled in this course');
            }
            const existing = await this.prisma.courseFeedbackSubmission.findFirst({
                where: { userId: studentId, courseId },
            });
            if (existing) {
                throw new common_1.ConflictException({ message: 'Feedback already submitted.' });
            }
            let formData;
            try {
                formData = (0, feedback_constants_1.validateFeedbackFormData)(input.formData);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : 'Invalid formData';
                throw new common_1.BadRequestException(message);
            }
            const meanRating = (0, feedback_constants_1.computeMeanLikertRating)(formData);
            const overallRating = formData.overallRating;
            const student = await this.prisma.user.findUnique({
                where: { id: studentId },
                select: { id: true, email: true, firstName: true, lastName: true },
            });
            const learnerEmail = typeof formData.email === 'string' && formData.email.trim()
                ? formData.email.trim()
                : student?.email ?? null;
            const completion = await this.prisma.courseFeedbackSubmission.create({
                data: {
                    userId: studentId,
                    courseId,
                    feedbackFormId: feedbackForm.id,
                    formVersion: input.formVersion ?? feedback_constants_1.FEEDBACK_FORM_VERSION,
                    responses: formData,
                    meanRating,
                    overallRating,
                    learnerEmail,
                },
            });
            await this.markFeedbackNotificationsRead(studentId, courseId);
            try {
                const studentName = `${student?.firstName ?? ''} ${student?.lastName ?? ''}`.trim();
                if (student?.email) {
                    await this.mail.sendFeedbackReceived({
                        to: student.email,
                        userId: studentId,
                        firstName: student.firstName ?? '',
                        courseTitle: course.title,
                    });
                }
                await this.mail.sendFeedbackReceivedAdmin({
                    to: mail_layout_1.ADMIN_EMAIL,
                    studentName: studentName || 'A student',
                    studentEmail: learnerEmail ?? student?.email ?? 'unknown',
                    courseTitle: course.title,
                });
            }
            catch (mailErr) {
                const m = mailErr instanceof Error ? mailErr.message : String(mailErr);
                FeedbackService_1.logger.warn(`Feedback emails failed for user ${studentId}, course ${courseId}: ${m}`);
            }
            return {
                message: 'Course feedback submitted successfully',
                statusCode: 200,
                data: this.toSubmissionDetail(completion, course.title, student),
            };
        }
        catch (error) {
            if (error instanceof common_1.ConflictException ||
                error instanceof common_1.BadRequestException) {
                throw error;
            }
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to submit feedback',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async getCourseFeedbackStatus(studentId, courseId) {
        try {
            const feedbackForm = await this.prisma.courseFeedbackForm.findFirst({
                where: { courseId, isActive: true },
            });
            const completion = await this.prisma.courseFeedbackSubmission.findFirst({
                where: { userId: studentId, courseId },
            });
            return {
                message: 'Course feedback status fetched successfully',
                statusCode: 200,
                data: {
                    isCompleted: !!completion,
                    isRequired: feedbackForm?.isRequired ?? false,
                    submittedAt: completion?.submittedAt?.toISOString() ?? undefined,
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
    async getPendingFeedbackForUser(userId) {
        try {
            const [completions, submissions] = await Promise.all([
                this.prisma.courseCompletion.findMany({
                    where: {
                        userId,
                        courseCompletedAt: { not: null },
                        course: {
                            feedbackForm: { isRequired: true, isActive: true },
                        },
                    },
                    include: {
                        course: {
                            select: { id: true, title: true, tutorInfo: true },
                        },
                    },
                    orderBy: { courseCompletedAt: 'desc' },
                }),
                this.prisma.courseFeedbackSubmission.findMany({
                    where: { userId },
                    select: { courseId: true },
                }),
            ]);
            const submittedIds = new Set(submissions.map((s) => s.courseId));
            const now = Date.now();
            const msPerDay = 86400000;
            const data = completions
                .filter((c) => !submittedIds.has(c.courseId))
                .map((c) => {
                const completedAt = c.courseCompletedAt;
                const daysSinceCompletion = Math.floor((now - completedAt.getTime()) / msPerDay);
                const daysOverdue = Math.max(0, daysSinceCompletion - feedback_constants_1.FEEDBACK_REMINDER_AFTER_DAYS);
                return {
                    courseId: c.courseId,
                    courseTitle: c.course.title,
                    completedAt: completedAt.toISOString(),
                    daysOverdue,
                    trainerName: this.extractTrainerName(c.course.tutorInfo),
                };
            });
            return {
                message: 'Pending feedback fetched successfully',
                statusCode: 200,
                data,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to fetch pending feedback',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async listAdminSubmissions(adminId, query) {
        await this.assertAdminAsync(adminId);
        const page = Math.max(1, query.page ?? 1);
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
        const skip = (page - 1) * limit;
        const where = this.buildAdminListWhere(query);
        const [rows, total] = await Promise.all([
            this.prisma.courseFeedbackSubmission.findMany({
                where,
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                    course: { select: { title: true } },
                },
                orderBy: { submittedAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.courseFeedbackSubmission.count({ where }),
        ]);
        return {
            message: 'Feedback submissions fetched successfully',
            statusCode: 200,
            data: rows.map((row) => this.toAdminListRow(row)),
            total,
        };
    }
    async getAdminSubmissionDetail(adminId, submissionId) {
        await this.assertAdminAsync(adminId);
        const row = await this.prisma.courseFeedbackSubmission.findUnique({
            where: { id: submissionId },
            include: {
                user: {
                    select: { id: true, firstName: true, lastName: true, email: true },
                },
                course: { select: { title: true } },
            },
        });
        if (!row) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error: 'Submission not found' }, common_1.HttpStatus.NOT_FOUND);
        }
        return {
            message: 'Feedback submission fetched successfully',
            statusCode: 200,
            data: this.toSubmissionDetail(row, row.course.title, row.user),
        };
    }
    async getAdminAggregate(adminId, courseId) {
        await this.assertAdminAsync(adminId);
        const where = courseId
            ? { courseId }
            : {};
        const submissions = await this.prisma.courseFeedbackSubmission.findMany({
            where,
            select: { meanRating: true, overallRating: true, responses: true },
        });
        const withMean = submissions.filter((s) => s.meanRating != null);
        const meanOverall = withMean.length > 0
            ? Math.round((withMean.reduce((sum, s) => sum + Number(s.meanRating), 0) /
                withMean.length) *
                100) / 100
            : 0;
        const overallDistribution = Object.fromEntries(feedback_constants_1.FEEDBACK_OVERALL_RATINGS.map((k) => [k, 0]));
        for (const s of submissions) {
            if (s.overallRating)
                overallDistribution[s.overallRating] += 1;
        }
        const perQuestion = feedback_constants_1.FEEDBACK_LIKERT_KEYS.map((key) => {
            const values = [];
            for (const s of submissions) {
                const data = s.responses;
                const raw = data?.[key];
                if (typeof raw === 'string' && /^[1-5]$/.test(raw)) {
                    values.push(Number(raw));
                }
            }
            const mean = values.length > 0
                ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
                : 0;
            return { key, mean, count: values.length };
        });
        return {
            message: 'Feedback aggregate fetched successfully',
            statusCode: 200,
            data: {
                count: submissions.length,
                meanOverall,
                overallDistribution,
                perQuestion,
            },
        };
    }
    async getCourseFeedbackSubmissions(courseId, adminId) {
        await this.assertAdminAsync(adminId);
        const completions = await this.prisma.courseFeedbackSubmission.findMany({
            where: { courseId },
            include: {
                user: {
                    select: { id: true, firstName: true, lastName: true, email: true },
                },
                course: { select: { title: true } },
            },
            orderBy: { submittedAt: 'desc' },
        });
        return {
            message: 'Course feedback submissions fetched successfully',
            statusCode: 200,
            data: {
                courseId,
                submissions: completions.map((c) => ({
                    user: c.user,
                    submittedAt: c.submittedAt,
                    responses: c.responses,
                })),
                totalSubmissions: completions.length,
            },
        };
    }
    async notifyFeedbackRequiredIfNeeded(userId, courseId) {
        try {
            const [form, alreadySubmitted, course, user] = await Promise.all([
                this.prisma.courseFeedbackForm.findFirst({
                    where: { courseId, isActive: true, isRequired: true },
                }),
                this.prisma.courseFeedbackSubmission.findFirst({
                    where: { userId, courseId },
                    select: { id: true },
                }),
                this.prisma.course.findUnique({
                    where: { id: courseId },
                    select: { title: true },
                }),
                this.prisma.user.findUnique({
                    where: { id: userId },
                    select: { email: true, firstName: true, deletedAt: true },
                }),
            ]);
            if (!form || alreadySubmitted || !course || user?.deletedAt)
                return;
            await this.notifications.createNotification({
                userId,
                type: client_1.NotificationType.COURSE_FEEDBACK_REQUIRED,
                message: `Please share your feedback for ${course.title}.`,
                payload: {
                    courseId,
                    courseTitle: course.title,
                    daysOverdue: 0,
                },
                groupKey: (0, feedback_constants_1.feedbackGroupKey)(courseId),
                dedupeKey: (0, feedback_constants_1.feedbackDedupeKey)(courseId, userId, 'initial'),
                referenceId: courseId,
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            FeedbackService_1.logger.warn(`Feedback-required notification failed for user ${userId}, course ${courseId}: ${message}`);
        }
    }
    async markFeedbackNotificationsRead(userId, courseId) {
        const now = new Date();
        await this.prisma.notification.updateMany({
            where: {
                userId,
                type: client_1.NotificationType.COURSE_FEEDBACK_REQUIRED,
                referenceId: courseId,
            },
            data: {
                readAt: now,
                seenAt: now,
            },
        });
    }
    async assertFeedbackSubmittedForCertificate(userId, courseId) {
        const form = await this.prisma.courseFeedbackForm.findFirst({
            where: { courseId, isActive: true, isRequired: true },
        });
        if (!form)
            return;
        const submission = await this.prisma.courseFeedbackSubmission.findFirst({
            where: { userId, courseId },
        });
        if (!submission) {
            throw new common_1.ForbiddenException('Course feedback is required before accessing the certificate.');
        }
    }
    async assertAdminAsync(userId) {
        const admin = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!admin || admin.role !== 'admin') {
            throw new common_1.ForbiddenException('Only admins can access this resource');
        }
    }
    buildAdminListWhere(query) {
        const where = {};
        if (query.courseId)
            where.courseId = query.courseId;
        if (query.from || query.to) {
            where.submittedAt = {};
            if (query.from) {
                where.submittedAt.gte = new Date(`${query.from}T00:00:00.000Z`);
            }
            if (query.to) {
                where.submittedAt.lte = new Date(`${query.to}T23:59:59.999Z`);
            }
        }
        if (query.search?.trim()) {
            const term = query.search.trim();
            where.OR = [
                { learnerEmail: { contains: term, mode: 'insensitive' } },
                { course: { title: { contains: term, mode: 'insensitive' } } },
                {
                    responses: {
                        path: ['learnerName'],
                        string_contains: term,
                    },
                },
                {
                    user: {
                        OR: [
                            { email: { contains: term, mode: 'insensitive' } },
                            { firstName: { contains: term, mode: 'insensitive' } },
                            { lastName: { contains: term, mode: 'insensitive' } },
                        ],
                    },
                },
            ];
        }
        return where;
    }
    toAdminListRow(row) {
        const formData = (row.responses ?? {});
        const learnerName = typeof formData.learnerName === 'string' && formData.learnerName.trim()
            ? formData.learnerName.trim()
            : `${row.user.firstName ?? ''} ${row.user.lastName ?? ''}`.trim();
        return {
            id: row.id,
            submittedAt: row.submittedAt.toISOString(),
            learnerId: row.user.id,
            learnerName: learnerName || 'Unknown',
            learnerEmail: row.learnerEmail ??
                (typeof formData.email === 'string' && formData.email.trim()
                    ? formData.email.trim()
                    : row.user.email),
            courseId: row.courseId,
            courseTitle: typeof formData.courseTitle === 'string' && formData.courseTitle.trim()
                ? formData.courseTitle.trim()
                : row.course.title,
            trainerName: typeof formData.trainerName === 'string'
                ? formData.trainerName
                : null,
            location: typeof formData.location === 'string' ? formData.location : null,
            overallRating: row.overallRating,
            meanRating: row.meanRating != null ? Number(row.meanRating) : null,
        };
    }
    toSubmissionDetail(row, courseTitle, user) {
        const formData = (row.responses ?? {});
        const listFields = {
            id: row.id,
            submittedAt: row.submittedAt.toISOString(),
            learnerId: row.userId,
            learnerName: typeof formData.learnerName === 'string'
                ? formData.learnerName
                : user
                    ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
                    : 'Unknown',
            learnerEmail: row.learnerEmail ??
                (typeof formData.email === 'string' ? formData.email : user?.email),
            courseId: row.courseId,
            courseTitle: typeof formData.courseTitle === 'string'
                ? formData.courseTitle
                : courseTitle,
            trainerName: typeof formData.trainerName === 'string'
                ? formData.trainerName
                : null,
            location: typeof formData.location === 'string' ? formData.location : null,
            overallRating: row.overallRating,
            meanRating: row.meanRating != null
                ? typeof row.meanRating === 'number'
                    ? row.meanRating
                    : Number(row.meanRating)
                : null,
        };
        return {
            ...listFields,
            formVersion: row.formVersion,
            formData,
        };
    }
    extractTrainerName(tutorInfo) {
        if (!tutorInfo?.trim())
            return undefined;
        const firstLine = tutorInfo.trim().split('\n')[0]?.trim();
        return firstLine || undefined;
    }
};
exports.FeedbackService = FeedbackService;
FeedbackService.logger = new common_1.Logger(FeedbackService_1.name);
exports.FeedbackService = FeedbackService = FeedbackService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        mail_service_1.MailService,
        notification_service_1.NotificationService])
], FeedbackService);
//# sourceMappingURL=feedback.service.js.map