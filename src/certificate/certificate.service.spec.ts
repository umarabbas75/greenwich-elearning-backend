import { NotFoundException } from '@nestjs/common';
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
