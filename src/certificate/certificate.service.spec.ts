import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CertificateService } from './certificate.service';

describe('CertificateService.verifyCertificate', () => {
  const prisma = {
    courseCompletion: { findUnique: jest.fn() },
  };
  const mail = {};
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'PUBLIC_FRONTEND_URL') {
        return 'https://www.greenwichtc-elearning.com';
      }
      return undefined;
    }),
  };

  const service = new CertificateService(
    prisma as never,
    mail as never,
    config as unknown as ConfigService,
    { createNotification: jest.fn() } as never,
  );

  beforeEach(() => {
    prisma.courseCompletion.findUnique.mockReset();
  });

  it('is case-insensitive', async () => {
    prisma.courseCompletion.findUnique.mockResolvedValue({
      certificateUrl: 'https://cdn.example/cert.pdf',
      certificateIssuedAt: new Date('2026-09-01T00:00:00.000Z'),
      certificateId: 'GTC-A1B2C3D4',
      certificateSource: 'AUTO',
      user: { firstName: 'Jane', lastName: 'Doe', deletedAt: null },
      course: { title: 'Fire Safety' },
    });

    const result = await service.verifyCertificate('gtc-a1b2c3d4');

    expect(prisma.courseCompletion.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { certificateId: 'GTC-A1B2C3D4' },
      }),
    );
    expect(result).toMatchObject({
      valid: true,
      certificateId: 'GTC-A1B2C3D4',
      learnerName: 'Jane Doe',
      courseTitle: 'Fire Safety',
      verifyUrl:
        'https://www.greenwichtc-elearning.com/certificates/verify/GTC-A1B2C3D4',
    });
  });

  it('404s for an unknown id with no extra detail', async () => {
    prisma.courseCompletion.findUnique.mockResolvedValue(null);

    await expect(service.verifyCertificate('GTC-DEADBEEF')).rejects.toThrow(
      new NotFoundException('Certificate not found.'),
    );
  });

  it('404s for a malformed id', async () => {
    await expect(service.verifyCertificate('nope')).rejects.toThrow(
      new NotFoundException('Certificate not found.'),
    );
    expect(prisma.courseCompletion.findUnique).not.toHaveBeenCalled();
  });

  it('404s when the learner record is deleted (revoked)', async () => {
    prisma.courseCompletion.findUnique.mockResolvedValue({
      certificateUrl: 'https://cdn.example/cert.pdf',
      certificateIssuedAt: new Date('2026-09-01T00:00:00.000Z'),
      certificateId: 'GTC-A1B2C3D4',
      user: { firstName: 'Jane', lastName: 'Doe', deletedAt: new Date() },
      course: { title: 'Fire Safety' },
    });

    await expect(service.verifyCertificate('GTC-A1B2C3D4')).rejects.toThrow(
      new NotFoundException('Certificate not found.'),
    );
  });
});

describe('CertificateService.getLearnerEligibility', () => {
  const prisma = {
    courseCompletion: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
  };

  const service = new CertificateService(
    prisma as never,
    {} as never,
    { get: jest.fn() } as unknown as ConfigService,
    { createNotification: jest.fn() } as never,
  );

  beforeEach(() => {
    prisma.$queryRaw.mockReset();
  });

  it('uses one EXISTS round-trip and is true when a cert is issued', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { hasIssued: true, hasIssuingEnrollment: false },
    ]);

    const result = await service.getLearnerEligibility('user-1');

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      statusCode: 200,
      data: { eligible: true },
    });
  });

  it('is true when enrolled on an issuing course with no cert yet', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { hasIssued: false, hasIssuingEnrollment: true },
    ]);

    const result = await service.getLearnerEligibility('user-1');

    expect(result.data).toEqual({ eligible: true });
  });

  it('is false when the learner cannot earn or already hold a cert', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { hasIssued: false, hasIssuingEnrollment: false },
    ]);

    const result = await service.getLearnerEligibility('user-1');

    expect(result.data).toEqual({ eligible: false });
  });
});

describe('CertificateService.getStudentCertificate after a rule change', () => {
  const prisma = {
    courseCompletion: { findUnique: jest.fn() },
    course: { findUnique: jest.fn() },
    courseFeedbackForm: { findFirst: jest.fn() },
    courseFeedbackSubmission: { findFirst: jest.fn() },
    assessment: { count: jest.fn() },
  };
  const config = { get: jest.fn() };
  const service = new CertificateService(
    prisma as never,
    {} as never,
    config as unknown as ConfigService,
    { createNotification: jest.fn() } as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.assessment.count.mockResolvedValue(0);
    prisma.courseFeedbackSubmission.findFirst.mockResolvedValue(null);
    prisma.courseFeedbackForm.findFirst.mockResolvedValue({
      requiredSince: new Date('2026-10-17T07:21:51.013Z'),
    });
  });

  it('still returns an issued certificate after feedback became required and issuing was switched off', async () => {
    prisma.courseCompletion.findUnique.mockResolvedValue({
      certificateUrl: 'https://cdn.example/cert.pdf',
      certificateId: null,
      certificateIssuedAt: new Date('2026-09-01T00:00:00.000Z'),
      certificateSource: 'MANUAL',
    });
    prisma.course.findUnique.mockResolvedValue({
      certificateIssueMode: 'NONE',
    });

    const result = await service.getStudentCertificate('user-1', 'course-1');

    expect((result.data as any).certificateUrl).toBe(
      'https://cdn.example/cert.pdf',
    );
    expect(prisma.courseFeedbackForm.findFirst).not.toHaveBeenCalled();
  });

  it('does not ask for feedback from a learner who completed before it became required', async () => {
    prisma.courseCompletion.findUnique.mockResolvedValue({
      certificateUrl: null,
      courseCompletedAt: new Date('2026-06-08T10:00:00.000Z'),
      isPassed: false,
    });
    prisma.course.findUnique.mockResolvedValue({
      certificateIssueMode: 'MANUAL',
    });

    // Past the feedback check, a MANUAL course without an uploaded
    // certificate reports it as pending.
    await expect(
      service.getStudentCertificate('user-1', 'course-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('still asks for feedback from a learner who completed after it became required', async () => {
    prisma.courseCompletion.findUnique.mockResolvedValue({
      certificateUrl: null,
      courseCompletedAt: new Date('2026-10-18T10:00:00.000Z'),
      isPassed: false,
    });
    prisma.course.findUnique.mockResolvedValue({
      certificateIssueMode: 'MANUAL',
    });

    await expect(
      service.getStudentCertificate('user-1', 'course-1'),
    ).rejects.toThrow(
      new ForbiddenException(
        'Course feedback is required before accessing the certificate.',
      ),
    );
  });
});
