import { NotificationType } from '@prisma/client';
import { NotificationService } from './notification.service';

describe('NotificationService admin inbox copy', () => {
  const ADMIN_INBOX = 'info@example.com';
  let prisma: Record<string, any>;
  let mail: { sendNotificationEmail: jest.Mock };
  let service: NotificationService;

  const email = {
    build: (recipient: { id: string; email: string }) => ({
      kind: 'REGISTRATION_SUBMITTED',
      to: recipient.email,
      userId: recipient.id || null,
    }),
  };

  beforeEach(() => {
    prisma = {
      notification: {
        createMany: jest.fn(),
        findMany: jest.fn(),
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'admin-1', email: 'admin@example.com', firstName: 'Ada' },
          ]),
      },
    };
    mail = { sendNotificationEmail: jest.fn().mockResolvedValue(undefined) };
    service = new NotificationService(prisma as never, mail as never);
  });

  const sentTo = () =>
    mail.sendNotificationEmail.mock.calls.map(([message]) => message.to);

  describe('createNotificationForMany', () => {
    const input = {
      userIds: ['admin-1'],
      emailCcAddresses: [ADMIN_INBOX],
      type: NotificationType.REGISTRATION_SUBMITTED,
      message: 'Jane submitted a registration form',
      dedupeKeyFor: (adminId: string) =>
        `registration-submitted:cf-1:u-1:${adminId}`,
      email: email as never,
    };

    it('emails the recipients and the admin inbox for a new notification', async () => {
      prisma.notification.createMany.mockResolvedValue({ count: 1 });
      prisma.notification.findMany.mockResolvedValue([{ userId: 'admin-1' }]);

      await service.createNotificationForMany(input);

      expect(sentTo().sort()).toEqual(
        ['admin@example.com', ADMIN_INBOX].sort(),
      );
    });

    it('does not re-mail the admin inbox when every row was a dedupe no-op', async () => {
      prisma.notification.createMany.mockResolvedValue({ count: 0 });

      await service.createNotificationForMany(input);

      expect(mail.sendNotificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('createNotification', () => {
    const input = {
      userId: 'admin-1',
      emailCcAddresses: [ADMIN_INBOX],
      type: NotificationType.REGISTRATION_SUBMITTED,
      message: 'Jane submitted an assessment',
      dedupeKey: 'assessment-submitted:a-1',
      email: email as never,
    };

    it('copies the admin inbox for a new notification', async () => {
      prisma.notification.createMany.mockResolvedValue({ count: 1 });

      await service.createNotification(input);

      expect(sentTo().sort()).toEqual(
        ['admin@example.com', ADMIN_INBOX].sort(),
      );
    });

    it('sends nothing on a dedupe no-op', async () => {
      prisma.notification.createMany.mockResolvedValue({ count: 0 });

      await service.createNotification(input);

      expect(mail.sendNotificationEmail).not.toHaveBeenCalled();
    });
  });
});
