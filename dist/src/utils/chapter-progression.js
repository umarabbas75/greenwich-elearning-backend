"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrichQuizProgressReport = exports.assertChapterAccessible = exports.isChapterComplete = exports.gradeChapterQuizFromStoredAnswers = exports.getPreviousChapterId = exports.getOrderedChapterIdsInCourse = exports.getCourseIdForChapter = exports.isFreeRoamUser = exports.resolvePassingCriteria = exports.DEFAULT_CHAPTER_QUIZ_PASS_PERCENTAGE = void 0;
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
        where: { courseId },
        orderBy: { createdAt: 'asc' },
        select: {
            chapters: {
                select: { id: true },
                orderBy: { createdAt: 'asc' },
            },
        },
    });
    return modules.flatMap((m) => m.chapters.map((c) => c.id));
}
exports.getOrderedChapterIdsInCourse = getOrderedChapterIdsInCourse;
async function getPreviousChapterId(prisma, courseId, chapterId) {
    const ids = await getOrderedChapterIdsInCourse(prisma, courseId);
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
async function isChapterComplete(prisma, userId, chapterId) {
    const [sectionCount, progressCount, chapter] = await Promise.all([
        prisma.section.count({ where: { chapterId } }),
        prisma.userCourseProgress.count({
            where: { userId, chapterId },
        }),
        prisma.chapter.findUnique({
            where: { id: chapterId },
            select: {
                _count: { select: { quizzes: true } },
                QuizProgress: {
                    where: { userId },
                    select: { isPassed: true },
                    take: 1,
                },
            },
        }),
    ]);
    if (!chapter)
        return false;
    if (sectionCount > 0 && progressCount < sectionCount) {
        return false;
    }
    const quizCount = chapter._count.quizzes;
    if (quizCount === 0) {
        return sectionCount === 0 || progressCount >= sectionCount;
    }
    return chapter.QuizProgress[0]?.isPassed === true;
}
exports.isChapterComplete = isChapterComplete;
async function assertChapterAccessible(prisma, config, userId, chapterId, userEmail) {
    if (isFreeRoamUser(userEmail, config)) {
        return;
    }
    const courseId = await getCourseIdForChapter(prisma, chapterId);
    if (!courseId) {
        throw new common_1.ForbiddenException('Chapter not found');
    }
    const previousChapterId = await getPreviousChapterId(prisma, courseId, chapterId);
    if (!previousChapterId) {
        return;
    }
    const previousComplete = await isChapterComplete(prisma, userId, previousChapterId);
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
//# sourceMappingURL=chapter-progression.js.map