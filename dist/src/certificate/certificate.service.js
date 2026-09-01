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
var CertificateService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CertificateService = void 0;
const client_1 = require("@prisma/client");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const crypto_1 = require("crypto");
const prisma_service_1 = require("../prisma/prisma.service");
const mail_service_1 = require("../mail/mail.service");
const mail_layout_1 = require("../mail/templates/mail-layout");
const certificate_pdf_1 = require("./certificate-pdf");
const certificate_cloudinary_1 = require("./certificate-cloudinary");
let CertificateService = CertificateService_1 = class CertificateService {
    constructor(prisma, mail, config) {
        this.prisma = prisma;
        this.mail = mail;
        this.config = config;
        this.cloudinaryReady = false;
    }
    async tryIssueCertificate(userId, courseId) {
        try {
            const mode = await this.getCourseIssueMode(courseId);
            if (mode !== client_1.CertificateIssueMode.AUTO)
                return;
            const eligible = await this.isEligibleForCertificate(userId, courseId);
            if (!eligible)
                return;
            const existing = await this.prisma.courseCompletion.findUnique({
                where: { userId_courseId: { userId, courseId } },
                select: { certificateUrl: true },
            });
            if (existing?.certificateUrl)
                return;
            await this.generateAndPersist(userId, courseId);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            CertificateService_1.logger.warn(`Certificate auto-issue failed for user ${userId}, course ${courseId}: ${message}`);
        }
    }
    async getStudentCertificate(userId, courseId) {
        const mode = await this.getCourseIssueMode(courseId);
        if (mode === client_1.CertificateIssueMode.NONE) {
            throw new common_1.ForbiddenException('This course does not issue certificates.');
        }
        await this.assertFeedbackSubmittedForCertificate(userId, courseId);
        const requiresAssessmentPass = await this.courseRequiresAssessmentPass(courseId);
        const completion = await this.prisma.courseCompletion.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: {
                isPassed: true,
                courseCompletedAt: true,
                certificateUrl: true,
                certificateId: true,
                certificateIssuedAt: true,
                certificateSource: true,
            },
        });
        if (requiresAssessmentPass && !completion?.isPassed) {
            throw new common_1.ForbiddenException('You must pass the course assessment before accessing your certificate.');
        }
        if (!requiresAssessmentPass && !completion?.courseCompletedAt) {
            throw new common_1.ForbiddenException('You must complete the course before accessing your certificate.');
        }
        if (!completion.certificateUrl) {
            if (mode === client_1.CertificateIssueMode.MANUAL) {
                throw new common_1.NotFoundException('Your certificate is not yet available. It will be issued by the course administrator.');
            }
            const eligible = await this.isEligibleForCertificate(userId, courseId);
            if (!eligible) {
                throw new common_1.ForbiddenException('Certificate requirements are not yet met.');
            }
            try {
                await this.generateAndPersist(userId, courseId);
            }
            catch (error) {
                if (error instanceof common_1.ServiceUnavailableException) {
                    throw error;
                }
                const message = error instanceof Error ? error.message : String(error);
                CertificateService_1.logger.warn(`Certificate generation failed for user ${userId}, course ${courseId}: ${message}`);
                throw new common_1.NotFoundException('Certificate could not be generated.');
            }
        }
        const updated = await this.prisma.courseCompletion.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: {
                certificateUrl: true,
                certificateId: true,
                certificateIssuedAt: true,
                certificateSource: true,
            },
        });
        if (!updated?.certificateUrl) {
            throw new common_1.NotFoundException('Certificate could not be generated.');
        }
        return {
            message: 'Certificate retrieved',
            statusCode: 200,
            data: {
                certificateUrl: updated.certificateId
                    ? this.resolvePublicDownloadUrl(updated.certificateUrl, updated.certificateId)
                    : updated.certificateUrl,
                certificateId: updated.certificateId,
                certificateIssuedAt: updated.certificateIssuedAt?.toISOString() ?? null,
                certificateSource: updated.certificateSource,
                verifyUrl: updated.certificateId
                    ? this.buildVerifyUrl(updated.certificateId)
                    : null,
            },
        };
    }
    async listIssuedCertificates(params) {
        const limit = Math.min(Math.max(params.limit, 1), 100);
        const where = {
            certificateUrl: { not: null },
            certificateIssuedAt: { not: null },
        };
        if (params.courseId)
            where.courseId = params.courseId;
        if (params.source)
            where.certificateSource = params.source;
        if (params.from || params.to) {
            where.certificateIssuedAt = {
                not: null,
                ...(params.from ? { gte: new Date(params.from) } : {}),
                ...(params.to ? { lte: new Date(params.to) } : {}),
            };
        }
        const rows = await this.prisma.courseCompletion.findMany({
            where,
            orderBy: [{ certificateIssuedAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            include: {
                user: {
                    select: { id: true, firstName: true, lastName: true, email: true },
                },
                course: {
                    select: { id: true, title: true, certificateIssueMode: true },
                },
            },
            ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
        });
        const hasMore = rows.length > limit;
        const data = hasMore ? rows.slice(0, limit) : rows;
        return {
            message: 'Issued certificates fetched',
            statusCode: 200,
            data: {
                records: data.map((r) => ({
                    id: r.id,
                    userId: r.userId,
                    learnerName: r.user
                        ? `${r.user.firstName} ${r.user.lastName}`.trim()
                        : null,
                    learnerEmail: r.user?.email ?? null,
                    courseId: r.courseId,
                    courseTitle: r.course?.title ?? null,
                    certificateIssueMode: r.course?.certificateIssueMode ?? null,
                    certificateId: r.certificateId,
                    certificateUrl: r.certificateUrl,
                    certificateIssuedAt: r.certificateIssuedAt?.toISOString() ?? null,
                    certificateSource: r.certificateSource,
                    assessmentPassedAt: r.assessmentPassedAt?.toISOString() ?? null,
                    courseCompletedAt: r.courseCompletedAt?.toISOString() ?? null,
                    verifyUrl: r.certificateId
                        ? this.buildVerifyUrl(r.certificateId)
                        : null,
                })),
                nextCursor: hasMore ? data[data.length - 1].id : null,
            },
        };
    }
    async verifyCertificate(certificateId) {
        const normalized = certificateId.trim().toUpperCase();
        const completion = await this.prisma.courseCompletion.findUnique({
            where: { certificateId: normalized },
            include: {
                user: { select: { firstName: true, lastName: true, deletedAt: true } },
                course: { select: { title: true } },
            },
        });
        if (!completion?.certificateUrl ||
            !completion.certificateIssuedAt ||
            completion.user.deletedAt) {
            throw new common_1.NotFoundException('Certificate not found.');
        }
        const learnerName = `${completion.user.firstName} ${completion.user.lastName}`.trim();
        return {
            valid: true,
            certificateId: completion.certificateId,
            learnerName,
            courseTitle: completion.course.title,
            issuedAt: completion.certificateIssuedAt.toISOString(),
            certificateSource: completion.certificateSource,
            certificateUrl: this.resolvePublicDownloadUrl(completion.certificateUrl, completion.certificateId),
        };
    }
    async buildVerifiedCertificatePdf(certificateId) {
        const normalized = certificateId.trim().toUpperCase();
        const completion = await this.prisma.courseCompletion.findUnique({
            where: { certificateId: normalized },
            include: {
                user: { select: { firstName: true, lastName: true, deletedAt: true } },
                course: { select: { title: true } },
                bestAttempt: { select: { percentage: true } },
            },
        });
        if (!completion?.certificateIssuedAt ||
            !completion.user ||
            completion.user.deletedAt ||
            !completion.course) {
            throw new common_1.NotFoundException('Certificate not found.');
        }
        const issuedAt = completion.certificateIssuedAt;
        const verifyUrl = this.buildVerifyUrl(completion.certificateId);
        const learnerName = `${completion.user.firstName} ${completion.user.lastName}`.trim();
        const buffer = await (0, certificate_pdf_1.renderCertificatePdf)({
            learnerName,
            courseTitle: completion.course.title,
            issuedAt,
            certificateId: completion.certificateId,
            verifyUrl,
            scorePct: completion.bestAttempt?.percentage ?? null,
        });
        const safeTitle = completion.course.title
            .replace(/[^a-zA-Z0-9-_]+/g, '-')
            .slice(0, 60);
        return {
            buffer,
            filename: `${safeTitle || 'certificate'}-${completion.certificateId}.pdf`,
        };
    }
    resolvePublicDownloadUrl(storedUrl, certificateId) {
        if (storedUrl.includes('res.cloudinary.com')) {
            return storedUrl;
        }
        return `${this.getApiBase()}/api/v1/certificates/verify/${encodeURIComponent(certificateId)}/file`;
    }
    async recordManualCertificate(userId, courseId, certificateUrl, adminId) {
        const mode = await this.getCourseIssueMode(courseId);
        if (mode === client_1.CertificateIssueMode.NONE) {
            throw new common_1.ForbiddenException('This course does not issue certificates.');
        }
        const completion = await this.prisma.courseCompletion.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { certificateId: true },
        });
        if (!completion) {
            throw new common_1.NotFoundException('Course completion record not found.');
        }
        const certificateId = completion.certificateId ?? (await this.allocateCertificateId());
        const updated = await this.prisma.courseCompletion.update({
            where: { userId_courseId: { userId, courseId } },
            data: {
                certificateUrl,
                certificateId,
                certificateIssuedAt: new Date(),
                certificateSource: client_1.CertificateSource.MANUAL,
                certificateIssuedByAdminId: adminId,
            },
        });
        return {
            message: 'Certificate URL saved',
            statusCode: 200,
            data: updated,
        };
    }
    async getCourseIssueMode(courseId) {
        const course = await this.prisma.course.findUnique({
            where: { id: courseId },
            select: { certificateIssueMode: true },
        });
        if (!course) {
            throw new common_1.NotFoundException('Course not found.');
        }
        return course.certificateIssueMode;
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
    async isEligibleForCertificate(userId, courseId) {
        const mode = await this.getCourseIssueMode(courseId);
        if (mode !== client_1.CertificateIssueMode.AUTO)
            return false;
        const requiresAssessmentPass = await this.courseRequiresAssessmentPass(courseId);
        const completion = await this.prisma.courseCompletion.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: {
                isPassed: true,
                assessmentPassedAt: true,
                courseCompletedAt: true,
            },
        });
        if (requiresAssessmentPass) {
            if (!completion?.isPassed || !completion.assessmentPassedAt) {
                return false;
            }
        }
        else if (!completion?.courseCompletedAt) {
            return false;
        }
        const requiredForm = await this.prisma.courseFeedbackForm.findFirst({
            where: { courseId, isActive: true, isRequired: true },
            select: { id: true },
        });
        if (!requiredForm)
            return true;
        const submission = await this.prisma.courseFeedbackSubmission.findFirst({
            where: { userId, courseId },
            select: { id: true },
        });
        return !!submission;
    }
    async courseRequiresAssessmentPass(courseId) {
        const count = await this.prisma.assessment.count({
            where: { courseId, isActive: true },
        });
        return count > 0;
    }
    async buildStudentCertificatePdf(userId, courseId) {
        await this.assertEligibleForCertificateDownload(userId, courseId);
        const completion = await this.prisma.courseCompletion.findUnique({
            where: { userId_courseId: { userId, courseId } },
            include: {
                bestAttempt: { select: { percentage: true } },
            },
        });
        if (!completion) {
            throw new common_1.NotFoundException('Course completion record not found.');
        }
        const [user, course] = await Promise.all([
            this.prisma.user.findUnique({
                where: { id: userId },
                select: { firstName: true, lastName: true, deletedAt: true },
            }),
            this.prisma.course.findUnique({
                where: { id: courseId },
                select: { title: true },
            }),
        ]);
        if (!user || user.deletedAt || !course) {
            throw new common_1.NotFoundException('Certificate could not be generated.');
        }
        const certificateId = completion.certificateId ?? (await this.allocateCertificateId());
        const issuedAt = completion.certificateIssuedAt ?? new Date();
        const verifyUrl = this.buildVerifyUrl(certificateId);
        const learnerName = `${user.firstName} ${user.lastName}`.trim();
        const buffer = await (0, certificate_pdf_1.renderCertificatePdf)({
            learnerName,
            courseTitle: course.title,
            issuedAt,
            certificateId,
            verifyUrl,
            scorePct: completion.bestAttempt?.percentage ?? null,
        });
        const safeTitle = course.title.replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 60);
        return {
            buffer,
            filename: `${safeTitle || 'certificate'}-${certificateId}.pdf`,
            certificateId,
        };
    }
    async assertEligibleForCertificateDownload(userId, courseId) {
        const mode = await this.getCourseIssueMode(courseId);
        if (mode === client_1.CertificateIssueMode.NONE) {
            throw new common_1.ForbiddenException('This course does not issue certificates.');
        }
        await this.assertFeedbackSubmittedForCertificate(userId, courseId);
        const requiresAssessmentPass = await this.courseRequiresAssessmentPass(courseId);
        const completion = await this.prisma.courseCompletion.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { isPassed: true, courseCompletedAt: true },
        });
        if (requiresAssessmentPass && !completion?.isPassed) {
            throw new common_1.ForbiddenException('You must pass the course assessment before accessing your certificate.');
        }
        if (!requiresAssessmentPass && !completion?.courseCompletedAt) {
            throw new common_1.ForbiddenException('You must complete the course before accessing your certificate.');
        }
    }
    async generateAndPersist(userId, courseId) {
        const [completion, user, course] = await Promise.all([
            this.prisma.courseCompletion.findUnique({
                where: { userId_courseId: { userId, courseId } },
                include: {
                    bestAttempt: { select: { percentage: true } },
                },
            }),
            this.prisma.user.findUnique({
                where: { id: userId },
                select: {
                    firstName: true,
                    lastName: true,
                    email: true,
                    deletedAt: true,
                },
            }),
            this.prisma.course.findUnique({
                where: { id: courseId },
                select: { title: true, certificateIssueMode: true },
            }),
        ]);
        if (course?.certificateIssueMode !== client_1.CertificateIssueMode.AUTO) {
            return;
        }
        const requiresAssessmentPass = await this.courseRequiresAssessmentPass(courseId);
        if (!user || user.deletedAt || !course || !completion) {
            throw new Error('Completion or learner data missing for certificate');
        }
        if (requiresAssessmentPass && !completion.isPassed) {
            throw new Error('Assessment pass required for certificate');
        }
        if (!requiresAssessmentPass && !completion.courseCompletedAt) {
            throw new Error('Course completion required for certificate');
        }
        const certificateId = completion.certificateId ?? (await this.allocateCertificateId());
        const issuedAt = new Date();
        const verifyUrl = this.buildVerifyUrl(certificateId);
        const learnerName = `${user.firstName} ${user.lastName}`.trim();
        const pdfBytes = await (0, certificate_pdf_1.renderCertificatePdf)({
            learnerName,
            courseTitle: course.title,
            issuedAt,
            certificateId,
            verifyUrl,
            scorePct: completion.bestAttempt?.percentage ?? null,
        });
        const publicId = `cert-${certificateId.replace(/[^a-zA-Z0-9-]/g, '')}`;
        const certificateUrl = await this.persistCertificatePdf(Buffer.from(pdfBytes), publicId, certificateId);
        const claimed = await this.prisma.courseCompletion.updateMany({
            where: { userId, courseId, certificateUrl: null },
            data: {
                certificateUrl,
                certificateId,
                certificateIssuedAt: issuedAt,
                certificateSource: client_1.CertificateSource.AUTO,
                certificateIssuedByAdminId: null,
            },
        });
        if (claimed.count === 0)
            return;
        if (user.email) {
            await this.mail.sendCertificateIssued({
                to: user.email,
                userId,
                firstName: user.firstName,
                courseTitle: course.title,
                courseId,
                certificateUrl,
                certificateId,
                verifyUrl,
            });
        }
        await this.mail.sendCertificateIssuedAdmin({
            to: mail_layout_1.ADMIN_EMAIL,
            studentName: learnerName,
            studentEmail: user.email ?? 'unknown',
            courseTitle: course.title,
            courseId,
            certificateId,
            certificateUrl,
            verifyUrl,
        });
    }
    canUseCloudinary() {
        const cloudName = this.config.get('CLOUDINARY_CLOUD_NAME');
        const apiKey = this.config.get('CLOUDINARY_API_KEY');
        const apiSecret = this.config.get('CLOUDINARY_API_SECRET');
        return !!(cloudName && apiKey && apiSecret);
    }
    isDevelopment() {
        return this.config.get('NODE_ENV') !== 'production';
    }
    getApiBase() {
        const port = this.config.get('PORT') ?? '3333';
        return (this.config.get('APP_BASE_URL')?.replace(/\/$/, '') ??
            `http://localhost:${port}`);
    }
    async persistCertificatePdf(buffer, publicId, certificateId) {
        if (this.canUseCloudinary()) {
            this.ensureCloudinaryConfigured();
            return (0, certificate_cloudinary_1.uploadCertificatePdf)(buffer, publicId);
        }
        if (this.isDevelopment()) {
            CertificateService_1.logger.warn('Cloudinary is not configured — using public verify download URL for development.');
            return `${this.getApiBase()}/api/v1/certificates/verify/${encodeURIComponent(certificateId)}/file`;
        }
        throw new common_1.ServiceUnavailableException('Certificate storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
    }
    ensureCloudinaryConfigured() {
        if (this.cloudinaryReady)
            return;
        const cloudName = this.config.get('CLOUDINARY_CLOUD_NAME');
        const apiKey = this.config.get('CLOUDINARY_API_KEY');
        const apiSecret = this.config.get('CLOUDINARY_API_SECRET');
        if (!cloudName || !apiKey || !apiSecret) {
            throw new common_1.ServiceUnavailableException('Certificate storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
        }
        (0, certificate_cloudinary_1.configureCloudinary)({ cloudName, apiKey, apiSecret });
        this.cloudinaryReady = true;
    }
    buildVerifyUrl(certificateId) {
        const base = this.config.get('APP_BASE_URL') ??
            'https://www.greenwichtc-elearning.com';
        return `${base.replace(/\/$/, '')}/certificates/verify/${encodeURIComponent(certificateId)}`;
    }
    async allocateCertificateId() {
        for (let attempt = 0; attempt < 8; attempt++) {
            const code = (0, crypto_1.randomBytes)(4).toString('hex').toUpperCase();
            const certificateId = `GTC-${code}`;
            const exists = await this.prisma.courseCompletion.findUnique({
                where: { certificateId },
                select: { id: true },
            });
            if (!exists)
                return certificateId;
        }
        throw new Error('Failed to allocate a unique certificate ID');
    }
};
exports.CertificateService = CertificateService;
CertificateService.logger = new common_1.Logger(CertificateService_1.name);
exports.CertificateService = CertificateService = CertificateService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        mail_service_1.MailService,
        config_1.ConfigService])
], CertificateService);
//# sourceMappingURL=certificate.service.js.map