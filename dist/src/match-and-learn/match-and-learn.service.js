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
exports.MatchAndLearnService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let MatchAndLearnService = class MatchAndLearnService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createMatchAndLearn(body) {
        try {
            if (body.chapterId) {
                const chapter = await this.prisma.chapter.findUnique({
                    where: { id: body.chapterId },
                });
                if (!chapter) {
                    throw new Error('Chapter not found');
                }
            }
            const categories = [
                ...new Set(body.items.map((item) => item.correctCategory)),
            ];
            const matchAndLearn = await this.prisma.matchAndLearn.create({
                data: {
                    title: body.title,
                    itemLabel: body.itemLabel,
                    categoryLabel: body.categoryLabel,
                    chapterId: body.chapterId,
                    orderIndex: body.orderIndex ?? '0',
                    maxPerCategory: Number(body.maxPerCategory ?? 1),
                    categories: categories,
                    items: {
                        create: body.items.map((item) => ({
                            name: item.name,
                            correctCategory: item.correctCategory,
                        })),
                    },
                },
                include: {
                    items: true,
                },
            });
            return {
                message: 'Successfully created match and learn activity',
                statusCode: 200,
                data: matchAndLearn,
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
    async getAllMatchAndLearn(chapterId) {
        try {
            const where = chapterId ? { chapterId } : {};
            const activities = await this.prisma.matchAndLearn.findMany({
                where,
                include: {
                    items: true,
                },
                orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
            });
            return {
                message: 'Successfully retrieved match and learn activities',
                statusCode: 200,
                data: activities,
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
    async getMatchAndLearnById(id) {
        try {
            const activity = await this.prisma.matchAndLearn.findUnique({
                where: { id },
                include: {
                    items: true,
                    chapter: {
                        select: {
                            id: true,
                            title: true,
                            description: true,
                        },
                    },
                },
            });
            if (!activity) {
                throw new Error('Match and learn activity not found');
            }
            return {
                message: 'Successfully retrieved match and learn activity',
                statusCode: 200,
                data: activity,
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
    async updateMatchAndLearn(id, body) {
        try {
            const activity = await this.prisma.matchAndLearn.findUnique({
                where: { id },
            });
            if (!activity) {
                throw new Error('Match and learn activity not found');
            }
            if (Object.keys(body).length === 0) {
                throw new Error('No update data provided');
            }
            const { items, ...updateData } = body;
            let updateQuery = {
                where: { id },
                data: {
                    ...updateData,
                    orderIndex: updateData.orderIndex ?? undefined,
                    maxPerCategory: updateData.maxPerCategory
                        ? Number(updateData.maxPerCategory)
                        : undefined,
                },
            };
            if (items && items.length > 0) {
                await this.prisma.matchAndLearnItem.deleteMany({
                    where: { matchAndLearnId: id },
                });
                updateQuery.data.items = {
                    create: items.map((item) => ({
                        name: item.name,
                        correctCategory: item.correctCategory,
                    })),
                };
            }
            const updatedActivity = await this.prisma.matchAndLearn.update(updateQuery);
            return {
                message: 'Successfully updated match and learn activity',
                statusCode: 200,
                data: updatedActivity,
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
    async deleteMatchAndLearn(id) {
        try {
            const activity = await this.prisma.matchAndLearn.findUnique({
                where: { id },
            });
            if (!activity) {
                throw new Error('Match and learn activity not found');
            }
            await this.prisma.matchAndLearn.delete({
                where: { id },
            });
            return {
                message: 'Successfully deleted match and learn activity',
                statusCode: 200,
                data: activity,
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
    async submitMatchAndLearnCompletion(userId, matchAndLearnId, chapterId, userAnswers) {
        try {
            const activity = await this.prisma.matchAndLearn.findUnique({
                where: { id: matchAndLearnId },
                include: {
                    items: true,
                },
            });
            if (!activity) {
                throw new Error('Match and learn activity not found');
            }
            let correctMatches = 0;
            activity.items.forEach((item) => {
                const userAnswer = userAnswers[item.id];
                if (userAnswer === item.correctCategory) {
                    correctMatches++;
                }
            });
            const isCompleted = correctMatches === activity.items.length;
            const progress = await this.prisma.matchAndLearnProgress.upsert({
                where: {
                    userId_chapterId_matchAndLearnId: {
                        userId,
                        chapterId,
                        matchAndLearnId,
                    },
                },
                create: {
                    userId,
                    chapterId,
                    matchAndLearnId,
                    isCompleted,
                    totalItems: activity.items.length,
                    correctMatches,
                    completedAt: isCompleted ? new Date() : null,
                },
                update: {
                    isCompleted,
                    correctMatches,
                    completedAt: isCompleted ? new Date() : undefined,
                },
            });
            return {
                message: 'Successfully submitted match and learn completion',
                statusCode: 200,
                data: {
                    progress,
                    score: correctMatches,
                    totalItems: activity.items.length,
                    isCompleted,
                },
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
    async getUserProgress(userId, chapterId) {
        try {
            const where = { userId };
            if (chapterId) {
                where.chapterId = chapterId;
            }
            const progress = await this.prisma.matchAndLearnProgress.findMany({
                where,
                include: {
                    matchAndLearn: {
                        include: {
                            items: true,
                        },
                    },
                },
            });
            return {
                message: 'Successfully retrieved user progress',
                statusCode: 200,
                data: progress,
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
exports.MatchAndLearnService = MatchAndLearnService;
exports.MatchAndLearnService = MatchAndLearnService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], MatchAndLearnService);
//# sourceMappingURL=match-and-learn.service.js.map