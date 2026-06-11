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
var NotificationService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const mail_service_1 = require("../mail/mail.service");
const mail_layout_1 = require("../mail/templates/mail-layout");
const NOTIFICATION_INCLUDE = {
    thread: { select: { title: true } },
    commenter: {
        select: { id: true, firstName: true, lastName: true, photo: true },
    },
};
let NotificationService = NotificationService_1 = class NotificationService {
    constructor(prisma, mail) {
        this.prisma = prisma;
        this.mail = mail;
    }
    async listNotifications(userId, params) {
        const limit = Math.min(Math.max(params.limit ?? NotificationService_1.DEFAULT_LIMIT, 1), NotificationService_1.MAX_LIMIT);
        const where = { userId };
        if (params.filter === 'unread')
            where.readAt = null;
        if (params.type)
            where.type = params.type;
        const findArgs = {
            where,
            include: NOTIFICATION_INCLUDE,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
        };
        if (params.cursor) {
            findArgs.cursor = { id: params.cursor };
            findArgs.skip = 1;
        }
        const rows = await this.prisma.notification.findMany(findArgs);
        const [counts] = await this.prisma.$queryRaw `
      SELECT
        COUNT(*) FILTER (WHERE "readAt" IS NULL) AS unread,
        COUNT(*) FILTER (WHERE "seenAt" IS NULL) AS unseen
      FROM "notifications"
      WHERE "userId" = ${userId}
    `;
        const hasMore = rows.length > limit;
        const data = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore ? data[data.length - 1].id : null;
        return {
            message: 'Notifications fetched successfully',
            statusCode: 200,
            data: {
                data,
                nextCursor,
                unreadCount: Number(counts.unread),
                unseenCount: Number(counts.unseen),
            },
        };
    }
    async getCounts(userId) {
        const [counts] = await this.prisma.$queryRaw `
      SELECT
        COUNT(*) FILTER (WHERE "readAt" IS NULL) AS unread,
        COUNT(*) FILTER (WHERE "seenAt" IS NULL) AS unseen
      FROM "notifications"
      WHERE "userId" = ${userId}
    `;
        return {
            message: 'Counts fetched successfully',
            statusCode: 200,
            data: {
                unread: Number(counts.unread),
                unseen: Number(counts.unseen),
            },
        };
    }
    async markOneAsRead(notificationId, userId) {
        const now = new Date();
        const result = await this.prisma.$executeRaw `
      UPDATE "notifications"
         SET "readAt" = ${now},
             "seenAt" = COALESCE("seenAt", ${now}),
             "updatedAt" = ${now}
       WHERE "id" = ${notificationId}
         AND "userId" = ${userId}
    `;
        if (result === 0) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error: 'Notification not found' }, common_1.HttpStatus.NOT_FOUND);
        }
        return {
            message: 'Notification marked as read successfully',
            statusCode: 200,
            data: {
                id: notificationId,
                readAt: now.toISOString(),
                seenAt: now.toISOString(),
            },
        };
    }
    async markAllAsRead(userId) {
        const now = new Date();
        const updated = await this.prisma.$executeRaw `
      UPDATE "notifications"
         SET "readAt" = ${now},
             "seenAt" = COALESCE("seenAt", ${now}),
             "updatedAt" = ${now}
       WHERE "userId" = ${userId}
         AND "readAt" IS NULL
    `;
        return {
            message: 'All notifications marked as read',
            statusCode: 200,
            data: { updated },
        };
    }
    async markAllAsSeen(userId) {
        const now = new Date();
        const result = await this.prisma.notification.updateMany({
            where: { userId, seenAt: null },
            data: { seenAt: now },
        });
        return {
            message: 'All notifications marked as seen',
            statusCode: 200,
            data: { updated: result.count },
        };
    }
    async createNotification(input) {
        const result = await this.prisma.notification.createMany({
            data: [
                {
                    userId: input.userId,
                    type: input.type,
                    message: input.message,
                    payload: input.payload ?? undefined,
                    groupKey: input.groupKey ?? null,
                    dedupeKey: input.dedupeKey ?? null,
                    referenceId: input.referenceId ?? null,
                    threadId: input.threadId ?? null,
                    commenterId: input.commenterId ?? null,
                },
            ],
            skipDuplicates: true,
        });
        if (input.email && result.count > 0) {
            await this.dispatchNotificationEmails([input.userId], input.email);
        }
    }
    async createNotificationForMany(input) {
        if (input.userIds.length === 0)
            return;
        const result = await this.prisma.notification.createMany({
            data: input.userIds.map((userId) => ({
                userId,
                type: input.type,
                message: input.message,
                payload: input.payload ?? undefined,
                groupKey: input.groupKey ?? null,
                dedupeKey: input.dedupeKeyFor ? input.dedupeKeyFor(userId) : null,
                referenceId: input.referenceId ?? null,
                threadId: input.threadId ?? null,
                commenterId: input.commenterId ?? null,
            })),
            skipDuplicates: true,
        });
        if (!input.email)
            return;
        let recipients = result.count > 0 ? input.userIds : [];
        if (result.count > 0 && input.dedupeKeyFor) {
            const keys = input.userIds
                .map((u) => input.dedupeKeyFor(u))
                .filter((k) => !!k);
            if (keys.length > 0) {
                const fresh = await this.prisma.notification.findMany({
                    where: {
                        dedupeKey: { in: keys },
                        createdAt: { gte: new Date(Date.now() - 5 * 60000) },
                    },
                    select: { userId: true },
                });
                const freshIds = new Set(fresh.map((r) => r.userId));
                recipients = input.userIds.filter((u) => freshIds.has(u));
            }
        }
        if (recipients.length === 0 && !input.emailCcAddresses?.length)
            return;
        await this.dispatchNotificationEmails(recipients, input.email, input.emailCcAddresses);
    }
    async dispatchNotificationEmails(userIds, directive, ccAddresses = []) {
        try {
            const targets = userIds.filter((id) => id && id !== directive.excludeUserId);
            const users = targets.length
                ? await this.prisma.user.findMany({
                    where: { id: { in: targets }, deletedAt: null },
                    select: { id: true, email: true, firstName: true },
                })
                : [];
            const emails = users
                .map((u) => u.email
                ? directive.build({
                    id: u.id,
                    email: u.email,
                    firstName: u.firstName ?? '',
                })
                : null)
                .filter((m) => m !== null);
            const resolvedTo = new Set(emails.map((m) => m.to));
            for (const addr of new Set(ccAddresses)) {
                if (!addr || resolvedTo.has(addr))
                    continue;
                const built = directive.build({ id: '', email: addr, firstName: '' });
                if (built)
                    emails.push(built);
            }
            if (emails.length === 0)
                return;
            for (let i = 0; i < emails.length; i += NotificationService_1.EMAIL_BATCH) {
                const batch = emails.slice(i, i + NotificationService_1.EMAIL_BATCH);
                await Promise.all(batch.map((m) => this.mail.sendNotificationEmail(m)));
                if (i + NotificationService_1.EMAIL_BATCH < emails.length) {
                    await new Promise((r) => setTimeout(r, NotificationService_1.EMAIL_BATCH_PAUSE_MS));
                }
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            NotificationService_1.logger.warn(`Notification email dispatch failed (best-effort): ${message}`);
        }
    }
    async notifyAllUsersForNewThread(args) {
        const users = await this.prisma.user.findMany({
            where: args.courseId
                ? {
                    UserCourse: { some: { courseId: args.courseId, isActive: true } },
                }
                : undefined,
            select: { id: true },
        });
        const creatorName = `${args.creator.firstName} ${args.creator.lastName}`.trim();
        await this.createNotificationForMany({
            userIds: users.map((u) => u.id),
            emailCcAddresses: [mail_layout_1.ADMIN_EMAIL],
            type: client_1.NotificationType.FORUM_THREAD,
            message: 'A new thread has been created by the admin.',
            payload: {
                threadId: args.threadId,
                threadTitle: args.threadTitle,
                creatorFirstName: args.creator.firstName,
                creatorLastName: args.creator.lastName,
            },
            groupKey: null,
            threadId: args.threadId,
            commenterId: args.creator.id,
            dedupeKeyFor: (userId) => `thread-created:${args.threadId}:${userId}`,
            email: {
                excludeUserId: args.creator.id,
                build: (r) => ({
                    kind: 'FORUM_THREAD',
                    to: r.email,
                    userId: r.id,
                    recipientFirstName: r.firstName,
                    threadId: args.threadId,
                    threadTitle: args.threadTitle,
                    creatorName,
                }),
            },
        });
    }
};
exports.NotificationService = NotificationService;
NotificationService.DEFAULT_LIMIT = 20;
NotificationService.MAX_LIMIT = 50;
NotificationService.logger = new common_1.Logger(NotificationService_1.name);
NotificationService.EMAIL_BATCH = 2;
NotificationService.EMAIL_BATCH_PAUSE_MS = 1100;
exports.NotificationService = NotificationService = NotificationService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        mail_service_1.MailService])
], NotificationService);
//# sourceMappingURL=notification.service.js.map