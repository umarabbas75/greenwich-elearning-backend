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
var QuizService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuizService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const course_version_service_1 = require("../course-version/course-version.service");
const course_version_manifest_1 = require("../course-version/course-version.manifest");
const chapter_progression_1 = require("../utils/chapter-progression");
let QuizService = QuizService_1 = class QuizService {
    constructor(prisma, config, courseVersionService) {
        this.prisma = prisma;
        this.config = config;
        this.courseVersionService = courseVersionService;
    }
    async autoPublishAfterQuizChange(courseId, adminId, changeNotes) {
        try {
            const published = await this.courseVersionService.autoPublishAfterStructuralChange(courseId, adminId, changeNotes);
            if (published) {
                QuizService_1.logger.log(`Auto-published v${published.versionNumber} for course ${courseId}`);
            }
            return published;
        }
        catch (error) {
            QuizService_1.logger.error(`Auto-publish failed for course ${courseId} after "${changeNotes}": ${error?.message ?? error}`);
            return null;
        }
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
                        createdAt: 'desc',
                    },
                });
            }
            else if (role == 'user') {
                quizzes = await this.prisma.quiz.findMany({
                    orderBy: {
                        createdAt: 'desc',
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
    async getAllAssignQuizzes(chapterId, role, userId, userEmail) {
        try {
            const chapterMeta = await this.prisma.chapter.findUnique({
                where: { id: chapterId },
                select: {
                    id: true,
                    module: { select: { courseId: true } },
                },
            });
            if (!chapterMeta) {
                throw new Error('Chapter not found');
            }
            const courseId = chapterMeta.module?.courseId;
            let quizzes = [];
            let userAnswers = [];
            let resolvedFromVersion = false;
            if (role === 'user') {
                const uc = courseId
                    ? await this.prisma.userCourse.findUnique({
                        where: { userId_courseId: { userId, courseId } },
                        select: { id: true, enrolledVersionId: true },
                    })
                    : null;
                const versionId = courseId && uc?.enrolledVersionId
                    ? await this.courseVersionService.resolveEnrolledVersionId(userId, courseId, uc)
                    : null;
                const gateCtx = courseId
                    ? {
                        courseId,
                        enrolledVersionId: versionId,
                    }
                    : undefined;
                const [, versionQuizzes, answers] = await Promise.all([
                    (0, chapter_progression_1.assertChapterAccessible)(this.prisma, this.config, userId, chapterId, userEmail, gateCtx),
                    courseId
                        ? this.courseVersionService.getVersionQuizzesForChapter(userId, courseId, chapterId, false, versionId)
                        : Promise.resolve(null),
                    this.prisma.quizAnswer.findMany({
                        where: { userId, chapterId },
                    }),
                ]);
                userAnswers = answers;
                if (versionQuizzes !== null) {
                    quizzes = versionQuizzes;
                    resolvedFromVersion = true;
                }
            }
            else {
                userAnswers = await this.prisma.quizAnswer.findMany({
                    where: { userId, chapterId },
                });
            }
            if (!resolvedFromVersion && quizzes.length === 0) {
                const chapter = await this.prisma.chapter.findUnique({
                    where: { id: chapterId },
                    include: {
                        quizzes: {
                            where: { isArchived: false },
                            orderBy: [
                                { orderIndex: 'asc' },
                                { createdAt: 'asc' },
                                { id: 'asc' },
                            ],
                            select: {
                                id: true,
                                question: true,
                                options: true,
                                answer: true,
                            },
                        },
                    },
                });
                quizzes = chapter?.quizzes ?? [];
            }
            const updatedUserQuizData = quizzes?.map((item) => {
                const userAnswer = userAnswers.find((ua) => ua.quizId === item.id);
                return {
                    ...item,
                    userAnswered: userAnswer?.answer ? true : false,
                    isAnswerCorrect: userAnswer?.isAnswerCorrect,
                };
            });
            return {
                message: 'Successfully fetch all Quizzes info related to chapter',
                statusCode: 200,
                data: updatedUserQuizData?.length > 0 ? updatedUserQuizData : [],
            };
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async getChapterQuizzesReport(chapterId, userId) {
        try {
            const quizReport = await this.prisma.quizProgress.findUnique({
                where: {
                    userId_chapterId: {
                        userId,
                        chapterId,
                    },
                },
            });
            console.log({ quizReport });
            return {
                message: 'Successfully fetch chapter quiz report',
                statusCode: 200,
                data: (0, chapter_progression_1.enrichQuizProgressReport)(quizReport),
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
    async getAllQuizReport() {
        try {
            const quizReport = await this.prisma.quizProgress.findMany();
            console.log({ quizReport });
            return {
                message: 'Successfully fetch all Quizzes info related to chapter',
                statusCode: 200,
                data: quizReport,
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
    async createChapterQuizzesReport(userId, chapterId, userEmail) {
        try {
            await (0, chapter_progression_1.assertChapterAccessible)(this.prisma, this.config, userId, chapterId, userEmail);
            const quizReport = await this.prisma.quizProgress.findUnique({
                where: {
                    userId_chapterId: {
                        userId,
                        chapterId,
                    },
                },
            });
            const grade = await (0, chapter_progression_1.gradeChapterQuizFromStoredAnswers)(this.prisma, userId, chapterId, quizReport?.passingCriteria);
            if (grade.answeredQuestions < grade.totalQuestions) {
                throw new common_1.BadRequestException('Answer all chapter quiz questions before submitting the report');
            }
            const stickyPassed = (quizReport?.isPassed ?? false) || grade.isPassed;
            const bestScore = Math.max(quizReport?.score ?? 0, grade.score);
            const passingCriteria = grade.passingCriteria;
            let newQuizProgress = null;
            if (!quizReport) {
                newQuizProgress = await this.prisma.quizProgress.create({
                    data: {
                        userId,
                        chapterId,
                        totalAttempts: 1,
                        isPassed: stickyPassed,
                        score: bestScore,
                        passingCriteria,
                    },
                });
            }
            else {
                newQuizProgress = await this.prisma.quizProgress.update({
                    where: {
                        userId_chapterId: {
                            userId,
                            chapterId,
                        },
                    },
                    data: {
                        totalAttempts: (quizReport.totalAttempts ?? 0) + 1,
                        isPassed: stickyPassed,
                        score: bestScore,
                        passingCriteria: (0, chapter_progression_1.resolvePassingCriteria)(quizReport.passingCriteria || passingCriteria),
                    },
                });
            }
            await (0, chapter_progression_1.recordChapterAndModuleCompletionIfNeeded)(this.prisma, userId, chapterId);
            return {
                message: 'Chapter quiz report saved',
                statusCode: 200,
                data: (0, chapter_progression_1.enrichQuizProgressReport)(newQuizProgress),
            };
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async retakeChapterQuiz(userId, chapterId, userEmail) {
        try {
            await (0, chapter_progression_1.assertChapterAccessible)(this.prisma, this.config, userId, chapterId, userEmail);
            await this.prisma.quizAnswer.deleteMany({
                where: {
                    userId,
                    chapterId,
                },
            });
            return {
                message: 'all entries deleted successfully',
                statusCode: 200,
                data: null,
            };
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
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
    async reorderChapterQuizzes(body) {
        try {
            const { chapterId, quizzes: items } = body;
            const quizIds = items.map((q) => q.id);
            const active = await this.prisma.quiz.findMany({
                where: { chapterId, isArchived: false },
                select: { id: true },
            });
            const activeIds = new Set(active.map((q) => q.id));
            if (active.length !== quizIds.length) {
                throw new common_1.BadRequestException('Quiz list must include every active quiz in the chapter exactly once');
            }
            for (const id of quizIds) {
                if (!activeIds.has(id)) {
                    throw new common_1.BadRequestException(`Quiz ${id} is not an active quiz in this chapter`);
                }
            }
            if (new Set(quizIds).size !== quizIds.length) {
                throw new common_1.BadRequestException('Duplicate quiz ids in reorder payload');
            }
            await this.prisma.$transaction(items.map((item) => this.prisma.quiz.update({
                where: { id: item.id },
                data: { orderIndex: item.orderIndex },
            })));
            return {
                message: 'Successfully updated chapter quiz order',
                statusCode: 200,
                data: { chapterId, updatedCount: items.length },
            };
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, { cause: error });
        }
    }
    async assignQuiz(quizId, chapterId, adminId) {
        try {
            const isQuizExist = await this.prisma.quiz.findUnique({
                where: { id: quizId },
            });
            if (!isQuizExist) {
                throw new Error('quiz not exist');
            }
            const chapter = await this.prisma.chapter.findUnique({
                where: { id: chapterId },
                include: { module: { select: { courseId: true } } },
            });
            if (!chapter) {
                throw new Error('chapter not exist');
            }
            const maxOrder = await this.prisma.quiz.aggregate({
                where: {
                    chapterId,
                    isArchived: false,
                    id: { not: quizId },
                },
                _max: { orderIndex: true },
            });
            const orderIndex = (maxOrder._max.orderIndex ?? -1) + 1;
            await this.prisma.quiz.update({
                where: { id: quizId },
                data: { chapterId, isArchived: false, orderIndex },
            });
            const publishedVersion = await this.autoPublishAfterQuizChange(chapter.module.courseId, adminId, `Assigned quiz to chapter "${chapter.title}"`);
            return {
                message: publishedVersion
                    ? `Successfully assigned quiz to chapter (published v${publishedVersion.versionNumber})`
                    : 'Successfully assign quiz to chapter',
                statusCode: 200,
                data: {},
                publishedVersion: publishedVersion ?? undefined,
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
    async unAssignQuiz(quizId, chapterId, adminId) {
        try {
            const isQuizExist = await this.prisma.quiz.findUnique({
                where: { id: quizId },
            });
            if (!isQuizExist) {
                throw new Error('quiz not exist');
            }
            const chapter = await this.prisma.chapter.findUnique({
                where: { id: chapterId },
                include: { module: { select: { courseId: true } } },
            });
            if (!chapter) {
                throw new Error('chapter not exist');
            }
            const references = await this.courseVersionService.getReferencingVersionsWithEnrollments('quiz', quizId, chapter.module.courseId);
            const referenced = references.versions.length > 0;
            if (referenced) {
                await this.prisma.quiz.update({
                    where: { id: quizId },
                    data: {
                        isArchived: true,
                        chapterId: null,
                        archivedAt: new Date(),
                    },
                });
                const publishedVersion = await this.autoPublishAfterQuizChange(chapter.module.courseId, adminId, `Archived quiz from chapter "${chapter.title}"`);
                if (adminId) {
                    await this.courseVersionService.writeAudit({
                        adminId,
                        action: 'ARCHIVE_QUIZ',
                        targetType: 'Quiz',
                        targetId: quizId,
                        courseId: chapter.module.courseId,
                        metadata: {
                            via: 'unAssignQuiz',
                            chapterId,
                            chapterTitle: chapter.title,
                            stillServedTo: references.stillServedTo,
                            versions: references.versions.map((v) => ({
                                versionNumber: v.versionNumber,
                                status: v.status,
                                enrollmentCount: v.enrollmentCount,
                            })),
                        },
                    });
                }
                return {
                    message: this.courseVersionService.buildArchiveMessage('Quiz', references.stillServedTo, references.versions),
                    statusCode: 200,
                    data: {},
                    outcome: 'archived',
                    stillServedTo: references.stillServedTo,
                    versionsReferencing: references.versions,
                    publishedVersion: publishedVersion ?? undefined,
                };
            }
            await this.prisma.chapter.update({
                where: { id: chapterId },
                data: {
                    quizzes: {
                        disconnect: { id: quizId },
                    },
                },
            });
            const publishedVersion = await this.autoPublishAfterQuizChange(chapter.module.courseId, adminId, `Unassigned quiz from chapter "${chapter.title}"`);
            return {
                message: publishedVersion
                    ? `Successfully unassigned quiz (published v${publishedVersion.versionNumber})`
                    : 'Successfully unassigned quiz to module',
                statusCode: 200,
                data: {},
                outcome: 'unassigned',
                stillServedTo: 0,
                publishedVersion: publishedVersion ?? undefined,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Failed to unassign course from user',
            }, common_1.HttpStatus.FORBIDDEN);
        }
    }
    async updateQuiz(id, body) {
        try {
            const isQuizExist = await this.prisma.quiz.findUnique({
                where: { id: id },
            });
            if (!isQuizExist) {
                throw new Error('Quizzes does not exist ');
            }
            if (Object.entries(body).length === 0) {
                throw new Error('wrong keys');
            }
            const updateQuiz = {};
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
    async deleteQuiz(id, adminId) {
        try {
            const quiz = await this.prisma.quiz.findUnique({
                where: { id },
                include: {
                    chapter: { include: { module: { select: { courseId: true } } } },
                },
            });
            if (!quiz) {
                throw new Error('Course not found');
            }
            const courseId = quiz.chapter?.module?.courseId ?? null;
            const references = await this.courseVersionService.getReferencingVersionsWithEnrollments('quiz', id, courseId ?? undefined);
            const referenced = references.versions.length > 0;
            if (referenced) {
                const archived = await this.prisma.quiz.update({
                    where: { id },
                    data: { isArchived: true, archivedAt: new Date() },
                });
                const publishedVersion = courseId
                    ? await this.autoPublishAfterQuizChange(courseId, adminId, 'Archived quiz')
                    : null;
                if (adminId && courseId) {
                    await this.courseVersionService.writeAudit({
                        adminId,
                        action: 'ARCHIVE_QUIZ',
                        targetType: 'Quiz',
                        targetId: id,
                        courseId,
                        metadata: {
                            via: 'deleteQuiz',
                            stillServedTo: references.stillServedTo,
                            versions: references.versions.map((v) => ({
                                versionNumber: v.versionNumber,
                                status: v.status,
                                enrollmentCount: v.enrollmentCount,
                            })),
                        },
                    });
                }
                return {
                    message: this.courseVersionService.buildArchiveMessage('Quiz', references.stillServedTo, references.versions),
                    statusCode: 200,
                    data: archived,
                    outcome: 'archived',
                    stillServedTo: references.stillServedTo,
                    versionsReferencing: references.versions,
                    publishedVersion: publishedVersion ?? undefined,
                };
            }
            await this.prisma.quiz.delete({
                where: { id },
            });
            const publishedVersion = courseId
                ? await this.autoPublishAfterQuizChange(courseId, adminId, 'Removed quiz')
                : null;
            return {
                message: publishedVersion
                    ? `Successfully deleted quiz (published v${publishedVersion.versionNumber})`
                    : 'Successfully deleted quiz record',
                statusCode: 200,
                data: {},
                outcome: 'deleted',
                stillServedTo: 0,
                publishedVersion: publishedVersion ?? undefined,
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
    async restoreQuiz(id, adminId) {
        const quiz = await this.prisma.quiz.findUnique({
            where: { id },
            select: {
                id: true,
                chapterId: true,
                isArchived: true,
                question: true,
                chapter: {
                    select: {
                        id: true,
                        isArchived: true,
                        title: true,
                        module: {
                            select: {
                                id: true,
                                isArchived: true,
                                title: true,
                                courseId: true,
                            },
                        },
                    },
                },
            },
        });
        if (!quiz) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error: 'Quiz not found' }, common_1.HttpStatus.NOT_FOUND);
        }
        if (!quiz.isArchived) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.CONFLICT,
                error: 'Cannot restore: Quiz is already live (not archived)',
                details: { id: quiz.id, isArchived: false },
            }, common_1.HttpStatus.CONFLICT);
        }
        if (quiz.chapter) {
            const chain = [];
            if (quiz.chapter.module?.isArchived) {
                chain.push({
                    entityType: 'module',
                    id: quiz.chapter.module.id,
                    title: quiz.chapter.module.title,
                });
            }
            if (quiz.chapter.isArchived) {
                chain.push({
                    entityType: 'chapter',
                    id: quiz.chapter.id,
                    title: quiz.chapter.title,
                });
            }
            if (chain.length > 0) {
                const highest = chain[0];
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.CONFLICT,
                    error: `Cannot restore: parent ${highest.entityType === 'module' ? 'Module' : 'Chapter'} "${highest.title}" is archived; restore the ${highest.entityType} first`,
                    details: {
                        parentEntityType: highest.entityType,
                        parentId: highest.id,
                        parentTitle: highest.title,
                        chain,
                    },
                }, common_1.HttpStatus.CONFLICT);
            }
        }
        const restored = await this.prisma.quiz.update({
            where: { id },
            data: { isArchived: false, archivedAt: null },
        });
        const courseId = quiz.chapter?.module?.courseId ?? null;
        let publishedInLatest = false;
        let latest = null;
        if (courseId) {
            latest =
                await this.courseVersionService.getLatestPublishedVersion(courseId);
            if (latest) {
                const parsed = (0, course_version_manifest_1.parseManifest)(latest.manifest);
                publishedInLatest = parsed
                    ? (0, course_version_manifest_1.isIdReferencedInManifest)(parsed, 'quiz', id)
                    : false;
            }
        }
        if (adminId) {
            await this.courseVersionService.writeAudit({
                adminId,
                action: 'RESTORE_ENTITY',
                targetType: 'Quiz',
                targetId: id,
                courseId: courseId ?? undefined,
                metadata: {
                    entityType: 'quiz',
                    priorIsArchived: true,
                    parentWasArchived: false,
                    publishedInLatest,
                    questionSnippet: quiz.question.length > 100
                        ? quiz.question.slice(0, 100) + '…'
                        : quiz.question,
                },
            });
        }
        return {
            message: 'Restored',
            statusCode: 200,
            data: {
                ...restored,
                entityType: 'quiz',
                latestPublishedVersionId: latest?.id ?? null,
                latestPublishedVersionNumber: latest?.versionNumber ?? null,
                publishedInLatest,
                note: publishedInLatest
                    ? undefined
                    : this.courseVersionService.buildRestoreNote(latest?.versionNumber),
            },
        };
    }
    async checkQuiz(userId, body, userEmail) {
        try {
            await (0, chapter_progression_1.assertChapterAccessible)(this.prisma, this.config, userId, body.chapterId, userEmail);
            const [quiz, user, existingQuizAnswer] = await Promise.all([
                this.prisma.quiz.findUnique({ where: { id: body.quizId } }),
                this.prisma.user.findUnique({ where: { id: userId } }),
                this.prisma.quizAnswer.findFirst({
                    where: {
                        quizId: body.quizId,
                        userId: userId,
                    },
                }),
            ]);
            if (!quiz || !user) {
                throw new Error('Quiz or user not found');
            }
            const servedQuizIds = await (0, chapter_progression_1.resolveChapterQuizIds)(this.prisma, userId, body.chapterId);
            if (!servedQuizIds.includes(body.quizId)) {
                throw new common_1.BadRequestException('This quiz does not belong to the chapter you are viewing.');
            }
            const quizAnswerPromise = existingQuizAnswer
                ? this.prisma.quizAnswer.update({
                    where: {
                        userId_quizId: {
                            userId: userId,
                            quizId: body.quizId,
                        },
                    },
                    data: {
                        chapterId: body.chapterId,
                        answer: body.answer,
                        isAnswerCorrect: body.answer == quiz.answer,
                    },
                })
                : this.prisma.quizAnswer.create({
                    data: {
                        quizId: body.quizId,
                        chapterId: body.chapterId,
                        userId: userId,
                        answer: body.answer,
                        isAnswerCorrect: body.answer == quiz.answer,
                    },
                });
            const quizAnswer = await quizAnswerPromise;
            return {
                message: 'Success',
                statusCode: 200,
                data: quizAnswer,
            };
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
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
            const quizAnswer = await this.prisma.quizAnswer.findMany({
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
QuizService.logger = new common_1.Logger(QuizService_1.name);
exports.QuizService = QuizService = QuizService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        course_version_service_1.CourseVersionService])
], QuizService);
//# sourceMappingURL=quiz.service.js.map