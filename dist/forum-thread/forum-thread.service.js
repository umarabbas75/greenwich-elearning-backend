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
exports.ForumThreadService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const client_1 = require("@prisma/client");
let ForumThreadService = class ForumThreadService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async subscribeForumThread(body, userId) {
        try {
            const subscribe = await this.prisma.threadSubscription.create({
                data: {
                    userId,
                    threadId: body.threadId,
                },
            });
            return {
                message: 'Successfully subscribe the thread for user',
                statusCode: 200,
                data: subscribe,
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
    async unSubscribeForumThread(params, userId) {
        try {
            const subscribe = await this.prisma.threadSubscription.delete({
                where: {
                    userId_threadId: {
                        userId,
                        threadId: params.id,
                    },
                },
            });
            return {
                message: 'Successfully unsubscribe the thread for user',
                statusCode: 200,
                data: subscribe,
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
    async createFavoriteForumThread(body, userId) {
        try {
            const favorite = await this.prisma.favoriteForumThread.create({
                data: {
                    userId,
                    threadId: body.threadId,
                },
            });
            return {
                message: 'Successfully favorite the thread for user',
                statusCode: 200,
                data: favorite,
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
    async unFavoriteForumThread(params, userId) {
        try {
            const favorite = await this.prisma.favoriteForumThread.delete({
                where: {
                    userId_threadId: {
                        userId,
                        threadId: params.id,
                    },
                },
            });
            return {
                message: 'Successfully unfavorite the thread for user',
                statusCode: 200,
                data: favorite,
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
    async getAllForumThreads(user) {
        try {
            const [favoriteThreads, subscribedThreads, forums] = await Promise.all([
                this.prisma.favoriteForumThread.findMany({
                    where: {
                        userId: user.id,
                    },
                    select: {
                        threadId: true,
                    },
                }),
                this.prisma.threadSubscription.findMany({
                    where: {
                        userId: user.id,
                    },
                    select: {
                        threadId: true,
                    },
                }),
                this.prisma.forumThread.findMany({
                    orderBy: {
                        createdAt: 'desc',
                    },
                    include: {
                        user: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                photo: true,
                            },
                        },
                        ForumComment: {
                            select: {
                                id: true,
                                user: {
                                    select: {
                                        id: true,
                                        firstName: true,
                                        lastName: true,
                                        photo: true,
                                    },
                                },
                                createdAt: true,
                            },
                            orderBy: {
                                createdAt: client_1.Prisma.SortOrder.desc,
                            },
                        },
                    },
                    where: user?.role === 'user' ? { status: 'active' } : undefined,
                }),
            ]);
            const favoriteThreadIds = new Set(favoriteThreads.map((fav) => fav.threadId));
            const subscribedThreadIds = new Set(subscribedThreads.map((sub) => sub.threadId));
            const sortedForums = forums
                .map((thread) => ({
                ...thread,
                isFavorite: favoriteThreadIds.has(thread.id),
                isSubscribed: subscribedThreadIds.has(thread.id),
            }))
                .sort((a, b) => {
                if (a.isFavorite && !b.isFavorite) {
                    return -1;
                }
                if (!a.isFavorite && b.isFavorite) {
                    return 1;
                }
                return 0;
            });
            return {
                message: 'Successfully fetched all forum threads',
                statusCode: 200,
                data: sortedForums,
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
    async createForumThread(body, userId) {
        try {
            const newThread = await this.prisma.forumThread.create({
                data: {
                    title: body.title,
                    content: body.content,
                    userId: userId,
                    status: 'inActive',
                },
            });
            console.log({ newThread });
            return {
                message: 'Successfully create quiz record',
                statusCode: 200,
                data: {},
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
    async updateForumThread(forumThreadId, body, userId) {
        try {
            const existingForumThread = await this.prisma.forumThread.findUnique({
                where: { id: forumThreadId },
            });
            if (!existingForumThread) {
                throw new Error('Forum thread not found');
            }
            if (Object.entries(body).length === 0) {
                throw new Error('wrong keys');
            }
            const updateForumThread = {};
            for (const [key, value] of Object.entries(body)) {
                updateForumThread[key] = value;
            }
            const statusChangingToActive = existingForumThread.status === 'inActive' &&
                updateForumThread['status'] === 'active';
            const shouldSendNotification = statusChangingToActive && !existingForumThread.notificationSent;
            if (shouldSendNotification) {
                updateForumThread['notificationSent'] = true;
            }
            const updatedForumThread = await this.prisma.forumThread.update({
                where: { id: forumThreadId },
                data: updateForumThread,
            });
            if (shouldSendNotification) {
                try {
                    const users = await this.prisma.user.findMany({
                        select: {
                            id: true,
                        },
                    });
                    const notifications = users.map((user) => ({
                        userId: user.id,
                        threadId: forumThreadId,
                        commenterId: userId,
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
            return {
                message: 'Successfully updated forum record',
                statusCode: 200,
                data: updatedForumThread,
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
    async deleteForumThread(forumThreadId) {
        try {
            const quiz = await this.prisma.forumThread.findUnique({
                where: { id: forumThreadId },
            });
            if (!quiz) {
                throw new Error('Forum Thread not found');
            }
            await this.prisma.forumThread.delete({
                where: { id: forumThreadId },
            });
            return {
                message: 'Successfully deleted forum thread record',
                statusCode: 200,
                data: {},
            };
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2003') {
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.FORBIDDEN,
                    error: 'Cannot delete it because it is associated with other records.',
                }, common_1.HttpStatus.FORBIDDEN);
            }
            else {
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.FORBIDDEN,
                    error: error?.message || 'Something went wrong',
                }, common_1.HttpStatus.FORBIDDEN, {
                    cause: error,
                });
            }
        }
    }
    async getForumThread(forumThreadId) {
        try {
            const forum = await this.prisma.forumThread.findUnique({
                where: { id: forumThreadId },
                include: {
                    user: {
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
                message: 'Successfully fetch Quiz info',
                statusCode: 200,
                data: forum,
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
};
exports.ForumThreadService = ForumThreadService;
exports.ForumThreadService = ForumThreadService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ForumThreadService);
//# sourceMappingURL=forum-thread.service.js.map