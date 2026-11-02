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
const course_completion_service_1 = require("../course-completion/course-completion.service");
const assert_imported_course_tree_locked_1 = require("../utils/assert-imported-course-tree-locked");
const chapter_quiz_1 = require("./chapter-quiz");
const question_grading_1 = require("../utils/question-grading");
const QUIZ_QUESTION_MAX_MARKS = 1;
const QUIZ_TX_OPTIONS = { maxWait: 5000, timeout: 15000 };
const QUIZ_CHAPTERS_INCLUDE = {
    placements: {
        where: chapter_quiz_1.VISIBLE_PLACEMENT,
        orderBy: { createdAt: 'asc' },
        select: {
            chapter: {
                select: {
                    id: true,
                    title: true,
                    module: {
                        select: {
                            id: true,
                            title: true,
                            courseId: true,
                            course: { select: { id: true, title: true } },
                        },
                    },
                },
            },
        },
    },
};
let QuizService = QuizService_1 = class QuizService {
    constructor(prisma, config, courseVersionService, courseCompletion) {
        this.prisma = prisma;
        this.config = config;
        this.courseVersionService = courseVersionService;
        this.courseCompletion = courseCompletion;
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
                const row = await this.prisma.quiz.findUnique({
                    where: { id },
                    include: QUIZ_CHAPTERS_INCLUDE,
                });
                if (row) {
                    const { placements, ...rest } = row;
                    quiz = {
                        ...(0, chapter_quiz_1.withoutLegacyQuizFields)(rest),
                        chapters: placements.map((p) => p.chapter),
                    };
                }
                else {
                    quiz = row;
                }
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
    async getAllQuizzes(role, query) {
        try {
            const paginate = query?.page !== undefined || query?.limit !== undefined;
            const page = Math.max(1, query?.page ?? 1);
            const limit = Math.min(Math.max(query?.limit ?? 50, 1), 100);
            const conditions = [];
            if (query?.search) {
                conditions.push({
                    question: { contains: query.search, mode: 'insensitive' },
                });
            }
            if (query?.assigned === true) {
                conditions.push({ placements: { some: chapter_quiz_1.VISIBLE_PLACEMENT } });
            }
            else if (query?.assigned === false) {
                conditions.push({ placements: { none: chapter_quiz_1.VISIBLE_PLACEMENT } });
            }
            if (query?.courseId) {
                conditions.push({
                    placements: {
                        some: {
                            isArchived: false,
                            chapter: {
                                isArchived: false,
                                module: { isArchived: false, courseId: query.courseId },
                            },
                        },
                    },
                });
            }
            if (query?.chapterId) {
                conditions.push({
                    placements: {
                        some: { chapterId: query.chapterId, isArchived: false },
                    },
                });
            }
            if (query?.excludeChapterId) {
                conditions.push({
                    placements: {
                        none: { chapterId: query.excludeChapterId, isArchived: false },
                    },
                });
            }
            if (!query?.includeArchived) {
                conditions.push({ isArchived: false });
            }
            const where = conditions.length
                ? { AND: conditions }
                : {};
            let quizzes = [];
            let total;
            if (role == 'admin') {
                let rows;
                [rows, total] = await Promise.all([
                    this.prisma.quiz.findMany({
                        where,
                        orderBy: { createdAt: 'desc' },
                        include: QUIZ_CHAPTERS_INCLUDE,
                        ...(paginate ? { skip: (page - 1) * limit, take: limit } : {}),
                    }),
                    this.prisma.quiz.count({ where }),
                ]);
                quizzes = rows.map(({ placements, ...quiz }) => {
                    const chapters = placements.map((p) => p.chapter);
                    return {
                        ...(0, chapter_quiz_1.withoutLegacyQuizFields)(quiz),
                        chapters,
                        chapterId: chapters[0]?.id ?? null,
                        chapter: chapters[0] ?? null,
                    };
                });
            }
            else if (role == 'user') {
                [quizzes, total] = await Promise.all([
                    this.prisma.quiz.findMany({
                        where,
                        orderBy: { createdAt: 'desc' },
                        select: {
                            id: true,
                            question: true,
                            options: true,
                        },
                        ...(paginate ? { skip: (page - 1) * limit, take: limit } : {}),
                    }),
                    this.prisma.quiz.count({ where }),
                ]);
            }
            return {
                message: 'Successfully fetch all Quizzes info',
                statusCode: 200,
                data: quizzes,
                total,
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
                const placements = await this.prisma.chapterQuiz.findMany({
                    where: { chapterId, ...chapter_quiz_1.LIVE_PLACEMENT },
                    orderBy: chapter_quiz_1.PLACEMENT_ORDER,
                    select: {
                        quiz: {
                            select: {
                                id: true,
                                question: true,
                                options: true,
                                answer: true,
                                type: true,
                                content: true,
                            },
                        },
                    },
                });
                quizzes = placements.map(({ quiz }) => {
                    if (role === 'admin')
                        return quiz;
                    const { answer, ...forLearner } = quiz;
                    return forLearner;
                });
            }
            const isStudentRole = role !== 'admin';
            const updatedUserQuizData = quizzes?.map((item) => {
                const userAnswer = userAnswers.find((ua) => ua.quizId === item.id);
                const isTyped = Boolean(item.type);
                return {
                    ...item,
                    content: isTyped && isStudentRole
                        ? (0, question_grading_1.stripCorrectAnswerFields)(item.content)
                        : item.content,
                    userAnswered: isTyped
                        ? userAnswer?.studentAnswer != null
                        : Boolean(userAnswer?.answer),
                    isAnswerCorrect: userAnswer?.isAnswerCorrect,
                    studentAnswer: userAnswer?.studentAnswer ?? null,
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
            const [chapter, quizReport] = await Promise.all([
                this.prisma.chapter.findUnique({
                    where: { id: chapterId },
                    select: { module: { select: { courseId: true } } },
                }),
                this.prisma.quizProgress.findUnique({
                    where: { userId_chapterId: { userId, chapterId } },
                }),
            ]);
            const courseId = chapter?.module?.courseId;
            if (!courseId) {
                throw new common_1.ForbiddenException('Chapter not found');
            }
            const enrollment = await this.prisma.userCourse.findUnique({
                where: { userId_courseId: { userId, courseId } },
                select: { enrolledVersionId: true },
            });
            const progressCtx = {
                courseId,
                enrolledVersionId: enrollment?.enrolledVersionId ?? null,
            };
            const [, grade] = await Promise.all([
                (0, chapter_progression_1.assertChapterAccessible)(this.prisma, this.config, userId, chapterId, userEmail, progressCtx),
                (0, chapter_progression_1.gradeChapterQuizFromStoredAnswers)(this.prisma, userId, chapterId, quizReport?.passingCriteria ?? null, progressCtx),
            ]);
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
            try {
                await Promise.all([
                    (0, chapter_progression_1.recordChapterAndModuleCompletionIfNeeded)(this.prisma, userId, chapterId, progressCtx),
                    stickyPassed
                        ? this.courseCompletion.checkContentCompletion(userId, courseId)
                        : Promise.resolve(),
                ]);
            }
            catch (completionError) {
                const message = completionError instanceof Error
                    ? completionError.message
                    : String(completionError);
                QuizService_1.logger.warn(`Post-quiz completion bookkeeping failed for user ${userId}, chapter ${chapterId}: ${message}`);
            }
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
            const quiz = await this.prisma.quiz.create({
                data: body.type
                    ? {
                        question: body.question,
                        options: [],
                        type: body.type,
                        content: body.content,
                    }
                    : {
                        question: body.question,
                        options: body.options,
                        answer: body.answer,
                    },
            });
            return {
                message: 'Successfully create quiz record',
                statusCode: 200,
                data: (0, chapter_quiz_1.withoutLegacyQuizFields)(quiz),
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
            const active = await this.prisma.chapterQuiz.findMany({
                where: { chapterId, ...chapter_quiz_1.LIVE_PLACEMENT },
                select: { quizId: true },
            });
            const activeIds = new Set(active.map((p) => p.quizId));
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
            await this.prisma.$transaction(items.map((item) => this.prisma.chapterQuiz.update({
                where: { chapterId_quizId: { chapterId, quizId: item.id } },
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
            const result = await this.placeQuizzes(chapterId, [quizId], adminId);
            return {
                message: result.publishedVersion
                    ? `Successfully assigned quiz to chapter (published v${result.publishedVersion.versionNumber})`
                    : result.placedCount === 0
                        ? 'Quiz is already in this chapter'
                        : 'Successfully assign quiz to chapter',
                statusCode: 200,
                data: {},
                publishedVersion: result.publishedVersion ?? undefined,
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
    async bulkAssignQuiz(chapterId, quizIds, adminId) {
        try {
            const uniqueIds = Array.from(new Set(quizIds));
            if (uniqueIds.length === 0) {
                throw new Error('No quizzes provided');
            }
            const result = await this.placeQuizzes(chapterId, uniqueIds, adminId);
            const already = uniqueIds.length - result.placedCount;
            const alreadyNote = already > 0 ? `; ${already} already in this chapter` : '';
            return {
                message: result.publishedVersion
                    ? `Successfully assigned ${result.placedCount} quiz(zes) to chapter (published v${result.publishedVersion.versionNumber})${alreadyNote}`
                    : `Successfully assigned ${result.placedCount} quiz(zes) to chapter${alreadyNote}`,
                statusCode: 200,
                data: {
                    chapterId,
                    quizIds: uniqueIds,
                    assignedCount: result.placedCount,
                    alreadyInChapterCount: already,
                },
                publishedVersion: result.publishedVersion ?? undefined,
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
    async placeQuizzes(chapterId, quizIds, adminId) {
        const chapter = await this.prisma.chapter.findUnique({
            where: { id: chapterId },
            include: {
                module: {
                    select: {
                        courseId: true,
                        course: { select: { deliveryMode: true } },
                    },
                },
            },
        });
        if (!chapter) {
            throw new Error('chapter not exist');
        }
        const courseId = chapter.module.courseId;
        await (0, assert_imported_course_tree_locked_1.assertImportedCourseTreeLocked)(this.prisma, { courseId }, { deliveryMode: chapter.module.course?.deliveryMode });
        const { placed, restored } = await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT id FROM "quizzes" WHERE id IN (${client_1.Prisma.join(quizIds)}) ORDER BY id FOR UPDATE`;
            const [existing, placementsHere, inOtherChapters] = await Promise.all([
                tx.quiz.findMany({
                    where: { id: { in: quizIds } },
                    select: { id: true, isArchived: true, question: true },
                }),
                tx.chapterQuiz.findMany({
                    where: { chapterId, quizId: { in: quizIds } },
                    select: { quizId: true, isArchived: true },
                }),
                tx.chapterQuiz.findMany({
                    where: {
                        quizId: { in: quizIds },
                        chapterId: { not: chapterId },
                        isArchived: false,
                        chapter: { module: { courseId } },
                    },
                    select: {
                        id: true,
                        quizId: true,
                        chapter: {
                            select: {
                                title: true,
                                isArchived: true,
                                module: { select: { isArchived: true } },
                            },
                        },
                    },
                }),
            ]);
            const quizById = new Map(existing.map((q) => [q.id, q]));
            const missing = quizIds.filter((id) => !quizById.has(id));
            if (missing.length > 0) {
                throw new Error(missing.length === 1 && quizIds.length === 1
                    ? 'quiz not exist'
                    : `Quiz(zes) not found: ${missing.join(', ')}`);
            }
            const stale = inOtherChapters.filter((p) => p.chapter.isArchived || p.chapter.module.isArchived);
            const blocking = inOtherChapters.filter((p) => !stale.includes(p));
            if (blocking.length > 0) {
                const list = blocking
                    .map((p) => `"${quizById.get(p.quizId)?.question.slice(0, 60)}" (in "${p.chapter.title}")`)
                    .join(', ');
                throw new Error(`A quiz can be in only one chapter of a course. Unassign it from its current chapter first: ${list}`);
            }
            const liveHere = new Set(placementsHere
                .filter((p) => !p.isArchived && !quizById.get(p.quizId)?.isArchived)
                .map((p) => p.quizId));
            const toPlace = quizIds.filter((id) => !liveHere.has(id));
            if (toPlace.length === 0) {
                return { placed: [], restored: [] };
            }
            const now = new Date();
            if (stale.length > 0) {
                await tx.chapterQuiz.updateMany({
                    where: { id: { in: stale.map((p) => p.id) } },
                    data: { isArchived: true, archivedAt: now },
                });
            }
            const firstOrder = await (0, chapter_quiz_1.nextPlacementOrderIndex)(tx, chapterId, toPlace);
            const archivedQuizIds = toPlace.filter((id) => quizById.get(id)?.isArchived);
            if (archivedQuizIds.length > 0) {
                await tx.quiz.updateMany({
                    where: { id: { in: archivedQuizIds } },
                    data: { isArchived: false, archivedAt: null },
                });
            }
            const orders = toPlace.map((_, i) => firstOrder + i);
            await tx.$executeRaw `
        INSERT INTO "chapter_quizzes"
          ("id", "chapterId", "quizId", "orderIndex", "isArchived", "archivedAt", "createdAt", "updatedAt")
        SELECT gen_random_uuid()::text, ${chapterId}, t.quiz_id, t.order_index, false, NULL,
               (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
        FROM unnest(${toPlace}::text[], ${orders}::int[]) AS t(quiz_id, order_index)
        ON CONFLICT ("chapterId", "quizId") DO UPDATE
        SET "orderIndex" = EXCLUDED."orderIndex",
            "isArchived" = false,
            "archivedAt" = NULL,
            "updatedAt" = (now() AT TIME ZONE 'UTC')`;
            return { placed: toPlace, restored: archivedQuizIds };
        }, QUIZ_TX_OPTIONS);
        if (placed.length === 0) {
            return { placedCount: 0, publishedVersion: null };
        }
        const publishedVersion = await this.autoPublishAfterQuizChange(courseId, adminId, placed.length === 1
            ? `Assigned quiz to chapter "${chapter.title}"`
            : `Assigned ${placed.length} quiz(zes) to chapter "${chapter.title}"`);
        const otherCourses = new Set();
        for (const quizId of restored) {
            for (const c of await this.findQuizCourses(quizId, {
                includeRemoved: false,
            })) {
                if (c.courseId !== courseId)
                    otherCourses.add(c.courseId);
            }
        }
        for (const otherCourseId of otherCourses) {
            await this.autoPublishAfterQuizChange(otherCourseId, adminId, 'Restored quiz');
        }
        return { placedCount: placed.length, publishedVersion };
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
                include: {
                    module: {
                        select: {
                            courseId: true,
                            course: { select: { deliveryMode: true } },
                        },
                    },
                },
            });
            if (!chapter) {
                throw new Error('chapter not exist');
            }
            await (0, assert_imported_course_tree_locked_1.assertImportedCourseTreeLocked)(this.prisma, { courseId: chapter.module.courseId }, { deliveryMode: chapter.module.course?.deliveryMode });
            const references = await this.courseVersionService.getReferencingVersionsWithEnrollments('quiz', quizId, chapter.module.courseId);
            const referenced = references.versions.length > 0;
            const { archiveQuiz, otherLivePlacements } = await this.prisma.$transaction(async (tx) => {
                await tx.$queryRaw `SELECT id FROM "quizzes" WHERE id = ${quizId} FOR UPDATE`;
                const placement = await tx.chapterQuiz.findUnique({
                    where: { chapterId_quizId: { chapterId, quizId } },
                    select: { isArchived: true },
                });
                if (!placement || placement.isArchived) {
                    throw new Error('This quiz is not assigned to this chapter');
                }
                const now = new Date();
                await tx.chapterQuiz.update({
                    where: { chapterId_quizId: { chapterId, quizId } },
                    data: { isArchived: true, archivedAt: now },
                });
                if (!referenced) {
                    return { archiveQuiz: false, otherLivePlacements: 0 };
                }
                const others = await tx.chapterQuiz.count({
                    where: { quizId, isArchived: false, chapterId: { not: chapterId } },
                });
                if (others === 0) {
                    await tx.quiz.update({
                        where: { id: quizId },
                        data: { isArchived: true, archivedAt: now },
                    });
                }
                return { archiveQuiz: others === 0, otherLivePlacements: others };
            }, QUIZ_TX_OPTIONS);
            if (referenced) {
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
                            quizArchived: archiveQuiz,
                            stillUsedInOtherChapters: otherLivePlacements,
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
            await this.assertQuizCoursesEditable(await this.findQuizCourses(id, { includeRemoved: true }));
            if (Object.entries(body).length === 0) {
                throw new Error('wrong keys');
            }
            const updateQuiz = {};
            for (const [key, value] of Object.entries(body)) {
                updateQuiz[key] = value;
            }
            const updated = await this.prisma.quiz.update({
                where: { id },
                data: updateQuiz,
            });
            return {
                message: 'Successfully create quiz record',
                statusCode: 200,
                data: (0, chapter_quiz_1.withoutLegacyQuizFields)(updated),
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
                select: { id: true },
            });
            if (!quiz) {
                throw new Error('Course not found');
            }
            const [allCourses, liveCourses] = await Promise.all([
                this.findQuizCourses(id, { includeRemoved: true }),
                this.findQuizCourses(id, { includeRemoved: false }),
            ]);
            await this.assertQuizCoursesEditable(allCourses);
            const references = await this.courseVersionService.getReferencingVersionsWithEnrollments('quiz', id);
            const referenced = references.versions.length > 0;
            if (referenced) {
                const archived = await this.prisma.quiz.update({
                    where: { id },
                    data: { isArchived: true, archivedAt: new Date() },
                });
                let publishedVersion = null;
                for (const course of liveCourses) {
                    const published = await this.autoPublishAfterQuizChange(course.courseId, adminId, 'Archived quiz');
                    publishedVersion = publishedVersion ?? published;
                    if (adminId) {
                        await this.courseVersionService.writeAudit({
                            adminId,
                            action: 'ARCHIVE_QUIZ',
                            targetType: 'Quiz',
                            targetId: id,
                            courseId: course.courseId,
                            metadata: {
                                via: 'deleteQuiz',
                                usedInCourses: liveCourses.length,
                                stillServedTo: references.stillServedTo,
                                versions: references.versions.map((v) => ({
                                    versionNumber: v.versionNumber,
                                    status: v.status,
                                    enrollmentCount: v.enrollmentCount,
                                })),
                            },
                        });
                    }
                }
                return {
                    message: this.courseVersionService.buildArchiveMessage('Quiz', references.stillServedTo, references.versions),
                    statusCode: 200,
                    data: (0, chapter_quiz_1.withoutLegacyQuizFields)(archived),
                    outcome: 'archived',
                    stillServedTo: references.stillServedTo,
                    versionsReferencing: references.versions,
                    publishedVersion: publishedVersion ?? undefined,
                };
            }
            await this.prisma.quiz.delete({
                where: { id },
            });
            let publishedVersion = null;
            for (const course of liveCourses) {
                const published = await this.autoPublishAfterQuizChange(course.courseId, adminId, 'Removed quiz');
                publishedVersion = publishedVersion ?? published;
            }
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
    async findQuizCourses(quizId, opts) {
        const placements = await this.prisma.chapterQuiz.findMany({
            where: { quizId, ...(opts.includeRemoved ? {} : { isArchived: false }) },
            orderBy: { createdAt: 'asc' },
            select: {
                chapter: {
                    select: {
                        module: {
                            select: {
                                courseId: true,
                                course: { select: { deliveryMode: true } },
                            },
                        },
                    },
                },
            },
        });
        const byCourse = new Map();
        for (const p of placements) {
            const { courseId, course } = p.chapter.module;
            if (!byCourse.has(courseId)) {
                byCourse.set(courseId, { courseId, deliveryMode: course.deliveryMode });
            }
        }
        return Array.from(byCourse.values());
    }
    async assertQuizCoursesEditable(courses) {
        for (const course of courses) {
            await (0, assert_imported_course_tree_locked_1.assertImportedCourseTreeLocked)(this.prisma, { courseId: course.courseId }, { deliveryMode: course.deliveryMode });
        }
    }
    async restoreQuiz(id, adminId) {
        const quiz = await this.prisma.quiz.findUnique({
            where: { id },
            select: {
                id: true,
                isArchived: true,
                question: true,
                placements: {
                    where: { isArchived: false },
                    orderBy: { createdAt: 'asc' },
                    select: {
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
                                        course: { select: { deliveryMode: true } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!quiz) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error: 'Quiz not found' }, common_1.HttpStatus.NOT_FOUND);
        }
        const chapters = quiz.placements.map((p) => p.chapter);
        const courseIds = Array.from(new Set(chapters.map((c) => c.module.courseId)));
        for (const chapter of chapters) {
            await (0, assert_imported_course_tree_locked_1.assertImportedCourseTreeLocked)(this.prisma, { courseId: chapter.module.courseId }, { deliveryMode: chapter.module.course?.deliveryMode });
        }
        if (!quiz.isArchived) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.CONFLICT,
                error: 'Cannot restore: Quiz is already live (not archived)',
                details: { id: quiz.id, isArchived: false },
            }, common_1.HttpStatus.CONFLICT);
        }
        const parentChain = (chapter) => {
            const chain = [];
            if (chapter.module?.isArchived) {
                chain.push({
                    entityType: 'module',
                    id: chapter.module.id,
                    title: chapter.module.title,
                });
            }
            if (chapter.isArchived) {
                chain.push({
                    entityType: 'chapter',
                    id: chapter.id,
                    title: chapter.title,
                });
            }
            return chain;
        };
        const chains = chapters.map(parentChain);
        if (chains.length > 0 && chains.every((chain) => chain.length > 0)) {
            const chain = chains[0];
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
        const restored = await this.prisma.quiz.update({
            where: { id },
            data: { isArchived: false, archivedAt: null },
        });
        const courseId = courseIds[0] ?? null;
        let publishedInLatest = false;
        let latest = null;
        for (const cid of courseIds) {
            latest = await this.courseVersionService.getLatestPublishedVersion(cid);
            const parsed = latest ? (0, course_version_manifest_1.parseManifest)(latest.manifest) : null;
            publishedInLatest = parsed
                ? (0, course_version_manifest_1.isIdReferencedInManifest)(parsed, 'quiz', id)
                : false;
            if (!publishedInLatest)
                break;
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
                    usedInCourses: courseIds.length,
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
                ...(0, chapter_quiz_1.withoutLegacyQuizFields)(restored),
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
                        chapterId: body.chapterId,
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
            const isTyped = Boolean(quiz.type);
            let isAnswerCorrect;
            let systemScore = null;
            if (isTyped) {
                if (body.studentAnswer == null) {
                    throw new common_1.BadRequestException('studentAnswer is required for this quiz question');
                }
                const score = (0, question_grading_1.calculateAutoScore)(quiz.type, quiz.content, body.studentAnswer, QUIZ_QUESTION_MAX_MARKS);
                systemScore = score ?? 0;
                isAnswerCorrect = systemScore >= QUIZ_QUESTION_MAX_MARKS;
            }
            else {
                if (!body.answer) {
                    throw new common_1.BadRequestException('answer is required for this quiz question');
                }
                isAnswerCorrect = body.answer == quiz.answer;
            }
            const quizAnswerPromise = existingQuizAnswer
                ? this.prisma.quizAnswer.update({
                    where: {
                        userId_chapterId_quizId: {
                            userId: userId,
                            chapterId: body.chapterId,
                            quizId: body.quizId,
                        },
                    },
                    data: isTyped
                        ? {
                            chapterId: body.chapterId,
                            studentAnswer: body.studentAnswer,
                            isAnswerCorrect,
                            systemScore,
                        }
                        : {
                            chapterId: body.chapterId,
                            answer: body.answer,
                            isAnswerCorrect,
                        },
                })
                : this.prisma.quizAnswer.create({
                    data: isTyped
                        ? {
                            quizId: body.quizId,
                            chapterId: body.chapterId,
                            userId: userId,
                            studentAnswer: body.studentAnswer,
                            isAnswerCorrect,
                            systemScore,
                        }
                        : {
                            quizId: body.quizId,
                            chapterId: body.chapterId,
                            userId: userId,
                            answer: body.answer,
                            isAnswerCorrect,
                        },
                });
            const quizAnswer = await quizAnswerPromise;
            return {
                message: 'Success',
                statusCode: 200,
                data: isTyped
                    ? {
                        ...quizAnswer,
                        isAnswerCorrect,
                        systemScore,
                        maxMarks: QUIZ_QUESTION_MAX_MARKS,
                    }
                    : quizAnswer,
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
        course_version_service_1.CourseVersionService,
        course_completion_service_1.CourseCompletionService])
], QuizService);
//# sourceMappingURL=quiz.service.js.map