import { StreamableFile } from '@nestjs/common';
import { CertificateSource, User } from '@prisma/client';
import { CertificateService } from './certificate.service';
export declare class CertificateController {
    private readonly certificateService;
    constructor(certificateService: CertificateService);
    downloadVerifiedCertificate(certificateId: string): Promise<StreamableFile>;
    verify(certificateId: string): Promise<import("./certificate.service").CertificateVerifyResult>;
    getStudentCertificate(user: User, courseId: string): Promise<import("../dto").ResponseDto>;
    downloadStudentCertificate(user: User, courseId: string): Promise<StreamableFile>;
    listIssued(courseId?: string, source?: CertificateSource, from?: string, to?: string, cursor?: string, limit?: string): Promise<import("../dto").ResponseDto>;
}
