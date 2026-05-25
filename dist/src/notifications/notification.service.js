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
const NOTIFICATION_INCLUDE = {
    thread: { select: { title: true } },
    commenter: {
        select: { id: true, firstName: true, lastName: true, photo: true },
    },
};
let NotificationService = NotificationService_1 = class NotificationService {
    constructor(prisma) {
        this.prisma = prisma;
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
        await this.prisma.notification.createMany({
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
    }
    async createNotificationForMany(input) {
        if (input.userIds.length === 0)
            return;
        await this.prisma.notification.createMany({
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
    }
    async notifyAllUsersForNewThread(args) {
        const users = await this.prisma.user.findMany({ select: { id: true } });
        await this.createNotificationForMany({
            userIds: users.map((u) => u.id),
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
        });
    }
};
exports.NotificationService = NotificationService;
NotificationService.DEFAULT_LIMIT = 20;
NotificationService.MAX_LIMIT = 50;
exports.NotificationService = NotificationService = NotificationService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], NotificationService);
//# sourceMappingURL=notification.service.js.map