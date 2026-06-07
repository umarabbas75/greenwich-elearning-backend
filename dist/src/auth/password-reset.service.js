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
var PasswordResetService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PasswordResetService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const argon2 = require("argon2");
const prisma_service_1 = require("../prisma/prisma.service");
const mail_service_1 = require("../mail/mail.service");
let PasswordResetService = PasswordResetService_1 = class PasswordResetService {
    constructor(prisma, mail) {
        this.prisma = prisma;
        this.mail = mail;
        this.logger = new common_1.Logger(PasswordResetService_1.name);
    }
    async requestReset(body) {
        const user = await this.findActiveUser(body.email);
        if (user) {
            await this.issueAndSendOtp(user, false);
        }
        return this.genericResponse();
    }
    async resendReset(body) {
        const user = await this.findActiveUser(body.email);
        if (user) {
            const active = await this.latestActiveReset(user.id);
            if (active) {
                this.assertResendAllowed(active);
            }
            await this.issueAndSendOtp(user, true);
        }
        return this.genericResponse();
    }
    async verifyOtp(body) {
        const user = await this.findActiveUser(body.email);
        const reset = user ? await this.latestActiveReset(user.id) : null;
        if (!user || !reset) {
            throw this.badRequest('Invalid or expired verification code');
        }
        if (reset.expiresAt.getTime() < Date.now()) {
            throw this.badRequest('Invalid or expired verification code');
        }
        if (reset.attempts >= PasswordResetService_1.MAX_VERIFY_ATTEMPTS) {
            throw this.badRequest('Too many incorrect attempts. Please request a new code.');
        }
        const ok = await argon2.verify(reset.otpHash, body.otp);
        if (!ok) {
            const attempts = reset.attempts + 1;
            await this.prisma.passwordReset.update({
                where: { id: reset.id },
                data: { attempts },
            });
            const remaining = PasswordResetService_1.MAX_VERIFY_ATTEMPTS - attempts;
            throw this.badRequest(remaining > 0
                ? `Invalid verification code. ${remaining} attempt(s) remaining.`
                : 'Too many incorrect attempts. Please request a new code.');
        }
        const resetToken = (0, crypto_1.randomBytes)(32).toString('hex');
        const resetTokenHash = await argon2.hash(resetToken);
        const now = new Date();
        await this.prisma.passwordReset.update({
            where: { id: reset.id },
            data: {
                verifiedAt: now,
                resetTokenHash,
                expiresAt: new Date(now.getTime() + PasswordResetService_1.RESET_TOKEN_TTL_MINUTES * 60000),
            },
        });
        return {
            message: 'Verification successful',
            statusCode: 200,
            data: {
                resetToken,
                expiresInMinutes: PasswordResetService_1.RESET_TOKEN_TTL_MINUTES,
            },
        };
    }
    async resetPassword(body) {
        const user = await this.findActiveUser(body.email);
        const reset = user ? await this.latestActiveReset(user.id) : null;
        if (!user || !reset || !reset.verifiedAt || !reset.resetTokenHash) {
            throw this.badRequest('Invalid or expired reset request');
        }
        if (reset.expiresAt.getTime() < Date.now()) {
            throw this.badRequest('Reset token has expired. Please start again.');
        }
        const tokenOk = await argon2.verify(reset.resetTokenHash, body.resetToken);
        if (!tokenOk) {
            throw this.badRequest('Invalid or expired reset request');
        }
        const now = new Date();
        await this.prisma.user.update({
            where: { id: user.id },
            data: { password: await argon2.hash(body.newPassword) },
        });
        await this.prisma.passwordReset.update({
            where: { id: reset.id },
            data: { consumedAt: now, resetTokenHash: null },
        });
        return {
            message: 'Password has been reset successfully. You can now log in.',
            statusCode: 200,
            data: {},
        };
    }
    async findActiveUser(email) {
        const user = await this.prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                email: true,
                firstName: true,
                status: true,
                deletedAt: true,
            },
        });
        if (!user || user.deletedAt || user.status !== 'active')
            return null;
        return user;
    }
    async latestActiveReset(userId) {
        return this.prisma.passwordReset.findFirst({
            where: { userId, consumedAt: null },
            orderBy: { createdAt: 'desc' },
        });
    }
    async issueAndSendOtp(user, isResend) {
        const prior = await this.latestActiveReset(user.id);
        const nextResendCount = isResend ? (prior?.resendCount ?? 0) + 1 : 0;
        const otp = this.generateOtp();
        const otpHash = await argon2.hash(otp);
        const expiresAt = new Date(Date.now() + PasswordResetService_1.OTP_TTL_MINUTES * 60000);
        if (prior) {
            await this.prisma.passwordReset.update({
                where: { id: prior.id },
                data: { consumedAt: new Date() },
            });
        }
        await this.prisma.passwordReset.create({
            data: {
                userId: user.id,
                otpHash,
                expiresAt,
                resendCount: nextResendCount,
            },
        });
        const result = await this.mail.sendPasswordReset({
            to: user.email,
            firstName: user.firstName,
            otp,
            expiresInMinutes: PasswordResetService_1.OTP_TTL_MINUTES,
        });
        if (!result.sent) {
            this.logger.error(`Failed to send password-reset OTP to user ${user.id}: ${result.reason}`);
        }
    }
    assertResendAllowed(active) {
        if (active.resendCount >= PasswordResetService_1.MAX_RESENDS) {
            throw this.badRequest('Resend limit reached. Please try again later or request a new code.');
        }
        const elapsedMs = Date.now() - active.updatedAt.getTime();
        const cooldownMs = PasswordResetService_1.RESEND_COOLDOWN_SECONDS * 1000;
        if (elapsedMs < cooldownMs) {
            const wait = Math.ceil((cooldownMs - elapsedMs) / 1000);
            throw this.badRequest(`Please wait ${wait} second(s) before requesting another code.`);
        }
    }
    generateOtp() {
        return (0, crypto_1.randomInt)(0, 1000000).toString().padStart(6, '0');
    }
    genericResponse() {
        return {
            message: PasswordResetService_1.GENERIC_REQUEST_MESSAGE,
            statusCode: 200,
            data: {},
        };
    }
    badRequest(message) {
        return new common_1.HttpException({ status: common_1.HttpStatus.BAD_REQUEST, error: message, message }, common_1.HttpStatus.BAD_REQUEST);
    }
};
exports.PasswordResetService = PasswordResetService;
PasswordResetService.OTP_TTL_MINUTES = 10;
PasswordResetService.RESET_TOKEN_TTL_MINUTES = 15;
PasswordResetService.MAX_VERIFY_ATTEMPTS = 5;
PasswordResetService.MAX_RESENDS = 3;
PasswordResetService.RESEND_COOLDOWN_SECONDS = 60;
PasswordResetService.GENERIC_REQUEST_MESSAGE = 'If an account exists for that email, a verification code has been sent.';
exports.PasswordResetService = PasswordResetService = PasswordResetService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        mail_service_1.MailService])
], PasswordResetService);
//# sourceMappingURL=password-reset.service.js.map