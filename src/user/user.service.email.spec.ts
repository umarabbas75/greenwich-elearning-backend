import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScormCloudClient } from '../scorm-cloud/scorm-cloud.client';
import { UserService } from './user.service';

describe('UserService.changeUserEmail', () => {
  let service: UserService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    adminAuditLog: { create: jest.Mock };
  };

  const targetUser = {
    id: 'user-1',
    email: 'old@example.com',
    firstName: 'Old',
    lastName: 'User',
    password: 'hash',
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: {} },
        { provide: ScormCloudClient, useValue: {} },
      ],
    }).compile();

    service = module.get(UserService);
  });

  it('updates email and writes audit log', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce({ email: 'admin@example.com' });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.update.mockResolvedValue({
      ...targetUser,
      email: 'new@example.com',
    });

    const result = await service.changeUserEmail(
      'admin-1',
      'user-1',
      ' new@example.com ',
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { email: 'new@example.com' },
    });
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: 'admin-1',
        action: 'USER_EMAIL_CHANGED',
        targetType: 'USER',
        targetId: 'user-1',
        userId: 'user-1',
        metadata: {
          previousEmail: 'old@example.com',
          newEmail: 'new@example.com',
        },
      }),
    });
    const data = result.data as Record<string, unknown>;
    expect(data.requiresReLogin).toBe(true);
    expect(data.previousEmail).toBe('old@example.com');
    expect(data.email).toBe('new@example.com');
    expect(data.password).toBeUndefined();
  });

  it('no-ops when email is unchanged (case-insensitive)', async () => {
    prisma.user.findUnique.mockResolvedValue(targetUser);

    const result = await service.changeUserEmail(
      'admin-1',
      'user-1',
      ' OLD@example.com ',
    );

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    expect(result.message).toBe('Email unchanged');
    expect((result.data as Record<string, unknown>).requiresReLogin).toBe(false);
  });

  it('rejects when email is taken by another active user', async () => {
    prisma.user.findUnique.mockResolvedValue(targetUser);
    prisma.user.findFirst.mockResolvedValue({
      id: 'other',
      email: 'taken@example.com',
      deletedAt: null,
    });

    await expect(
      service.changeUserEmail('admin-1', 'user-1', 'taken@example.com'),
    ).rejects.toMatchObject({
      getStatus: expect.any(Function),
      response: { status: 409, error: 'User already exists in the system' },
    });
  });

  it('returns 404 when target user is not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.changeUserEmail('admin-1', 'missing', 'new@example.com'),
    ).rejects.toMatchObject({
      response: { status: 404, error: 'User not found' },
    });
  });

  it('rejects when email belongs to a soft-deleted account', async () => {
    prisma.user.findUnique.mockResolvedValue(targetUser);
    prisma.user.findFirst.mockResolvedValue({
      id: 'deleted',
      email: 'ghost@example.com',
      deletedAt: new Date(),
    });

    await expect(
      service.changeUserEmail('admin-1', 'user-1', 'ghost@example.com'),
    ).rejects.toMatchObject({
      response: {
        status: 409,
        error: expect.stringMatching(/previously deleted account/i),
      },
    });
  });
});
