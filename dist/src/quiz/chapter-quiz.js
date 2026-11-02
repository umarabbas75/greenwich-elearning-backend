"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withoutLegacyQuizFields = exports.quizPlacementInCourse = exports.quizzesOnlyInChapters = exports.exposeQuizCount = exports.nextPlacementOrderIndex = exports.countLiveChapterQuizzes = exports.findLiveChapterQuizIds = exports.PLACEMENT_ORDER = exports.HAS_LIVE_QUIZ = exports.VISIBLE_PLACEMENT = exports.LIVE_PLACEMENT = void 0;
exports.LIVE_PLACEMENT = {
    isArchived: false,
    quiz: { isArchived: false },
};
exports.VISIBLE_PLACEMENT = {
    isArchived: false,
    chapter: { isArchived: false, module: { isArchived: false } },
};
exports.HAS_LIVE_QUIZ = {
    quizPlacements: { some: exports.LIVE_PLACEMENT },
};
exports.PLACEMENT_ORDER = [
    { orderIndex: 'asc' },
    { createdAt: 'asc' },
    { quizId: 'asc' },
];
async function findLiveChapterQuizIds(db, chapterId) {
    const rows = await db.chapterQuiz.findMany({
        where: { chapterId, ...exports.LIVE_PLACEMENT },
        orderBy: exports.PLACEMENT_ORDER,
        select: { quizId: true },
    });
    return rows.map((r) => r.quizId);
}
exports.findLiveChapterQuizIds = findLiveChapterQuizIds;
function countLiveChapterQuizzes(db, chapterId) {
    return db.chapterQuiz.count({ where: { chapterId, ...exports.LIVE_PLACEMENT } });
}
exports.countLiveChapterQuizzes = countLiveChapterQuizzes;
async function nextPlacementOrderIndex(db, chapterId, excludeQuizIds = []) {
    const max = await db.chapterQuiz.aggregate({
        where: {
            chapterId,
            ...exports.LIVE_PLACEMENT,
            ...(excludeQuizIds.length ? { quizId: { notIn: excludeQuizIds } } : {}),
        },
        _max: { orderIndex: true },
    });
    return (max._max.orderIndex ?? -1) + 1;
}
exports.nextPlacementOrderIndex = nextPlacementOrderIndex;
function exposeQuizCount(row) {
    const count = row?._count;
    if (count && 'quizPlacements' in count) {
        count.quizzes = count.quizPlacements;
        delete count.quizPlacements;
    }
    return row;
}
exports.exposeQuizCount = exposeQuizCount;
function quizzesOnlyInChapters(chapterIds) {
    return {
        placements: {
            some: { chapterId: { in: chapterIds } },
            every: { chapterId: { in: chapterIds } },
        },
        OR: [
            { isArchived: true },
            {
                placements: {
                    some: { chapterId: { in: chapterIds }, isArchived: false },
                },
            },
        ],
    };
}
exports.quizzesOnlyInChapters = quizzesOnlyInChapters;
function quizPlacementInCourse(courseId) {
    return {
        isArchived: false,
        chapter: { module: { courseId } },
    };
}
exports.quizPlacementInCourse = quizPlacementInCourse;
function withoutLegacyQuizFields(quiz) {
    const { legacyChapterId, legacyOrderIndex, ...rest } = quiz;
    return rest;
}
exports.withoutLegacyQuizFields = withoutLegacyQuizFields;
//# sourceMappingURL=chapter-quiz.js.map