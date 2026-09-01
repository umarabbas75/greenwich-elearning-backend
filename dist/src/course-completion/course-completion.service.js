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
var CourseCompletionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CourseCompletionService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const mail_service_1 = require("../mail/mail.service");
const feedback_service_1 = require("../feedback/feedback.service");
const course_version_service_1 = require("../course-version/course-version.service");
const certificate_service_1 = require("../certificate/certificate.service");
let CourseCompletionService = CourseCompletionService_1 = class CourseCompletionService {
    constructor(prisma, mail, feedbackService, courseVersionService, certificateService) {
        this.prisma = prisma;
        this.mail = mail;
        this.feedbackService = feedbackService;
        this.courseVersionService = courseVersionService;
        this.certificateService = certificateService;
    }
    async checkContentCompletion(userId, courseId) {
        try {
            const { total: totalSections, liveSectionIds, quizBearingChapterIds, } = await this.courseVersionService.countCompletionDenominator(userId, courseId);
            if (totalSections === 0)
                return;
            const progressed = await this.prisma.userCourseProgress.findMany({
                where: { userId, courseId, sectionId: { in: liveSectionIds } },
                select: { sectionId: true },
                distinct: ['sectionId'],
            });
            if (progressed.length < totalSections)
                return;
            if (quizBearingChapterIds.length > 0) {
                const passedCount = await this.prisma.quizProgress.count({
                    where: {
                        userId,
                        chapterId: { in: quizBearingChapterIds },
                        isPassed: true,
                    },
                });
                if (passedCount < quizBearingChapterIds.length)
                    return;
            }
            const existing = await this.prisma.courseCompletion.findUnique({
                where: { userId_courseId: { userId, courseId } },
                select: { id: true, courseCompletedAt: true },
            });
            if (existing?.courseCompletedAt)
                return;
            let justCompleted;
            if (existing) {
                const claimed = await this.prisma.courseCompletion.updateMany({
                    where: { userId, courseId, courseCompletedAt: null },
                    data: { courseCompletedAt: new Date() },
                });
                justCompleted = claimed.count === 1;
            }
            else {
                try {
                    await this.prisma.courseCompletion.create({
                        data: { userId, courseId, courseCompletedAt: new Date() },
                    });
                    justCompleted = true;
                }
                catch {
                    justCompleted = false;
                }
            }
            if (!justCompleted)
                return;
            await this.sendCompletionEmails(userId, courseId);
            await this.feedbackService.notifyFeedbackRequiredIfNeeded(userId, courseId);
            await this.certificateService.tryIssueCertificate(userId, courseId);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            CourseCompletionService_1.logger.warn(`Content-completion check failed for user ${userId}, course ${courseId}: ${message}`);
        }
    }
    async sendCompletionEmails(userId, courseId) {
        try {
            const [user, course] = await Promise.all([
                this.prisma.user.findUnique({
                    where: { id: userId },
                    select: { email: true, firstName: true, deletedAt: true },
                }),
                this.prisma.course.findUnique({
                    where: { id: courseId },
                    select: { title: true },
                }),
            ]);
            if (!user?.email || user.deletedAt || !course)
                return;
            await this.mail.sendCourseCompleted({
                to: user.email,
                userId,
                firstName: user.firstName ?? '',
                courseTitle: course.title,
                courseId,
            });
            const [form, alreadySubmitted] = await Promise.all([
                this.prisma.courseFeedbackForm.findFirst({
                    where: { courseId, isActive: true },
                    select: { id: true },
                }),
                this.prisma.courseFeedbackSubmission.findFirst({
                    where: { userId, courseId },
                    select: { id: true },
                }),
            ]);
            if (form && !alreadySubmitted) {
                await this.mail.sendFeedbackRequest({
                    to: user.email,
                    userId,
                    firstName: user.firstName ?? '',
                    courseTitle: course.title,
                    courseId,
                });
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            CourseCompletionService_1.logger.warn(`Completion emails failed for user ${userId}, course ${courseId}: ${message}`);
        }
    }
};
exports.CourseCompletionService = CourseCompletionService;
CourseCompletionService.logger = new common_1.Logger(CourseCompletionService_1.name);
exports.CourseCompletionService = CourseCompletionService = CourseCompletionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        mail_service_1.MailService,
        feedback_service_1.FeedbackService,
        course_version_service_1.CourseVersionService,
        certificate_service_1.CertificateService])
], CourseCompletionService);
//# sourceMappingURL=course-completion.service.js.map