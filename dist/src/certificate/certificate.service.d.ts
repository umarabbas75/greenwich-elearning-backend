import { CertificateSource } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { ResponseDto } from '../dto';
export interface CertificateVerifyResult {
    valid: boolean;
    certificateId: string;
    learnerName: string;
    courseTitle: string;
    issuedAt: string;
    certificateSource?: CertificateSource | null;
    certificateUrl?: string;
}
export declare class CertificateService {
    private readonly prisma;
    private readonly mail;
    private readonly config;
    private static readonly logger;
    private cloudinaryReady;
    constructor(prisma: PrismaService, mail: MailService, config: ConfigService);
    tryIssueCertificate(userId: string, courseId: string): Promise<void>;
    getStudentCertificate(userId: string, courseId: string): Promise<ResponseDto>;
    listIssuedCertificates(params: {
        courseId?: string;
        source?: CertificateSource;
        from?: string;
        to?: string;
        cursor?: string;
        limit: number;
    }): Promise<ResponseDto>;
    verifyCertificate(certificateId: string): Promise<CertificateVerifyResult>;
    buildVerifiedCertificatePdf(certificateId: string): Promise<{
        buffer: Uint8Array;
        filename: string;
    }>;
    private resolvePublicDownloadUrl;
    recordManualCertificate(userId: string, courseId: string, certificateUrl: string, adminId: string): Promise<ResponseDto>;
    private getCourseIssueMode;
    private assertFeedbackSubmittedForCertificate;
    private isEligibleForCertificate;
    courseRequiresAssessmentPass(courseId: string): Promise<boolean>;
    buildStudentCertificatePdf(userId: string, courseId: string): Promise<{
        buffer: Uint8Array;
        filename: string;
        certificateId: string;
    }>;
    private assertEligibleForCertificateDownload;
    private generateAndPersist;
    private canUseCloudinary;
    private isDevelopment;
    private getApiBase;
    private persistCertificatePdf;
    private ensureCloudinaryConfigured;
    private buildVerifyUrl;
    allocateCertificateId(): Promise<string>;
}
