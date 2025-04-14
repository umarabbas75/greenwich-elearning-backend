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
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let NotificationService = class NotificationService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getUserNotifications(userId) {
        try {
            const notifications = await this.prisma.notification.findMany({
                where: {
                    userId: userId,
                },
                orderBy: {
                    createdAt: 'desc',
                },
                include: {
                    thread: {
                        select: {
                            title: true,
                        },
                    },
                    commenter: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            photo: true,
                        },
                    },
                },
            });
            return {
                message: 'Successfully fetched all notifications for the user',
                statusCode: 200,
                data: notifications,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async notifyAllUsersForNewThread(threadId, commenterId) {
        try {
            const users = await this.prisma.user.findMany({
                select: {
                    id: true,
                },
            });
            const notifications = users.map((user) => ({
                userId: user.id,
                threadId,
                commenterId,
                message: 'A new thread has been created by the admin.',
            }));
            await this.prisma.notification.createMany({
                data: notifications,
            });
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async markNotificationAsRead(notificationId) {
        try {
            const updatedNotification = await this.prisma.notification.update({
                where: { id: notificationId },
                data: { isRead: true },
            });
            return {
                message: 'Notification marked as read successfully',
                statusCode: 200,
                data: updatedNotification,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
};
exports.NotificationService = NotificationService;
exports.NotificationService = NotificationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], NotificationService);
//# sourceMappingURL=notification.service.js.map