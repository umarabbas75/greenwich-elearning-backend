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
var MailService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_1 = require("@prisma/client");
const resend_1 = require("resend");
const prisma_service_1 = require("../prisma/prisma.service");
const engagement_reminder_template_1 = require("./templates/engagement-reminder.template");
const password_reset_template_1 = require("./templates/password-reset.template");
const notification_template_1 = require("./templates/notification.template");
const welcome_template_1 = require("./templates/welcome.template");
const contact_message_template_1 = require("./templates/contact-message.template");
const course_feedback_template_1 = require("./templates/course-feedback.template");
const NOTIFICATION_EMAIL_TYPE = {
    FORUM_THREAD: client_1.EmailType.NOTIFICATION_FORUM_THREAD,
    FORUM_COMMENT: client_1.EmailType.NOTIFICATION_FORUM_COMMENT,
    ASSESSMENT_SUBMITTED: client_1.EmailType.NOTIFICATION_ASSESSMENT_SUBMITTED,
    ASSESSMENT_GRADED: client_1.EmailType.NOTIFICATION_ASSESSMENT_GRADED,
    ASSIGNMENT_CREATED: client_1.EmailType.NOTIFICATION_ASSIGNMENT_CREATED,
    ASSIGNMENT_SUBMITTED: client_1.EmailType.NOTIFICATION_ASSIGNMENT_SUBMITTED,
    ASSIGNMENT_GRADED: client_1.EmailType.NOTIFICATION_ASSIGNMENT_GRADED,
};
const DEFAULT_FROM = 'Greenwich Training & Consulting <noreply@greenwichtc-elearning.com>';
let MailService = MailService_1 = class MailService {
    constructor(config, prisma) {
        this.config = config;
        this.prisma = prisma;
        this.logger = new common_1.Logger(MailService_1.name);
        const apiKey = this.config.get('RESEND_API_KEY');
        this.from = this.config.get('MAIL_FROM') ?? DEFAULT_FROM;
        this.client = apiKey ? new resend_1.Resend(apiKey) : null;
        if (!this.client) {
            this.logger.warn('RESEND_API_KEY is not set — MailService will no-op (emails are skipped).');
        }
    }
    get isEnabled() {
        return this.client !== null;
    }
    async sendEngagementReminder(mail) {
        return this.send(mail.to, (0, engagement_reminder_template_1.renderEngagementReminder)(mail), 'engagement reminder', {
            type: client_1.EmailType.ENGAGEMENT_REMINDER,
            userId: mail.userId ?? null,
            metadata: {
                reminderType: mail.reminderType,
                courseTitle: mail.courseTitle,
            },
        });
    }
    async sendPasswordReset(mail) {
        return this.send(mail.to, (0, password_reset_template_1.renderPasswordReset)(mail), 'password reset', {
            type: client_1.EmailType.PASSWORD_RESET,
            userId: mail.userId ?? null,
        });
    }
    async sendNotificationEmail(mail) {
        return this.send(mail.to, (0, notification_template_1.renderNotificationEmail)(mail), `notification:${mail.kind}`, { type: NOTIFICATION_EMAIL_TYPE[mail.kind], userId: mail.userId ?? null });
    }
    async sendWelcome(mail) {
        return this.send(mail.to, (0, welcome_template_1.renderWelcome)(mail), 'welcome', {
            type: client_1.EmailType.WELCOME,
            userId: mail.userId ?? null,
        });
    }
    async sendContactMessage(mail) {
        return this.send(mail.to, (0, contact_message_template_1.renderContactMessage)(mail), 'contact message', {
            type: client_1.EmailType.CONTACT_MESSAGE,
            userId: mail.userId ?? null,
            metadata: { senderEmail: mail.senderEmail },
        });
    }
    async sendCourseCompleted(mail) {
        return this.send(mail.to, (0, course_feedback_template_1.renderCourseCompleted)(mail), 'course completed', {
            type: client_1.EmailType.COURSE_COMPLETED,
            userId: mail.userId ?? null,
            metadata: { courseTitle: mail.courseTitle },
        });
    }
    async sendFeedbackRequest(mail) {
        return this.send(mail.to, (0, course_feedback_template_1.renderFeedbackRequest)(mail), 'feedback request', {
            type: client_1.EmailType.FEEDBACK_REQUEST,
            userId: mail.userId ?? null,
            metadata: { courseTitle: mail.courseTitle, courseId: mail.courseId },
        });
    }
    async sendPendingFeedbackOutstanding(mail) {
        return this.send(mail.to, (0, course_feedback_template_1.renderPendingFeedbackOutstanding)(mail), 'pending feedback outstanding', {
            type: client_1.EmailType.FEEDBACK_OUTSTANDING,
            userId: mail.userId ?? null,
            metadata: {
                courseTitle: mail.courseTitle,
                courseId: mail.courseId,
                completedAt: mail.completedAt ?? null,
            },
        });
    }
    async sendFeedbackReminder(mail) {
        return this.send(mail.to, (0, course_feedback_template_1.renderFeedbackReminder)(mail), 'feedback reminder', {
            type: client_1.EmailType.FEEDBACK_REMINDER,
            userId: mail.userId ?? null,
            metadata: { courseTitle: mail.courseTitle, courseId: mail.courseId },
        });
    }
    async sendFeedbackReceived(mail) {
        return this.send(mail.to, (0, course_feedback_template_1.renderFeedbackReceived)(mail), 'feedback received', {
            type: client_1.EmailType.FEEDBACK_RECEIVED,
            userId: mail.userId ?? null,
            metadata: { courseTitle: mail.courseTitle },
        });
    }
    async sendFeedbackReceivedAdmin(mail) {
        return this.send(mail.to, (0, course_feedback_template_1.renderFeedbackReceivedAdmin)(mail), 'feedback received (admin)', {
            type: client_1.EmailType.FEEDBACK_RECEIVED_ADMIN,
            userId: mail.userId ?? null,
            metadata: {
                courseTitle: mail.courseTitle,
                studentEmail: mail.studentEmail,
            },
        });
    }
    async send(to, rendered, label, audit) {
        if (!this.client) {
            await this.recordEmailLog(to, audit, {
                status: 'SKIPPED',
                error: 'mail-disabled',
            });
            return { sent: false, reason: 'mail-disabled' };
        }
        try {
            const { data, error } = await this.client.emails.send({
                from: this.from,
                to,
                subject: rendered.subject,
                html: rendered.html,
                text: rendered.text,
            });
            if (error) {
                this.logger.error(`Resend rejected ${label} to ${to}: ${error.name} — ${error.message}`);
                await this.recordEmailLog(to, audit, {
                    status: 'FAILED',
                    error: error.message,
                });
                return { sent: false, reason: error.message };
            }
            await this.recordEmailLog(to, audit, {
                status: 'SENT',
                providerId: data?.id,
            });
            return { sent: true, id: data?.id };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(`Failed to send ${label} to ${to}: ${message}`);
            await this.recordEmailLog(to, audit, {
                status: 'FAILED',
                error: message,
            });
            return { sent: false, reason: message };
        }
    }
    async recordEmailLog(recipient, audit, outcome) {
        try {
            await this.prisma.emailLog.create({
                data: {
                    recipient,
                    type: audit.type,
                    userId: audit.userId ?? null,
                    metadata: audit.metadata,
                    status: outcome.status,
                    providerId: outcome.providerId ?? null,
                    error: outcome.error ?? null,
                },
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Failed to record EmailLog for ${recipient}: ${message}`);
        }
    }
};
exports.MailService = MailService;
exports.MailService = MailService = MailService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService])
], MailService);
//# sourceMappingURL=mail.service.js.map