import {
  CertificateIssueMode,
  CertificateSource,
} from '@prisma/client';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { ADMIN_EMAIL } from '../mail/templates/mail-layout';
import { ResponseDto } from '../dto';
import { renderCertificatePdf } from './certificate-pdf';
import {
  configureCloudinary,
  uploadCertificatePdf,
} from './certificate-cloudinary';

export interface CertificateVerifyResult {
  valid: boolean;
  certificateId: string;
  learnerName: string;
  courseTitle: string;
  issuedAt: string;
  certificateSource?: CertificateSource | null;
  certificateUrl?: string;
}

@Injectable()
export class CertificateService {
  private static readonly logger = new Logger(CertificateService.name);
  private cloudinaryReady = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Best-effort auto-issue when the course is in AUTO mode and all requirements
   * are met. Idempotent: skips when certificateUrl is already set.
   */
  async tryIssueCertificate(userId: string, courseId: string): Promise<void> {
    try {
      const mode = await this.getCourseIssueMode(courseId);
      if (mode !== CertificateIssueMode.AUTO) return;

      const eligible = await this.isEligibleForCertificate(userId, courseId);
      if (!eligible) return;

      const existing = await this.prisma.courseCompletion.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: { certificateUrl: true },
      });
      if (existing?.certificateUrl) return;

