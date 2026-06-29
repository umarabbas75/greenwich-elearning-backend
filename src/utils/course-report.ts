import { enrichQuizProgressReport } from './chapter-progression';

export type ChapterReportStatus =
  | 'not_opened'
  | 'opened'
  | 'in_progress'
  | 'completed';

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
  lastSeenByChapter: Map<
    string,
    { sectionId: string; createdAt: Date; updatedAt: Date }
  >;
  quizAnswerCountByChapter: Map<string, number>;
  lastSeenCountByChapter: Map<string, number>;
  quizProgressByChapter: Map<string, QuizProgressRow>;
  timeSpentSecondsBySection: Map<string, number>;
};

export function deriveSectionReportStatus(input: {
  completedAt: Date | null;
  isLastSeen: boolean;
}): SectionReportStatus {
  if (input.completedAt) return 'completed';
  if (input.isLastSeen) return 'opened';
  return 'not_opened';
}

export function deriveChapterReportStatus(input: {
  sectionsCompleted: number;
  sectionsTotal: number;
  quizzesTotal: number;
  quizPassed: boolean;
  quizAttempted: boolean;
  hasOpened: boolean;
  completedAt: Date | null;
}): ChapterReportStatus {
  const {
    sectionsCompleted,
    sectionsTotal,
    quizzesTotal,
    quizPassed,
    quizAttempted,
    hasOpened,
    completedAt,
  } = input;

  if (completedAt) return 'completed';

  const sectionsComplete =
    sectionsTotal === 0 || sectionsCompleted >= sectionsTotal;
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

export function deriveModuleReportStatus(
  chapters: Array<{ status: ChapterReportStatus }>,
  completedAt: Date | null,
): ChapterReportStatus {
  if (completedAt) return 'completed';
  if (chapters.length === 0) return 'not_opened';
  if (chapters.every((c) => c.status === 'completed')) return 'completed';
  if (chapters.every((c) => c.status === 'not_opened')) return 'not_opened';
  if (chapters.some((c) => c.status === 'in_progress')) return 'in_progress';
  if (chapters.some((c) => c.status === 'completed')) return 'in_progress';
  if (chapters.some((c) => c.status === 'opened')) return 'opened';
  return 'not_opened';
}

export function buildChapterActivityMaps(input: {
  progressRows: Array<{ sectionId: string; chapterId: string; createdAt: Date }>;
  lastSeenRows: Array<{
    chapterId: string;
    sectionId: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  quizAnswerRows: Array<{ chapterId: string | null }>;
  quizProgressRows: QuizProgressRow[];
  timeSpentRows?: Array<{ sectionId: string; totalSeconds: number }>;
}): ChapterActivityMaps {
  const progressSectionIds = new Set(
    input.progressRows.map((p) => p.sectionId),
  );
  const sectionsCompletedByChapter = new Map<string, number>();
  const sectionCompletedAtById = new Map<string, Date>();
  const startedAtByChapter = new Map<string, Date>();

  for (const row of input.progressRows) {
    sectionsCompletedByChapter.set(
      row.chapterId,
      (sectionsCompletedByChapter.get(row.chapterId) ?? 0) + 1,
    );
    sectionCompletedAtById.set(row.sectionId, row.createdAt);
    const prev = startedAtByChapter.get(row.chapterId);
    if (!prev || row.createdAt < prev) {
      startedAtByChapter.set(row.chapterId, row.createdAt);
    }
  }

  const openedAtByChapter = new Map<string, Date>();
  const lastOpenedAtByChapter = new Map<string, Date>();
  const lastSeenCountByChapter = new Map<string, number>();
  const lastSeenByChapter = new Map<
    string,
    { sectionId: string; createdAt: Date; updatedAt: Date }
  >();

  for (const row of input.lastSeenRows) {
    lastSeenCountByChapter.set(
      row.chapterId,
      (lastSeenCountByChapter.get(row.chapterId) ?? 0) + 1,
    );
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

  const quizAnswerCountByChapter = new Map<string, number>();
  for (const row of input.quizAnswerRows) {
    if (!row.chapterId) continue;
    quizAnswerCountByChapter.set(
      row.chapterId,
      (quizAnswerCountByChapter.get(row.chapterId) ?? 0) + 1,
    );
  }

  const quizProgressByChapter = new Map(
    input.quizProgressRows.map((q) => [q.chapterId, q]),
  );

  const timeSpentSecondsBySection = new Map<string, number>();
  for (const row of input.timeSpentRows ?? []) {
    timeSpentSecondsBySection.set(row.sectionId, row.totalSeconds);
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
  };
}

export function buildSectionReportRows(
  chapterId: string,
  sections: SectionReportMeta[],
  activity: ChapterActivityMaps,
): Array<{
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
}> {
  const lastSeen = activity.lastSeenByChapter.get(chapterId);

  return sections.map((section) => {
    const completedAt =
      activity.sectionCompletedAtById.get(section.id) ?? null;
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
      timeSpentSeconds:
        activity.timeSpentSecondsBySection.get(section.id) ?? 0,
    };
  });
}

export function buildChapterQuizSummary(
  quiz: QuizProgressRow | undefined,
): {
  attempts: number;
  isPassed: boolean;
  score: number;
  passingCriteria: number;
  firstAttemptAt: Date | null;
  lastAttemptAt: Date | null;
} | null {
  if (!quiz) return null;
  const enriched = enrichQuizProgressReport(quiz)!;
  return {
    attempts: enriched.totalAttempts,
    isPassed: enriched.isPassed,
    score: enriched.score,
    passingCriteria: enriched.passingCriteria,
    firstAttemptAt: enriched.createdAt,
    lastAttemptAt: enriched.updatedAt,
  };
}

export type BuildChapterReportInput = {
  id: string;
  title: string;
  sectionMetas: SectionReportMeta[];
  quizzesTotal: number;
  activity: ChapterActivityMaps;
  chapterCompletedAt: Date | null;
  isFrozen: boolean;
};

export function buildChapterReportRow(input: BuildChapterReportInput) {
  const {
    id,
    title,
    sectionMetas,
    quizzesTotal,
    activity,
    chapterCompletedAt,
    isFrozen,
  } = input;

  const versionSectionIds = sectionMetas.map((s) => s.id);
  const sections = buildSectionReportRows(id, sectionMetas, activity);
  const totalSectionsInChapter = versionSectionIds.length;
  const userCourseProgress = Math.min(
    versionSectionIds.filter((sid) => activity.progressSectionIds.has(sid))
      .length,
    totalSectionsInChapter,
  );

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
    ? enrichQuizProgressReport(quizRow)!
    : null;

  const timeSpentSeconds = sections.reduce(
    (sum, section) => sum + section.timeSpentSeconds,
    0,
  );

  return {
    id,
    title,
    status,
    openedAt: activity.openedAtByChapter.get(id) ?? null,
    lastOpenedAt: activity.lastOpenedAtByChapter.get(id) ?? null,
    startedAt: activity.startedAtByChapter.get(id) ?? null,
    completedAt: chapterCompletedAt,
    timeSpentSeconds,
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

export function applyModuleRollup(
  module: {
    id: string;
    title: string;
    completedAt: Date | null;
    chapters: Array<ReturnType<typeof buildChapterReportRow>>;
  },
  totalSectionsInCourse: number,
  isFrozen: boolean,
) {
  const chaptersCompleted = module.chapters.filter(
    (c) => c.status === 'completed',
  ).length;

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

  const timeSpentSeconds = module.chapters.reduce(
    (sum, chapter) => sum + chapter.timeSpentSeconds,
    0,
  );

  return {
    ...module,
    status: deriveModuleReportStatus(module.chapters, module.completedAt),
    chaptersCompleted,
    chaptersTotal: module.chapters.length,
    timeSpentSeconds,
  };
}
