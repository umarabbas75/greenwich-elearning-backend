"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyModuleRollup = exports.buildChapterReportRow = exports.buildChapterQuizSummary = exports.buildSectionReportRows = exports.buildChapterActivityMaps = exports.deriveModuleReportStatus = exports.deriveChapterReportStatus = exports.deriveSectionReportStatus = void 0;
const chapter_progression_1 = require("./chapter-progression");
const interactive_section_types_1 = require("./interactive-section-types");
function deriveSectionReportStatus(input) {
    if (input.completedAt)
        return 'completed';
    if (input.isLastSeen)
        return 'opened';
    return 'not_opened';
}
exports.deriveSectionReportStatus = deriveSectionReportStatus;
function deriveChapterReportStatus(input) {
    const { sectionsCompleted, sectionsTotal, quizzesTotal, quizPassed, quizAttempted, hasOpened, completedAt, } = input;
    if (completedAt)
        return 'completed';
    const sectionsComplete = sectionsTotal === 0 || sectionsCompleted >= sectionsTotal;
    const quizRequired = quizzesTotal > 0;
    if (sectionsComplete && (!quizRequired || quizPassed)) {
        return 'completed';
    }
    if (sectionsCompleted > 0 || quizAttempted) {
        return 'in_progress';
    }
    if (hasOpened) {
        return 'opened';
    }
    return 'not_opened';
}
exports.deriveChapterReportStatus = deriveChapterReportStatus;
function deriveModuleReportStatus(chapters, completedAt) {
    if (completedAt)
        return 'completed';
    if (chapters.length === 0)
        return 'not_opened';
    if (chapters.every((c) => c.status === 'completed'))
        return 'completed';
    if (chapters.every((c) => c.status === 'not_opened'))
        return 'not_opened';
    if (chapters.some((c) => c.status === 'in_progress'))
        return 'in_progress';
    if (chapters.some((c) => c.status === 'completed'))
        return 'in_progress';
    if (chapters.some((c) => c.status === 'opened'))
        return 'opened';
    return 'not_opened';
}
exports.deriveModuleReportStatus = deriveModuleReportStatus;
function buildChapterActivityMaps(input) {
    const progressSectionIds = new Set(input.progressRows.map((p) => p.sectionId));
    const sectionsCompletedByChapter = new Map();
    const sectionCompletedAtById = new Map();
    const startedAtByChapter = new Map();
    for (const row of input.progressRows) {
        sectionsCompletedByChapter.set(row.chapterId, (sectionsCompletedByChapter.get(row.chapterId) ?? 0) + 1);
        sectionCompletedAtById.set(row.sectionId, row.createdAt);
        const prev = startedAtByChapter.get(row.chapterId);
        if (!prev || row.createdAt < prev) {
            startedAtByChapter.set(row.chapterId, row.createdAt);
        }
    }
    const openedAtByChapter = new Map();
    const lastOpenedAtByChapter = new Map();
    const lastSeenCountByChapter = new Map();
    const lastSeenByChapter = new Map();
    for (const row of input.lastSeenRows) {
        lastSeenCountByChapter.set(row.chapterId, (lastSeenCountByChapter.get(row.chapterId) ?? 0) + 1);
        lastSeenByChapter.set(row.chapterId, {
            sectionId: row.sectionId,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        });
        const prevOpened = openedAtByChapter.get(row.chapterId);
        if (!prevOpened || row.createdAt < prevOpened) {
            openedAtByChapter.set(row.chapterId, row.createdAt);
        }
        const prevLast = lastOpenedAtByChapter.get(row.chapterId);
        if (!prevLast || row.updatedAt > prevLast) {
            lastOpenedAtByChapter.set(row.chapterId, row.updatedAt);
        }
    }
    const quizAnswerCountByChapter = new Map();
    for (const row of input.quizAnswerRows) {
        if (!row.chapterId)
            continue;
        quizAnswerCountByChapter.set(row.chapterId, (quizAnswerCountByChapter.get(row.chapterId) ?? 0) + 1);
    }
    const quizProgressByChapter = new Map(input.quizProgressRows.map((q) => [q.chapterId, q]));
    const timeSpentSecondsBySection = new Map();
    const totalAttemptsBySection = new Map();
    for (const row of input.timeSpentRows ?? []) {
        timeSpentSecondsBySection.set(row.sectionId, row.totalSeconds);
        totalAttemptsBySection.set(row.sectionId, row.totalAttempts);
    }
    return {
        progressSectionIds,
        sectionsCompletedByChapter,
        sectionCompletedAtById,
        startedAtByChapter,
        openedAtByChapter,
        lastOpenedAtByChapter,
        lastSeenByChapter,
        quizAnswerCountByChapter,
        lastSeenCountByChapter,
        quizProgressByChapter,
        timeSpentSecondsBySection,
        totalAttemptsBySection,
    };
}
exports.buildChapterActivityMaps = buildChapterActivityMaps;
function buildSectionReportRows(chapterId, sections, activity) {
    const lastSeen = activity.lastSeenByChapter.get(chapterId);
    return sections.map((section) => {
        const completedAt = activity.sectionCompletedAtById.get(section.id) ?? null;
        const isLastSeen = lastSeen?.sectionId === section.id;
        return {
            id: section.id,
            title: section.title,
            orderIndex: section.orderIndex,
            type: section.type,
            status: deriveSectionReportStatus({ completedAt, isLastSeen }),
            isLastSeen,
            openedAt: isLastSeen ? (lastSeen?.createdAt ?? null) : null,
            lastOpenedAt: isLastSeen ? (lastSeen?.updatedAt ?? null) : null,
            completedAt,
            timeSpentSeconds: activity.timeSpentSecondsBySection.get(section.id) ?? 0,
            totalAttempts: (0, interactive_section_types_1.isInteractiveSectionType)(section.type)
                ? (activity.totalAttemptsBySection.get(section.id) ?? 0)
                : null,
        };
    });
}
exports.buildSectionReportRows = buildSectionReportRows;
function buildChapterQuizSummary(quiz) {
    if (!quiz)
        return null;
    const enriched = (0, chapter_progression_1.enrichQuizProgressReport)(quiz);
    return {
        attempts: enriched.totalAttempts,
        isPassed: enriched.isPassed,
        score: enriched.score,
        passingCriteria: enriched.passingCriteria,
        firstAttemptAt: enriched.createdAt,
        lastAttemptAt: enriched.updatedAt,
    };
}
exports.buildChapterQuizSummary = buildChapterQuizSummary;
function buildChapterReportRow(input) {
    const { id, title, sectionMetas, quizzesTotal, activity, chapterCompletedAt, isFrozen, } = input;
    const versionSectionIds = sectionMetas.map((s) => s.id);
    const sections = buildSectionReportRows(id, sectionMetas, activity);
    const totalSectionsInChapter = versionSectionIds.length;
    const userCourseProgress = Math.min(versionSectionIds.filter((sid) => activity.progressSectionIds.has(sid))
        .length, totalSectionsInChapter);
    const progress = isFrozen
        ? 100
        : totalSectionsInChapter === 0
            ? 0
            : (userCourseProgress * 100) / totalSectionsInChapter;
    const quizRow = activity.quizProgressByChapter.get(id);
    const quizPassed = quizRow?.isPassed === true;
    const quizAttempted = (quizRow?.totalAttempts ?? 0) > 0;
    const hasOpened = activity.openedAtByChapter.has(id);
    const status = deriveChapterReportStatus({
        sectionsCompleted: userCourseProgress,
        sectionsTotal: totalSectionsInChapter,
        quizzesTotal,
        quizPassed,
        quizAttempted,
        hasOpened,
        completedAt: chapterCompletedAt,
    });
    const enrichedQuiz = quizRow
        ? (0, chapter_progression_1.enrichQuizProgressReport)(quizRow)
        : null;
    const timeSpentSeconds = sections.reduce((sum, section) => sum + section.timeSpentSeconds, 0);
    const totalAttempts = sections.reduce((sum, section) => sum + (section.totalAttempts ?? 0), 0);
    return {
        id,
        title,
        status,
        openedAt: activity.openedAtByChapter.get(id) ?? null,
        lastOpenedAt: activity.lastOpenedAtByChapter.get(id) ?? null,
        startedAt: activity.startedAtByChapter.get(id) ?? null,
        completedAt: chapterCompletedAt,
        timeSpentSeconds,
        totalAttempts,
        sections,
        sectionsCompleted: sections.filter((s) => s.status === 'completed').length,
        sectionsTotal: sections.length,
        _count: {
            UserCourseProgress: userCourseProgress,
            sections: totalSectionsInChapter,
            quizzes: quizzesTotal,
            QuizAnswer: activity.quizAnswerCountByChapter.get(id) ?? 0,
            LastSeenSection: activity.lastSeenCountByChapter.get(id) ?? 0,
        },
        QuizProgress: enrichedQuiz ? [enrichedQuiz] : [],
        quiz: buildChapterQuizSummary(quizRow),
        progress: progress.toFixed(2),
        contribution: '0.00',
    };
}
exports.buildChapterReportRow = buildChapterReportRow;
function applyModuleRollup(module, totalSectionsInCourse, isFrozen) {
    const chaptersCompleted = module.chapters.filter((c) => c.status === 'completed').length;
    module.chapters.forEach((chapter) => {
        const totalSectionsInChapter = chapter._count.sections;
        const userCourseProgress = chapter._count.UserCourseProgress;
        chapter.contribution = isFrozen
            ? totalSectionsInCourse === 0
                ? '0.00'
                : ((totalSectionsInChapter * 100) / totalSectionsInCourse).toFixed(2)
            : totalSectionsInCourse === 0
                ? '0.00'
                : ((userCourseProgress * 100) / totalSectionsInCourse).toFixed(2);
    });
    const timeSpentSeconds = module.chapters.reduce((sum, chapter) => sum + chapter.timeSpentSeconds, 0);
    const totalAttempts = module.chapters.reduce((sum, chapter) => sum + chapter.totalAttempts, 0);
    return {
        ...module,
        status: deriveModuleReportStatus(module.chapters, module.completedAt),
        chaptersCompleted,
        chaptersTotal: module.chapters.length,
        timeSpentSeconds,
        totalAttempts,
    };
}
exports.applyModuleRollup = applyModuleRollup;
//# sourceMappingURL=course-report.js.map