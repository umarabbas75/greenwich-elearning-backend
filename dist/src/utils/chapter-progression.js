"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordChapterAndModuleCompletionIfNeeded = exports.getChapterIdsInModuleForUser = exports.enrichQuizProgressReport = exports.assertChapterAccessible = exports.isChapterComplete = exports.gradeChapterQuizFromStoredAnswers = exports.getPreviousChapterId = exports.getOrderedChapterIdsForUser = exports.getOrderedChapterIdsForVersion = exports.getOrderedChapterIdsInCourse = exports.getCourseIdForChapter = exports.isFreeRoamUser = exports.resolvePassingCriteria = exports.DEFAULT_CHAPTER_QUIZ_PASS_PERCENTAGE = void 0;
const common_1 = require("@nestjs/common");
exports.DEFAULT_CHAPTER_QUIZ_PASS_PERCENTAGE = 70;
function resolvePassingCriteria(stored) {
    if (stored != null && stored > 0) {
        return stored;
    }
    return exports.DEFAULT_CHAPTER_QUIZ_PASS_PERCENTAGE;
}
exports.resolvePassingCriteria = resolvePassingCriteria;
function isFreeRoamUser(email, config) {
    if (!email)
        return false;
    const raw = config.get('FREE_ROAM_EMAILS') ?? '';
    const allowlist = raw
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
    return allowlist.includes(email.trim().toLowerCase());
}
exports.isFreeRoamUser = isFreeRoamUser;
async function getCourseIdForChapter(prisma, chapterId) {
    const chapter = await prisma.chapter.findUnique({
        where: { id: chapterId },
        select: { module: { select: { courseId: true } } },
    });
    return chapter?.module?.courseId ?? null;
}
exports.getCourseIdForChapter = getCourseIdForChapter;
async function getOrderedChapterIdsInCourse(prisma, courseId) {
    const modules = await prisma.module.findMany({
        where: { courseId, isArchived: false },
        orderBy: { createdAt: 'asc' },
        select: {
            chapters: {
                where: { isArchived: false },
                select: { id: true },
                orderBy: { createdAt: 'asc' },
            },
        },
    });
    return modules.flatMap((m) => m.chapters.map((c) => c.id));
}
exports.getOrderedChapterIdsInCourse = getOrderedChapterIdsInCourse;
async function getOrderedChapterIdsForVersion(prisma, versionId) {
    const versionModules = await prisma.courseVersionModule.findMany({
        where: { versionId },
        orderBy: { orderIndex: 'asc' },
        select: {
            chapters: {
                orderBy: { orderIndex: 'asc' },
                select: { sourceChapterId: true },
            },
        },
    });
    return versionModules.flatMap((m) => m.chapters
        .map((c) => c.sourceChapterId)
        .filter((id) => Boolean(id)));
}
exports.getOrderedChapterIdsForVersion = getOrderedChapterIdsForVersion;
async function getOrderedChapterIdsForUser(prisma, userId, courseId) {
    const uc = await prisma.userCourse.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: { enrolledVersionId: true },
    });
    if (uc?.enrolledVersionId) {
        const ids = await getOrderedChapterIdsForVersion(prisma, uc.enrolledVersionId);
        if (ids.length > 0)
            return ids;
    }
    return getOrderedChapterIdsInCourse(prisma, courseId);
}
exports.getOrderedChapterIdsForUser = getOrderedChapterIdsForUser;
async function getPreviousChapterId(prisma, courseId, chapterId, userId) {
    const ids = userId
        ? await getOrderedChapterIdsForUser(prisma, userId, courseId)
        : await getOrderedChapterIdsInCourse(prisma, courseId);
    const idx = ids.indexOf(chapterId);
    if (idx <= 0)
        return null;
    return ids[idx - 1];
}
exports.getPreviousChapterId = getPreviousChapterId;
async function gradeChapterQuizFromStoredAnswers(prisma, userId, chapterId, storedPassingCriteria) {
    const chapter = await prisma.chapter.findUnique({
        where: { id: chapterId },
        select: {
            quizzes: { select: { id: true } },
            QuizProgress: {
                where: { userId },
                select: { passingCriteria: true },
                take: 1,
            },
        },
    });
    if (!chapter) {
        throw new Error('Chapter not found');
    }
    const quizIds = chapter.quizzes.map((q) => q.id);
    if (quizIds.length === 0) {
        throw new Error('This chapter has no quiz questions');
    }
    const answers = await prisma.quizAnswer.findMany({
        where: { userId, chapterId, quizId: { in: quizIds } },
        select: { quizId: true, isAnswerCorrect: true },
    });
    const passingCriteria = resolvePassingCriteria(storedPassingCriteria ?? chapter.QuizProgress[0]?.passingCriteria ?? null);
    const answeredQuestions = answers.length;
    const correctCount = answers.filter((a) => a.isAnswerCorrect).length;
    const score = quizIds.length > 0
        ? Math.round((correctCount / quizIds.length) * 1000) / 10
        : 0;
    const isPassed = score >= passingCriteria;
    return {
        score,
        isPassed,
        passingCriteria,
        totalQuestions: quizIds.length,
        answeredQuestions,
    };
}
exports.gradeChapterQuizFromStoredAnswers = gradeChapterQuizFromStoredAnswers;
async function resolveChapterDenominator(prisma, userId, chapterId, ctx) {
    let courseId = ctx?.courseId;
    let enrolledVersionId = ctx?.enrolledVersionId;
    if (courseId === undefined) {
        const chapter = await prisma.chapter.findUnique({
            where: { id: chapterId },
            select: { module: { select: { courseId: true } } },
        });
        if (!chapter)
            return null;
        courseId = chapter.module.courseId;
    }
    if (enrolledVersionId === undefined) {
        const uc = await prisma.userCourse.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { enrolledVersionId: true },
        });
        enrolledVersionId = uc?.enrolledVersionId ?? null;
    }
    if (enrolledVersionId) {
        const versionChapter = await prisma.courseVersionChapter.findFirst({
            where: {
                versionId: enrolledVersionId,
                sourceChapterId: chapterId,
            },
            select: {
                _count: {
                    select: {
                        sections: { where: { isActive: true } },
                        quizzes: true,
                    },
                },
            },
        });
        if (versionChapter) {
            return {
                sectionCount: versionChapter._count.sections,
                quizCount: versionChapter._count.quizzes,
            };
        }
    }
    const [sectionCount, quizCount] = await Promise.all([
        prisma.section.count({
            where: { chapterId, isArchived: false, isActive: true },
        }),
        prisma.quiz.count({ where: { chapterId, isArchived: false } }),
    ]);
    return { sectionCount, quizCount };
}
async function isChapterComplete(prisma, userId, chapterId, ctx) {
    const [denom, progressCount, quizProgress] = await Promise.all([
        resolveChapterDenominator(prisma, userId, chapterId, ctx),
        prisma.userCourseProgress.count({
            where: { userId, chapterId },
        }),
        prisma.quizProgress.findFirst({
            where: { userId, chapterId },
            select: { isPassed: true },
        }),
    ]);
    if (!denom)
        return false;
    const { sectionCount, quizCount } = denom;
    if (sectionCount > 0 && progressCount < sectionCount) {
        return false;
    }
    if (quizCount === 0) {
        return sectionCount === 0 || progressCount >= sectionCount;
    }
    return quizProgress?.isPassed === true;
}
exports.isChapterComplete = isChapterComplete;
async function assertChapterAccessible(prisma, config, userId, chapterId, userEmail, accessCtx) {
    if (isFreeRoamUser(userEmail, config)) {
        return;
    }
    let courseId = accessCtx?.courseId;
    if (!courseId) {
        courseId = (await getCourseIdForChapter(prisma, chapterId)) ?? undefined;
    }
    if (!courseId) {
        throw new common_1.ForbiddenException('Chapter not found');
    }
    let enrolledVersionId = accessCtx?.enrolledVersionId;
    if (enrolledVersionId === undefined) {
        const uc = await prisma.userCourse.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { enrolledVersionId: true },
        });
        enrolledVersionId = uc?.enrolledVersionId ?? null;
    }
    const orderedIds = enrolledVersionId
        ? await getOrderedChapterIdsForVersion(prisma, enrolledVersionId)
        : await getOrderedChapterIdsInCourse(prisma, courseId);
    const idx = orderedIds.indexOf(chapterId);
    if (idx <= 0) {
        return;
    }
    const previousChapterId = orderedIds[idx - 1];
    const previousComplete = await isChapterComplete(prisma, userId, previousChapterId, { courseId, enrolledVersionId });
    if (!previousComplete) {
        throw new common_1.ForbiddenException('Complete the previous chapter (all sections and the chapter quiz) before continuing');
    }
}
exports.assertChapterAccessible = assertChapterAccessible;
function enrichQuizProgressReport(report) {
    if (!report)
        return null;
    return {
        ...report,
        passingCriteria: resolvePassingCriteria(report.passingCriteria),
    };
}
exports.enrichQuizProgressReport = enrichQuizProgressReport;
async function getChapterIdsInModuleForUser(prisma, userId, moduleId) {
    const module = await prisma.module.findUnique({
        where: { id: moduleId },
        select: { courseId: true },
    });
    if (!module)
        return null;
    const enrollment = await prisma.userCourse.findUnique({
        where: {
            userId_courseId: { userId, courseId: module.courseId },
        },
        select: { enrolledVersionId: true },
    });
    if (enrollment?.enrolledVersionId) {
        const versionModule = await prisma.courseVersionModule.findFirst({
            where: {
                versionId: enrollment.enrolledVersionId,
                sourceModuleId: moduleId,
            },
            select: {
                chapters: {
                    orderBy: { orderIndex: 'asc' },
                    select: { sourceChapterId: true },
                },
            },
        });
        if (versionModule) {
            return {
                courseId: module.courseId,
                chapterIds: versionModule.chapters
                    .map((c) => c.sourceChapterId)
                    .filter((id) => Boolean(id)),
            };
        }
    }
    const chapters = await prisma.chapter.findMany({
        where: { moduleId, isArchived: false },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
    });
    return {
        courseId: module.courseId,
        chapterIds: chapters.map((c) => c.id),
    };
}
exports.getChapterIdsInModuleForUser = getChapterIdsInModuleForUser;
async function recordChapterAndModuleCompletionIfNeeded(prisma, userId, chapterId, ctx) {
    const chapter = await prisma.chapter.findUnique({
        where: { id: chapterId },
        select: { moduleId: true, module: { select: { courseId: true } } },
    });
    if (!chapter)
        return;
    const courseId = ctx?.courseId ?? chapter.module.courseId;
    let enrolledVersionId = ctx?.enrolledVersionId;
    if (enrolledVersionId === undefined) {
        const enrollment = await prisma.userCourse.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { enrolledVersionId: true },
        });
        enrolledVersionId = enrollment?.enrolledVersionId ?? null;
    }
    const progressCtx = { courseId, enrolledVersionId };
    const existingChapter = await prisma.userChapterCompletion.findUnique({
        where: { userId_chapterId: { userId, chapterId } },
    });
    if (!existingChapter) {
        const complete = await isChapterComplete(prisma, userId, chapterId, progressCtx);
        if (complete) {
            await prisma.userChapterCompletion.create({
                data: {
                    userId,
                    courseId,
                    moduleId: chapter.moduleId,
                    chapterId,
                    completedAt: new Date(),
                },
            });
        }
    }
    const existingModule = await prisma.userModuleCompletion.findUnique({
        where: { userId_moduleId: { userId, moduleId: chapter.moduleId } },
    });
    if (existingModule)
        return;
    const moduleCtx = await getChapterIdsInModuleForUser(prisma, userId, chapter.moduleId);
    if (!moduleCtx || moduleCtx.chapterIds.length === 0)
        return;
    const completedChapterCount = await prisma.userChapterCompletion.count({
        where: {
            userId,
            moduleId: chapter.moduleId,
            chapterId: { in: moduleCtx.chapterIds },
        },
    });
    if (completedChapterCount < moduleCtx.chapterIds.length)
        return;
    await prisma.userModuleCompletion.create({
        data: {
            userId,
            courseId: moduleCtx.courseId,
            moduleId: chapter.moduleId,
            completedAt: new Date(),
        },
    });
}
exports.recordChapterAndModuleCompletionIfNeeded = recordChapterAndModuleCompletionIfNeeded;
//# sourceMappingURL=chapter-progression.js.map