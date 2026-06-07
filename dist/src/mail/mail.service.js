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
const resend_1 = require("resend");
const engagement_reminder_template_1 = require("./templates/engagement-reminder.template");
const password_reset_template_1 = require("./templates/password-reset.template");
const DEFAULT_FROM = 'Greenwich Training & Consulting <noreply@greenwichtc-elearning.com>';
let MailService = MailService_1 = class MailService {
    constructor(config) {
        this.config = config;
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
        return this.send(mail.to, (0, engagement_reminder_template_1.renderEngagementReminder)(mail), 'engagement reminder');
    }
    async sendPasswordReset(mail) {
        return this.send(mail.to, (0, password_reset_template_1.renderPasswordReset)(mail), 'password reset');
    }
    async send(to, rendered, label) {
        if (!this.client) {
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
                return { sent: false, reason: error.message };
            }
            return { sent: true, id: data?.id };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(`Failed to send ${label} to ${to}: ${message}`);
            return { sent: false, reason: message };
        }
    }
};
exports.MailService = MailService;
exports.MailService = MailService = MailService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], MailService);
//# sourceMappingURL=mail.service.js.map