"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStartedSet = exports.startedKey = void 0;
const startedKey = (userId, courseId) => `${userId}|${courseId}`;
exports.startedKey = startedKey;
async function buildStartedSet(prisma) {
    const started = new Set();
    const [chapters, assessments] = await Promise.all([
        prisma.chapter.findMany({
            select: { id: true, module: { select: { courseId: true } } },
        }),
        prisma.assessment.findMany({ select: { id: true, courseId: true } }),
    ]);
    const chapterToCourse = new Map(chapters.map((c) => [c.id, c.module?.courseId]));
    const assessmentToCourse = new Map(assessments.map((a) => [a.id, a.courseId]));
    const directLoaders = [
        () => prisma.userCourseProgress.findMany({
            select: { userId: true, courseId: true },
            distinct: ['userId', 'courseId'],
        }),
        () => prisma.lastSeenSection.findMany({
            select: { userId: true, courseId: true },
            distinct: ['userId', 'courseId'],
        }),
        () => prisma.userChapterCompletion.findMany({
            select: { userId: true, courseId: true },
            distinct: ['userId', 'courseId'],
        }),
        () => prisma.userModuleCompletion.findMany({
            select: { userId: true, courseId: true },
            distinct: ['userId', 'courseId'],
        }),
        () => prisma.userFormCompletion.findMany({
            select: { userId: true, courseId: true },
            distinct: ['userId', 'courseId'],
        }),
        () => prisma.courseCompletion.findMany({
            select: { userId: true, courseId: true },
            distinct: ['userId', 'courseId'],
        }),
    ];
    for (const load of directLoaders) {
        for (const r of await load()) {
            if (r.userId && r.courseId)
                started.add((0, exports.startedKey)(r.userId, r.courseId));
        }
    }
    const chapterSignals = await Promise.all([
        prisma.quizProgress.findMany({
            select: { userId: true, chapterId: true },
            distinct: ['userId', 'chapterId'],
        }),
        prisma.quizAnswer.findMany({
            select: { userId: true, chapterId: true },
            distinct: ['userId', 'chapterId'],
        }),
    ]);
    for (const rows of chapterSignals) {
        for (const r of rows) {
            const courseId = chapterToCourse.get(r.chapterId);
            if (r.userId && courseId)
                started.add((0, exports.startedKey)(r.userId, courseId));
        }
    }
    const attempts = await prisma.assessmentAttempt.findMany({
        select: { userId: true, assessmentId: true },
        distinct: ['userId', 'assessmentId'],
    });
    for (const a of attempts) {
        const courseId = assessmentToCourse.get(a.assessmentId);
        if (a.userId && courseId)
            started.add((0, exports.startedKey)(a.userId, courseId));
    }
    return started;
}
exports.buildStartedSet = buildStartedSet;
//# sourceMappingURL=started-set.js.map