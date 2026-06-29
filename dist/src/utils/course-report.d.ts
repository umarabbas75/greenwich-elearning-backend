export type ChapterReportStatus = 'not_opened' | 'opened' | 'in_progress' | 'completed';
export type SectionReportStatus = 'not_opened' | 'opened' | 'completed';
export type SectionReportMeta = {
    id: string;
    title: string;
    orderIndex: number | null;
    type: string;
};
export type QuizProgressRow = {
    chapterId: string;
    totalAttempts: number;
    isPassed: boolean;
    score: number;
    passingCriteria: number;
    createdAt: Date;
    updatedAt: Date;
};
export type ChapterActivityMaps = {
    progressSectionIds: Set<string>;
    sectionsCompletedByChapter: Map<string, number>;
    sectionCompletedAtById: Map<string, Date>;
    startedAtByChapter: Map<string, Date>;
    openedAtByChapter: Map<string, Date>;
    lastOpenedAtByChapter: Map<string, Date>;
    lastSeenByChapter: Map<string, {
        sectionId: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    quizAnswerCountByChapter: Map<string, number>;
    lastSeenCountByChapter: Map<string, number>;
    quizProgressByChapter: Map<string, QuizProgressRow>;
    timeSpentSecondsBySection: Map<string, number>;
    totalAttemptsBySection: Map<string, number>;
};
export declare function deriveSectionReportStatus(input: {
    completedAt: Date | null;
    isLastSeen: boolean;
}): SectionReportStatus;
export declare function deriveChapterReportStatus(input: {
    sectionsCompleted: number;
    sectionsTotal: number;
    quizzesTotal: number;
    quizPassed: boolean;
    quizAttempted: boolean;
    hasOpened: boolean;
    completedAt: Date | null;
}): ChapterReportStatus;
export declare function deriveModuleReportStatus(chapters: Array<{
    status: ChapterReportStatus;
}>, completedAt: Date | null): ChapterReportStatus;
export declare function buildChapterActivityMaps(input: {
    progressRows: Array<{
        sectionId: string;
        chapterId: string;
        createdAt: Date;
    }>;
    lastSeenRows: Array<{
        chapterId: string;
        sectionId: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    quizAnswerRows: Array<{
        chapterId: string | null;
    }>;
    quizProgressRows: QuizProgressRow[];
    timeSpentRows?: Array<{
        sectionId: string;
        totalSeconds: number;
        totalAttempts: number;
    }>;
}): ChapterActivityMaps;
export declare function buildSectionReportRows(chapterId: string, sections: SectionReportMeta[], activity: ChapterActivityMaps): Array<{
    id: string;
    title: string;
    orderIndex: number | null;
    type: string;
    status: SectionReportStatus;
    isLastSeen: boolean;
    openedAt: Date | null;
    lastOpenedAt: Date | null;
    completedAt: Date | null;
    timeSpentSeconds: number;
    totalAttempts: number | null;
}>;
export declare function buildChapterQuizSummary(quiz: QuizProgressRow | undefined): {
    attempts: number;
    isPassed: boolean;
    score: number;
    passingCriteria: number;
    firstAttemptAt: Date | null;
    lastAttemptAt: Date | null;
} | null;
export type BuildChapterReportInput = {
    id: string;
    title: string;
    sectionMetas: SectionReportMeta[];
    quizzesTotal: number;
    activity: ChapterActivityMaps;
    chapterCompletedAt: Date | null;
    isFrozen: boolean;
};
export declare function buildChapterReportRow(input: BuildChapterReportInput): {
    id: string;
    title: string;
    status: ChapterReportStatus;
    openedAt: Date;
    lastOpenedAt: Date;
    startedAt: Date;
    completedAt: Date;
    timeSpentSeconds: number;
    totalAttempts: number;
    sections: {
        id: string;
        title: string;
        orderIndex: number;
        type: string;
        status: SectionReportStatus;
        isLastSeen: boolean;
        openedAt: Date;
        lastOpenedAt: Date;
        completedAt: Date;
        timeSpentSeconds: number;
        totalAttempts: number;
    }[];
    sectionsCompleted: number;
    sectionsTotal: number;
    _count: {
        UserCourseProgress: number;
        sections: number;
        quizzes: number;
        QuizAnswer: number;
        LastSeenSection: number;
    };
    QuizProgress: QuizProgressRow[];
    quiz: {
        attempts: number;
        isPassed: boolean;
        score: number;
        passingCriteria: number;
        firstAttemptAt: Date;
        lastAttemptAt: Date;
    };
    progress: string;
    contribution: string;
};
export declare function applyModuleRollup(module: {
    id: string;
    title: string;
    completedAt: Date | null;
    chapters: Array<ReturnType<typeof buildChapterReportRow>>;
}, totalSectionsInCourse: number, isFrozen: boolean): {
    status: ChapterReportStatus;
    chaptersCompleted: number;
    chaptersTotal: number;
    timeSpentSeconds: number;
    totalAttempts: number;
    id: string;
    title: string;
    completedAt: Date | null;
    chapters: Array<ReturnType<typeof buildChapterReportRow>>;
};
