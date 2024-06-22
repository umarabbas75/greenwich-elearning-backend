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
exports.ForumCommentService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let ForumCommentService = class ForumCommentService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createForumThreadComment(body, userId) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                throw new Error('User not found');
            }
            const thread = await this.prisma.forumThread.findUnique({
                where: { id: body?.threadId },
            });
            if (!thread) {
                throw new Error('Forum thread not found');
            }
            await this.prisma.forumComment.create({
                data: {
                    content: body?.content,
                    user: { connect: { id: userId } },
                    thread: { connect: { id: body.threadId } },
                },
            });
            const subscribedUsers = await this.prisma.threadSubscription.findMany({
                where: {
                    threadId: body.threadId,
                    userId: { not: userId },
                },
                select: {
                    userId: true,
                },
            });
            const notifications = subscribedUsers.map((sub) => ({
                userId: sub.userId,
                threadId: body.threadId,
                message: body.content,
                commenterId: userId,
            }));
            console.log({ notifications, subscribedUsers });
            await this.prisma.notification.createMany({
                data: notifications,
            });
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
    async getForumCommentsByThreadId(threadId) {
        console.log({ threadId });
        const comments = await this.prisma.forumComment.findMany({
            orderBy: {
                createdAt: 'desc',
            },
            where: {
                threadId,
            },
            include: {
                user: true,
            },
        });
        return {
            message: 'Successfully fetch all forum comments',
            statusCode: 200,
            data: comments,
        };
    }
    async getAllForumThreads() {
        try {
            const forums = await this.prisma.forumThread.findMany({
                orderBy: {
                    createdAt: 'desc',
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                },
            });
            return {
                message: 'Successfully fetch all forum threads',
                statusCode: 200,
                data: forums,
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
    async updateForumThreadComment(forumThreadId, body) {
        try {
            const existingForumThread = await this.prisma.forumComment.findUnique({
                where: { id: forumThreadId },
            });
            if (!existingForumThread) {
                throw new Error('Forum comment not found');
            }
            if (Object.entries(body).length === 0) {
                throw new Error('wrong keys');
            }
            const updateForumThread = {};
            for (const [key, value] of Object.entries(body)) {
                updateForumThread[key] = value;
            }
            const updatedForumThread = await this.prisma.forumComment.update({
                where: { id: forumThreadId },
                data: updateForumThread,
            });
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
    async deleteForumThreadComment(forumThreadId) {
        try {
            const quiz = await this.prisma.forumComment.findUnique({
                where: { id: forumThreadId },
            });
            if (!quiz) {
                throw new Error('Forum Thread not found');
            }
            await this.prisma.forumComment.delete({
                where: { id: forumThreadId },
            });
            return {
                message: 'Successfully deleted forum thread comment record',
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
exports.ForumCommentService = ForumCommentService;
exports.ForumCommentService = ForumCommentService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ForumCommentService);
//# sourceMappingURL=forum-comment.service.js.map