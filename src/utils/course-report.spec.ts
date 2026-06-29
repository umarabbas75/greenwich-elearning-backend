import {
  applyModuleRollup,
  buildChapterActivityMaps,
  buildChapterReportRow,
  buildSectionReportRows,
  deriveChapterReportStatus,
  deriveModuleReportStatus,
  deriveSectionReportStatus,
} from './course-report';

describe('course-report', () => {
  describe('deriveChapterReportStatus', () => {
    it('returns completed when completedAt is set', () => {
      expect(
        deriveChapterReportStatus({
          sectionsCompleted: 0,
          sectionsTotal: 5,
          quizzesTotal: 1,
          quizPassed: false,
          quizAttempted: false,
          hasOpened: false,
          completedAt: new Date(),
        }),
      ).toBe('completed');
    });

    it('returns not_opened when there is no activity', () => {
      expect(
        deriveChapterReportStatus({
          sectionsCompleted: 0,
          sectionsTotal: 3,
          quizzesTotal: 1,
          quizPassed: false,
          quizAttempted: false,
          hasOpened: false,
          completedAt: null,
        }),
      ).toBe('not_opened');
    });

    it('returns opened when viewed but no progress', () => {
      expect(
        deriveChapterReportStatus({
          sectionsCompleted: 0,
          sectionsTotal: 3,
          quizzesTotal: 0,
          quizPassed: false,
          quizAttempted: false,
          hasOpened: true,
          completedAt: null,
        }),
      ).toBe('opened');
    });

    it('returns in_progress when sections partially done', () => {
      expect(
        deriveChapterReportStatus({
          sectionsCompleted: 2,
          sectionsTotal: 5,
          quizzesTotal: 1,
          quizPassed: false,
          quizAttempted: false,
          hasOpened: true,
          completedAt: null,
        }),
      ).toBe('in_progress');
    });

    it('returns in_progress when sections done but quiz not passed', () => {
      expect(
        deriveChapterReportStatus({
          sectionsCompleted: 5,
          sectionsTotal: 5,
          quizzesTotal: 3,
          quizPassed: false,
          quizAttempted: true,
          hasOpened: true,
          completedAt: null,
        }),
      ).toBe('in_progress');
    });
  });

  describe('deriveModuleReportStatus', () => {
    it('returns completed when module completedAt is set', () => {
      expect(
        deriveModuleReportStatus(
          [{ status: 'in_progress' }, { status: 'not_opened' }],
          new Date(),
        ),
      ).toBe('completed');
    });

    it('returns in_progress when any chapter is in progress', () => {
      expect(
        deriveModuleReportStatus(
          [
            { status: 'completed' },
            { status: 'in_progress' },
            { status: 'not_opened' },
          ],
          null,
        ),
      ).toBe('in_progress');
    });
  });

  describe('deriveSectionReportStatus', () => {
    it('returns completed when completedAt is set', () => {
      expect(
        deriveSectionReportStatus({
          completedAt: new Date(),
          isLastSeen: false,
        }),
      ).toBe('completed');
    });

    it('returns opened when last seen but not completed', () => {
      expect(
        deriveSectionReportStatus({
          completedAt: null,
          isLastSeen: true,
        }),
      ).toBe('opened');
    });
  });

  describe('buildSectionReportRows', () => {
    it('marks completed sections with completedAt', () => {
      const completedAt = new Date('2026-06-01T10:05:00.000Z');
      const activity = buildChapterActivityMaps({
        progressRows: [
          {
            sectionId: 'sec-1',
            chapterId: 'ch-1',
            createdAt: completedAt,
          },
        ],
        lastSeenRows: [],
        quizAnswerRows: [],
        quizProgressRows: [],
      });

      const rows = buildSectionReportRows(
        'ch-1',
        [
          { id: 'sec-1', title: 'Intro', orderIndex: 1, type: 'DEFAULT' },
          { id: 'sec-2', title: 'Part 2', orderIndex: 2, type: 'DEFAULT' },
        ],
        activity,
      );

      expect(rows[0].status).toBe('completed');
      expect(rows[0].completedAt).toEqual(completedAt);
      expect(rows[1].status).toBe('not_opened');
    });

    it('exposes totalAttempts for interactive types only', () => {
      const activity = buildChapterActivityMaps({
        progressRows: [],
        lastSeenRows: [],
        quizAnswerRows: [],
        quizProgressRows: [],
        timeSpentRows: [
          { sectionId: 'sec-1', totalSeconds: 0, totalAttempts: 4 },
        ],
      });

      const rows = buildSectionReportRows(
        'ch-1',
        [
          {
            id: 'sec-1',
            title: 'Formative',
            orderIndex: 1,
            type: 'MATCH_AND_LEARN',
          },
          {
            id: 'sec-2',
            title: 'Reading',
            orderIndex: 2,
            type: 'DEFAULT',
          },
        ],
        activity,
      );

      expect(rows[0].totalAttempts).toBe(4);
      expect(rows[1].totalAttempts).toBeNull();
    });
  });

  describe('buildChapterReportRow', () => {
    it('includes status and timestamps from activity maps', () => {
      const openedAt = new Date('2026-06-01T10:00:00.000Z');
      const startedAt = new Date('2026-06-01T10:05:00.000Z');
      const activity = buildChapterActivityMaps({
        progressRows: [
          {
            sectionId: 'sec-1',
            chapterId: 'ch-1',
            createdAt: startedAt,
          },
        ],
        lastSeenRows: [
          {
            chapterId: 'ch-1',
            sectionId: 'sec-2',
            createdAt: openedAt,
            updatedAt: openedAt,
          },
        ],
        quizAnswerRows: [],
        quizProgressRows: [],
      });

      const row = buildChapterReportRow({
        id: 'ch-1',
        title: 'Element 1',
        sectionMetas: [
          { id: 'sec-1', title: 'S1', orderIndex: 1, type: 'DEFAULT' },
          { id: 'sec-2', title: 'S2', orderIndex: 2, type: 'DEFAULT' },
        ],
        quizzesTotal: 2,
        activity,
        chapterCompletedAt: null,
        isFrozen: false,
      });

      expect(row.status).toBe('in_progress');
      expect(row.openedAt).toEqual(openedAt);
      expect(row.startedAt).toEqual(startedAt);
      expect(row.sections).toHaveLength(2);
      expect(row.sectionsCompleted).toBe(1);
      expect(row._count.UserCourseProgress).toBe(1);
      expect(row.quiz).toBeNull();
    });
  });

  describe('time spent rollups', () => {
    it('sums section time to chapter and module levels', () => {
      const activity = buildChapterActivityMaps({
        progressRows: [],
        lastSeenRows: [],
        quizAnswerRows: [],
        quizProgressRows: [],
        timeSpentRows: [
          { sectionId: 'sec-1', totalSeconds: 100, totalAttempts: 0 },
          { sectionId: 'sec-2', totalSeconds: 50, totalAttempts: 0 },
          { sectionId: 'sec-3', totalSeconds: 200, totalAttempts: 0 },
        ],
      });

      const chapter = buildChapterReportRow({
        id: 'ch-1',
        title: 'Element 1',
        sectionMetas: [
          { id: 'sec-1', title: 'S1', orderIndex: 1, type: 'DEFAULT' },
          { id: 'sec-2', title: 'S2', orderIndex: 2, type: 'DEFAULT' },
        ],
        quizzesTotal: 0,
        activity,
        chapterCompletedAt: null,
        isFrozen: false,
      });

      expect(chapter.timeSpentSeconds).toBe(150);
      expect(chapter.sections[0].timeSpentSeconds).toBe(100);
      expect(chapter.sections[1].timeSpentSeconds).toBe(50);

      const activityWithAttempts = buildChapterActivityMaps({
        progressRows: [],
        lastSeenRows: [],
        quizAnswerRows: [],
        quizProgressRows: [],
        timeSpentRows: [
          { sectionId: 'sec-1', totalSeconds: 100, totalAttempts: 3 },
          { sectionId: 'sec-2', totalSeconds: 50, totalAttempts: 2 },
        ],
      });

      const chapterWithAttempts = buildChapterReportRow({
        id: 'ch-1',
        title: 'Element 1',
        sectionMetas: [
          {
            id: 'sec-1',
            title: 'S1',
            orderIndex: 1,
            type: 'ORDERING',
          },
          {
            id: 'sec-2',
            title: 'S2',
            orderIndex: 2,
            type: 'MATCHING',
          },
        ],
        quizzesTotal: 0,
        activity: activityWithAttempts,
        chapterCompletedAt: null,
        isFrozen: false,
      });

      expect(chapterWithAttempts.totalAttempts).toBe(5);

      const otherChapter = buildChapterReportRow({
        id: 'ch-2',
        title: 'Element 2',
        sectionMetas: [
          { id: 'sec-3', title: 'S3', orderIndex: 1, type: 'DEFAULT' },
        ],
        quizzesTotal: 0,
        activity,
        chapterCompletedAt: null,
        isFrozen: false,
      });

      const module = applyModuleRollup(
        {
          id: 'mod-1',
          title: 'Unit 1',
          completedAt: null,
          chapters: [chapterWithAttempts, otherChapter],
        },
        3,
        false,
      );

      expect(otherChapter.timeSpentSeconds).toBe(200);
      expect(module.timeSpentSeconds).toBe(350);
      expect(module.totalAttempts).toBe(5);
    });
  });
});
