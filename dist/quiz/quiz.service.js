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
exports.QuizService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let QuizService = class QuizService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getQuiz(id, role) {
        try {
            let quiz = {};
            if (role == 'admin') {
                quiz = await this.prisma.quiz.findUnique({ where: { id } });
            }
            else if (role == 'user') {
                quiz = await this.prisma.quiz.findUnique({
                    where: { id },
                    select: {
                        id: true,
                        question: true,
                        options: true,
                    },
                });
            }
            return {
                message: 'Successfully fetch Quiz info',
                statusCode: 200,
                data: quiz,
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
    async getAllQuizzes(role) {
        try {
            let quizzes = [];
            if (role == 'admin') {
                quizzes = await this.prisma.quiz.findMany({
                    orderBy: {
                        createdAt: 'desc'
                    }
                });
            }
            else if (role == 'user') {
                quizzes = await this.prisma.quiz.findMany({
                    orderBy: {
                        createdAt: 'desc'
                    },
                    select: {
                        id: true,
                        question: true,
                        options: true,
                    },
                });
            }
            return {
                message: 'Successfully fetch all Quizzes info',
                statusCode: 200,
                data: quizzes,
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
    async getAllAssignQuizzes(chapterId, role) {
        try {
            let chapter;
            chapter = await this.prisma.chapter.findUnique({
                where: {
                    id: chapterId,
                },
                include: {
                    quizzes: {
                        select: {
                            id: true,
                            question: true,
                            options: true,
                            answer: true
                        },
                    },
                },
            });
            return {
                message: 'Successfully fetch all Quizzes info related to chapter',
                statusCode: 200,
                data: chapter?.quizzes || [],
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
    async createQuiz(body) {
        try {
            await this.prisma.quiz.create({
                data: {
                    question: body.question,
                    options: body.options,
                    answer: body.answer,
                },
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
    async assignQuiz(quizId, chapterId) {
        try {
            const isQuizExist = await this.prisma.quiz.findUnique({
                where: { id: quizId },
            });
            if (!isQuizExist) {
                throw new Error('quiz not exist');
            }
            const isChapterExist = await this.prisma.chapter.findUnique({
                where: { id: chapterId },
            });
            if (!isChapterExist) {
                throw new Error('chapter not exist');
            }
            await this.prisma.chapter.update({
                where: { id: chapterId },
                data: {
                    quizzes: {
                        connect: { id: quizId },
                    },
                },
            });
            return {
                message: 'Successfully assign quiz to chapter',
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
    async updateQuiz(id, body) {
        try {
            const isQuizExist = await this.prisma.quiz.findUnique({
                where: { id: id },
            });
            if (isQuizExist) {
                throw new Error('Quizzes already exist with specified title');
            }
            if (Object.entries(body).length === 0) {
                throw new Error('wrong keys');
            }
            let updateQuiz = {};
            for (const [key, value] of Object.entries(body)) {
                updateQuiz[key] = value;
            }
            await this.prisma.quiz.update({
                where: { id },
                data: updateQuiz,
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
    async deleteQuiz(id) {
        try {
            const quiz = await this.prisma.quiz.findUnique({
                where: { id },
            });
            if (!quiz) {
                throw new Error('Course not found');
            }
            await this.prisma.quiz.delete({
                where: { id },
            });
            return {
                message: 'Successfully deleted quiz record',
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
    async checkQuiz(userId, body) {
        try {
            const quiz = await this.prisma.quiz.findUnique({
                where: { id: body.quizId },
            });
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!quiz || !user) {
                throw new Error('Quiz or user not found');
            }
            let quizAnswer = await this.prisma.quizAnswer.findFirst({
                where: {
                    quizId: body.quizId,
                    userId: userId,
                },
            });
            if (!quizAnswer) {
                quizAnswer = await this.prisma.quizAnswer.create({
                    data: {
                        quizId: body.quizId,
                        chapterId: body.chapterId,
                        userId: userId,
                        answer: body.answer,
                        isAnswerCorrect: body.answer == quiz.answer,
                    },
                });
            }
            else {
                quizAnswer = await this.prisma.quizAnswer.update({
                    where: {
                        userId_quizId: {
                            userId: userId,
                            quizId: body.quizId,
                        },
                    },
                    data: {
                        answer: body.answer,
                        isAnswerCorrect: body.answer == quiz.answer,
                    },
                });
            }
            return {
                message: 'Success',
                statusCode: 200,
                data: quizAnswer,
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
    async getUserQuizAnswers(userId, chapterId) {
        try {
            let quizAnswer = await this.prisma.quizAnswer.findMany({
                where: {
                    userId: userId,
                    chapterId: chapterId,
                },
            });
            return {
                message: 'Success',
                statusCode: 200,
                data: quizAnswer,
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
exports.QuizService = QuizService;
exports.QuizService = QuizService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], QuizService);
//# sourceMappingURL=quiz.service.js.map