      await this.generateAndPersist(userId, courseId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      CertificateService.logger.warn(
        `Certificate auto-issue failed for user ${userId}, course ${courseId}: ${message}`,
      );
    }
  }

  /** Student-facing: returns cert metadata/URL. AUTO courses generate on first access. */
  async getStudentCertificate(
    userId: string,
    courseId: string,
  ): Promise<ResponseDto> {
    const mode = await this.getCourseIssueMode(courseId);
    if (mode === CertificateIssueMode.NONE) {
      throw new ForbiddenException('This course does not issue certificates.');
    }

    await this.assertFeedbackSubmittedForCertificate(userId, courseId);

    const requiresAssessmentPass =
      await this.courseRequiresAssessmentPass(courseId);

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
      throw new ForbiddenException(
        'You must pass the course assessment before accessing your certificate.',
      );
    }

    if (!requiresAssessmentPass && !completion?.courseCompletedAt) {
      throw new ForbiddenException(
        'You must complete the course before accessing your certificate.',
      );
    }

    if (!completion.certificateUrl) {
      if (mode === CertificateIssueMode.MANUAL) {
        throw new NotFoundException(
          'Your certificate is not yet available. It will be issued by the course administrator.',
        );
      }

      const eligible = await this.isEligibleForCertificate(userId, courseId);
      if (!eligible) {
        throw new ForbiddenException(
          'Certificate requirements are not yet met.',
        );
      }
      try {
        await this.generateAndPersist(userId, courseId);
      } catch (error) {
        if (error instanceof ServiceUnavailableException) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        CertificateService.logger.warn(
          `Certificate generation failed for user ${userId}, course ${courseId}: ${message}`,
        );
        throw new NotFoundException('Certificate could not be generated.');
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
      throw new NotFoundException('Certificate could not be generated.');
    }

    return {
      message: 'Certificate retrieved',
      statusCode: 200,
      data: {
        certificateUrl: updated.certificateId
          ? this.resolvePublicDownloadUrl(
              updated.certificateUrl!,
              updated.certificateId,
            )
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

  /** Admin record-keeping: filterable list of issued certificates. */
  async listIssuedCertificates(params: {
    courseId?: string;
    source?: CertificateSource;
    from?: string;
    to?: string;
    cursor?: string;
    limit: number;
  }): Promise<ResponseDto> {
    const limit = Math.min(Math.max(params.limit, 1), 100);
    const where: Parameters<
      typeof this.prisma.courseCompletion.findMany
    >[0]['where'] = {
      certificateUrl: { not: null },
      certificateIssuedAt: { not: null },
    };

    if (params.courseId) where.courseId = params.courseId;
    if (params.source) where.certificateSource = params.source;
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

  /** Public verification — no auth required. */
  async verifyCertificate(
    certificateId: string,
  ): Promise<CertificateVerifyResult> {
    const normalized = certificateId.trim().toUpperCase();
    const completion = await this.prisma.courseCompletion.findUnique({
      where: { certificateId: normalized },
      include: {
        user: { select: { firstName: true, lastName: true, deletedAt: true } },
        course: { select: { title: true } },
      },
    });

    if (
      !completion?.certificateUrl ||
      !completion.certificateIssuedAt ||
      completion.user.deletedAt
    ) {
      throw new NotFoundException('Certificate not found.');
    }

    const learnerName = `${completion.user.firstName} ${completion.user.lastName}`.trim();

    return {
      valid: true,
      certificateId: completion.certificateId!,
      learnerName,
      courseTitle: completion.course.title,
      issuedAt: completion.certificateIssuedAt.toISOString(),
      certificateSource: completion.certificateSource,
      certificateUrl: this.resolvePublicDownloadUrl(
        completion.certificateUrl,
        completion.certificateId!,
      ),
    };
  }

  /** Public PDF download by certificate ID (verify page — no login). */
  async buildVerifiedCertificatePdf(
    certificateId: string,
  ): Promise<{ buffer: Uint8Array; filename: string }> {
    const normalized = certificateId.trim().toUpperCase();
    const completion = await this.prisma.courseCompletion.findUnique({
      where: { certificateId: normalized },
      include: {
        user: { select: { firstName: true, lastName: true, deletedAt: true } },
        course: { select: { title: true } },
        bestAttempt: { select: { percentage: true } },
      },
    });

    if (
      !completion?.certificateIssuedAt ||
      !completion.user ||
      completion.user.deletedAt ||
      !completion.course
    ) {
      throw new NotFoundException('Certificate not found.');
    }

    const issuedAt = completion.certificateIssuedAt;
    const verifyUrl = this.buildVerifyUrl(completion.certificateId!);
    const learnerName =
      `${completion.user.firstName} ${completion.user.lastName}`.trim();

    const buffer = await renderCertificatePdf({
      learnerName,
      courseTitle: completion.course.title,
      issuedAt,
      certificateId: completion.certificateId!,
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

  /** Cloudinary URLs pass through; auth-gated local URLs map to the public verify download. */
  private resolvePublicDownloadUrl(
    storedUrl: string,
    certificateId: string,
  ): string {
    if (storedUrl.includes('res.cloudinary.com')) {
      return storedUrl;
    }
    return `${this.getApiBase()}/api/v1/certificates/verify/${encodeURIComponent(
      certificateId,
    )}/file`;
  }

  /** Records a manually uploaded certificate URL (admin workflow). */
  async recordManualCertificate(
    userId: string,
    courseId: string,
    certificateUrl: string,
    adminId: string,
  ): Promise<ResponseDto> {
    const mode = await this.getCourseIssueMode(courseId);
    if (mode === CertificateIssueMode.NONE) {
      throw new ForbiddenException('This course does not issue certificates.');
    }

    const completion = await this.prisma.courseCompletion.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { certificateId: true },
    });
    if (!completion) {
      throw new NotFoundException('Course completion record not found.');
    }

    const certificateId =
      completion.certificateId ?? (await this.allocateCertificateId());

    const updated = await this.prisma.courseCompletion.update({
      where: { userId_courseId: { userId, courseId } },
      data: {
        certificateUrl,
        certificateId,
        certificateIssuedAt: new Date(),
        certificateSource: CertificateSource.MANUAL,
        certificateIssuedByAdminId: adminId,
      },
    });

    return {
      message: 'Certificate URL saved',
      statusCode: 200,
      data: updated,
    };
  }

  private async getCourseIssueMode(
    courseId: string,
  ): Promise<CertificateIssueMode> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { certificateIssueMode: true },
    });
    if (!course) {
      throw new NotFoundException('Course not found.');
    }
    return course.certificateIssueMode;
  }

  private async assertFeedbackSubmittedForCertificate(
    userId: string,
    courseId: string,
  ): Promise<void> {
    const form = await this.prisma.courseFeedbackForm.findFirst({
      where: { courseId, isActive: true, isRequired: true },
    });
    if (!form) return;

    const submission = await this.prisma.courseFeedbackSubmission.findFirst({
      where: { userId, courseId },
    });
    if (!submission) {
      throw new ForbiddenException(
        'Course feedback is required before accessing the certificate.',
      );
    }
  }

  private async isEligibleForCertificate(
    userId: string,
    courseId: string,
  ): Promise<boolean> {
    const mode = await this.getCourseIssueMode(courseId);
    if (mode !== CertificateIssueMode.AUTO) return false;

    const requiresAssessmentPass =
      await this.courseRequiresAssessmentPass(courseId);

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
    } else if (!completion?.courseCompletedAt) {
      return false;
    }

    const requiredForm = await this.prisma.courseFeedbackForm.findFirst({
      where: { courseId, isActive: true, isRequired: true },
      select: { id: true },
    });
    if (!requiredForm) return true;

    const submission = await this.prisma.courseFeedbackSubmission.findFirst({
      where: { userId, courseId },
      select: { id: true },
    });
    return !!submission;
  }

  /** True when the course has at least one active assessment learners must pass. */
  async courseRequiresAssessmentPass(courseId: string): Promise<boolean> {
    const count = await this.prisma.assessment.count({
      where: { courseId, isActive: true },
    });
    return count > 0;
  }

  /** Streams the certificate PDF for direct download (dev fallback + re-download). */
  async buildStudentCertificatePdf(
    userId: string,
    courseId: string,
  ): Promise<{ buffer: Uint8Array; filename: string; certificateId: string }> {
    await this.assertEligibleForCertificateDownload(userId, courseId);

    const completion = await this.prisma.courseCompletion.findUnique({
      where: { userId_courseId: { userId, courseId } },
      include: {
        bestAttempt: { select: { percentage: true } },
      },
    });
    if (!completion) {
      throw new NotFoundException('Course completion record not found.');
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
      throw new NotFoundException('Certificate could not be generated.');
    }

    const certificateId =
      completion.certificateId ?? (await this.allocateCertificateId());
    const issuedAt = completion.certificateIssuedAt ?? new Date();
    const verifyUrl = this.buildVerifyUrl(certificateId);
    const learnerName = `${user.firstName} ${user.lastName}`.trim();

    const buffer = await renderCertificatePdf({
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

  private async assertEligibleForCertificateDownload(
    userId: string,
    courseId: string,
  ): Promise<void> {
    const mode = await this.getCourseIssueMode(courseId);
    if (mode === CertificateIssueMode.NONE) {
      throw new ForbiddenException('This course does not issue certificates.');
    }

    await this.assertFeedbackSubmittedForCertificate(userId, courseId);

    const requiresAssessmentPass =
      await this.courseRequiresAssessmentPass(courseId);

    const completion = await this.prisma.courseCompletion.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { isPassed: true, courseCompletedAt: true },
    });

    if (requiresAssessmentPass && !completion?.isPassed) {
      throw new ForbiddenException(
        'You must pass the course assessment before accessing your certificate.',
      );
    }

    if (!requiresAssessmentPass && !completion?.courseCompletedAt) {
      throw new ForbiddenException(
        'You must complete the course before accessing your certificate.',
      );
    }
  }

  private async generateAndPersist(
    userId: string,
    courseId: string,
  ): Promise<void> {
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

    if (course?.certificateIssueMode !== CertificateIssueMode.AUTO) {
      return;
    }

    const requiresAssessmentPass =
      await this.courseRequiresAssessmentPass(courseId);

    if (!user || user.deletedAt || !course || !completion) {
      throw new Error('Completion or learner data missing for certificate');
    }

    if (requiresAssessmentPass && !completion.isPassed) {
      throw new Error('Assessment pass required for certificate');
    }

    if (!requiresAssessmentPass && !completion.courseCompletedAt) {
      throw new Error('Course completion required for certificate');
    }

    const certificateId =
      completion.certificateId ?? (await this.allocateCertificateId());
    const issuedAt = new Date();
    const verifyUrl = this.buildVerifyUrl(certificateId);
    const learnerName = `${user.firstName} ${user.lastName}`.trim();

    const pdfBytes = await renderCertificatePdf({
      learnerName,
      courseTitle: course.title,
      issuedAt,
      certificateId,
      verifyUrl,
      scorePct: completion.bestAttempt?.percentage ?? null,
    });

    const publicId = `cert-${certificateId.replace(/[^a-zA-Z0-9-]/g, '')}`;
    const certificateUrl = await this.persistCertificatePdf(
      Buffer.from(pdfBytes),
      publicId,
      certificateId,
    );

    const claimed = await this.prisma.courseCompletion.updateMany({
      where: { userId, courseId, certificateUrl: null },
      data: {
        certificateUrl,
        certificateId,
        certificateIssuedAt: issuedAt,
        certificateSource: CertificateSource.AUTO,
        certificateIssuedByAdminId: null,
      },
    });

    if (claimed.count === 0) return;

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
      to: ADMIN_EMAIL,
      studentName: learnerName,
      studentEmail: user.email ?? 'unknown',
      courseTitle: course.title,
      courseId,
      certificateId,
      certificateUrl,
      verifyUrl,
    });
  }

  private canUseCloudinary(): boolean {
    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET');
    return !!(cloudName && apiKey && apiSecret);
  }

  private isDevelopment(): boolean {
    return this.config.get<string>('NODE_ENV') !== 'production';
  }

  private getApiBase(): string {
    const port = this.config.get<string>('PORT') ?? '3333';
    return (
      this.config.get<string>('APP_BASE_URL')?.replace(/\/$/, '') ??
      `http://localhost:${port}`
    );
  }

  /** Upload to Cloudinary in prod; in local dev without creds, use public verify download. */
  private async persistCertificatePdf(
    buffer: Buffer,
    publicId: string,
    certificateId: string,
  ): Promise<string> {
    if (this.canUseCloudinary()) {
      this.ensureCloudinaryConfigured();
      return uploadCertificatePdf(buffer, publicId);
    }

    if (this.isDevelopment()) {
      CertificateService.logger.warn(
        'Cloudinary is not configured — using public verify download URL for development.',
      );
      return `${this.getApiBase()}/api/v1/certificates/verify/${encodeURIComponent(
        certificateId,
      )}/file`;
    }

    throw new ServiceUnavailableException(
      'Certificate storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
    );
  }

  private ensureCloudinaryConfigured(): void {
    if (this.cloudinaryReady) return;

    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET');

    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException(
        'Certificate storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
      );
    }

    configureCloudinary({ cloudName, apiKey, apiSecret });
    this.cloudinaryReady = true;
  }

  private buildVerifyUrl(certificateId: string): string {
    const base =
      this.config.get<string>('APP_BASE_URL') ??
      'https://www.greenwichtc-elearning.com';
    return `${base.replace(/\/$/, '')}/certificates/verify/${encodeURIComponent(
      certificateId,
    )}`;
  }

  /** Generates a unique GTC-XXXXXXXX id, retrying on collision. */
  async allocateCertificateId(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = randomBytes(4).toString('hex').toUpperCase();
      const certificateId = `GTC-${code}`;
      const exists = await this.prisma.courseCompletion.findUnique({
        where: { certificateId },
        select: { id: true },
      });
      if (!exists) return certificateId;
    }
    throw new Error('Failed to allocate a unique certificate ID');
  }
}
