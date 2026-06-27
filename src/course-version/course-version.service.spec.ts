import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CourseVersionService } from './course-version.service';
import * as snapshotModule from './course-version.snapshot';

jest.mock('./course-version.snapshot', () => ({
  ...jest.requireActual('./course-version.snapshot'),
  snapshotLiveTree: jest.fn(),
  getVersionActiveSectionSourceIds: jest.fn(),
}));

const mockVersionTree = {
  id: 'version-1',
  versionNumber: 1,
  courseId: 'course-1',
  modules: [
    {
      id: 'vm-1',
      sourceModuleId: 'mod-1',
      title: 'Module',
      orderIndex: 0,
      chapters: [
        {
          id: 'vc-1',
          sourceChapterId: 'ch-1',
          title: 'Chapter',
          orderIndex: 0,
          sections: [
            {
              id: 'vs-1',
              sourceSectionId: 'sec-1',
              isActive: true,
              orderIndex: 1,
              title: 'S',
              description: 'D',
              shortDescription: null,
              type: 'DEFAULT',
              itemLabel: null,
              categoryLabel: null,
              categories: [],
              maxPerCategory: 1,
              questionText: null,
              imageUrl: null,
              allowMultipleSelection: false,
              items: null,
              options: null,
              config: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              versionChapterId: 'vc-1',
            },
            {
              id: 'vs-2',
              sourceSectionId: 'sec-2',
              isActive: true,
              orderIndex: 2,
              title: 'S2',
              description: 'D2',
              shortDescription: null,
              type: 'DEFAULT',
              itemLabel: null,
              categoryLabel: null,
              categories: [],
              maxPerCategory: 1,
              questionText: null,
              imageUrl: null,
              allowMultipleSelection: false,
              items: null,
              options: null,
              config: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              versionChapterId: 'vc-1',
            },
          ],
          quizzes: [
            {
              id: 'vq-1',
              sourceQuizId: 'quiz-1',
              question: 'Q',
              answer: 'A',
              options: ['A'],
            },
          ],
        },
      ],
    },
  ],
};

describe('CourseVersionService', () => {
  let service: CourseVersionService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      userCourse: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      userCourseProgress: {
        count: jest.fn().mockResolvedValue(1),
      },
      module: {
        count: jest.fn().mockResolvedValue(1),
      },
      chapter: {
        count: jest.fn().mockResolvedValue(1),
      },
      section: {
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      quiz: {
        count: jest.fn().mockResolvedValue(0),
      },
      courseVersion: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({
          id: 'version-1',
          versionNumber: 1,
          status: 'PUBLISHED',
          isLatest: true,
        }),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      course: {
        findUnique: jest.fn(),
      },
      courseVersionSection: {
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      courseVersionChapter: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      courseVersionModule: {
        count: jest.fn().mockResolvedValue(1),
      },
      courseVersionQuiz: {
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseVersionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CourseVersionService);
    jest.clearAllMocks();
  });

  describe('resolveCurriculumTree', () => {
    it('returns live mode when enrollment has no pin', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({ enrolledVersionId: null });

      await expect(
        service.resolveCurriculumTree('user-1', 'course-1'),
      ).resolves.toEqual({ mode: 'live' });
    });

    it('returns versioned mode when pin exists', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-1',
        enrolledVersionId: 'version-1',
      });
      prisma.courseVersion.findUnique.mockResolvedValue(mockVersionTree);

      const result = await service.resolveCurriculumTree('user-1', 'course-1');
      expect(result.mode).toBe('versioned');
      if (result.mode === 'versioned') {
        expect(result.versionNumber).toBe(1);
        expect(result.versionId).toBe('version-1');
      }
    });

    it('falls back to live when pinned version row is missing', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-1',
        enrolledVersionId: 'version-1',
      });
      prisma.courseVersion.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveCurriculumTree('user-1', 'course-1'),
      ).resolves.toEqual({ mode: 'live' });
    });
  });

  describe('getVersionQuizzesForChapter', () => {
    it('returns null when learner is unpinned', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({ enrolledVersionId: null });

      await expect(
        service.getVersionQuizzesForChapter('user-1', 'course-1', 'ch-1'),
      ).resolves.toBeNull();
    });

    it('returns mapped quizzes for pinned chapter only', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-1',
        enrolledVersionId: 'version-1',
      });
      prisma.userCourseProgress.count.mockResolvedValue(1);
      prisma.courseVersion.findUnique.mockResolvedValue({ id: 'version-1' });
      prisma.courseVersionChapter.findFirst.mockResolvedValue({
        id: 'vc-1',
        quizzes: [
          {
            id: 'vq-1',
            sourceQuizId: 'quiz-1',
            question: 'Q?',
            answer: 'A',
            options: ['A', 'B'],
          },
        ],
      });

      const result = await service.getVersionQuizzesForChapter(
        'user-1',
        'course-1',
        'ch-1',
      );

      expect(result).toEqual([
        { id: 'quiz-1', question: 'Q?', options: ['A', 'B'] },
      ]);
      expect(prisma.courseVersionChapter.findFirst).toHaveBeenCalledWith({
        where: { versionId: 'version-1', sourceChapterId: 'ch-1' },
        include: {
          quizzes: { orderBy: { createdAt: 'asc' } },
        },
      });
    });
  });

  describe('resolveEnrolledVersionId', () => {
    it('returns null when enrollment has no pin', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({ enrolledVersionId: null });

      await expect(
        service.resolveEnrolledVersionId('user-1', 'course-1'),
      ).resolves.toBeNull();
    });
  });

  describe('pinEnrollmentToLatest', () => {
    it('no-ops when already pinned', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-1',
        courseId: 'course-1',
        enrolledVersionId: 'version-1',
      });

      await service.pinEnrollmentToLatest('uc-1');
      expect(prisma.userCourse.update).not.toHaveBeenCalled();
    });

    it('pins to latest published version', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-1',
        courseId: 'course-1',
        enrolledVersionId: null,
      });
      prisma.courseVersion.findFirst.mockResolvedValue({ id: 'version-latest' });

      await service.pinEnrollmentToLatest('uc-1');

      expect(prisma.userCourse.update).toHaveBeenCalledWith({
        where: { id: 'uc-1' },
        data: { enrolledVersionId: 'version-latest' },
      });
    });

    it('no-ops when no published version exists', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-1',
        courseId: 'course-1',
        enrolledVersionId: null,
      });
      prisma.courseVersion.findFirst.mockResolvedValue(null);

      await service.pinEnrollmentToLatest('uc-1');
      expect(prisma.userCourse.update).not.toHaveBeenCalled();
    });
  });

  describe('publishNewVersion', () => {
    it('throws when course not found', async () => {
      prisma.course.findUnique.mockResolvedValue(null);
      await expect(
        service.publishNewVersion('admin-1', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates next version and demotes previous latest', async () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'course-1',
        title: 'Test Course',
      });
      prisma.courseVersion.findFirst.mockResolvedValue({
        id: 'v-old',
        versionNumber: 1,
      });
      (snapshotModule.snapshotLiveTree as jest.Mock).mockResolvedValue({
        versionId: 'v-new',
        versionNumber: 2,
        moduleCount: 1,
        chapterCount: 1,
        sectionCount: 2,
        quizCount: 0,
      });
      prisma.courseVersion.findUnique.mockResolvedValue({
        id: 'v-new',
        versionNumber: 2,
        courseId: 'course-1',
      });

      const result = await service.publishNewVersion(
        'admin-1',
        'course-1',
        'Added chapter',
      );

      expect(prisma.courseVersion.update).toHaveBeenCalledWith({
        where: { id: 'v-old' },
        data: { isLatest: false },
      });
      expect(snapshotModule.snapshotLiveTree).toHaveBeenCalledWith(
        prisma,
        'course-1',
        expect.objectContaining({
          versionNumber: 2,
          isLatest: true,
          publishedByAdminId: 'admin-1',
          changeNotes: 'Added chapter',
        }),
      );
      expect(result.statusCode).toBe(200);
      expect(result.data.stats.sections).toBe(2);
    });
  });

  describe('archiveVersion', () => {
    it('throws when version has pinned enrollments', async () => {
      prisma.courseVersion.findFirst.mockResolvedValue({
        id: 'v1',
        versionNumber: 1,
        isLatest: false,
        _count: { enrollments: 3 },
      });

      await expect(
        service.archiveVersion('admin', 'course-1', 'v1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws when archiving latest version', async () => {
      prisma.courseVersion.findFirst.mockResolvedValue({
        id: 'v2',
        versionNumber: 2,
        isLatest: true,
        _count: { enrollments: 0 },
      });

      await expect(
        service.archiveVersion('admin', 'course-1', 'v2'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('archives unused non-latest version', async () => {
      prisma.courseVersion.findFirst.mockResolvedValue({
        id: 'v1',
        versionNumber: 1,
        isLatest: false,
        _count: { enrollments: 0 },
      });

      const result = await service.archiveVersion('admin', 'course-1', 'v1');
      expect(prisma.courseVersion.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { status: 'ARCHIVED' },
      });
      expect(result.data.versionId).toBe('v1');
    });
  });

  describe('migrateLearnerToVersion', () => {
    it('updates enrollment pin to target version', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-1',
        courseId: 'course-1',
      });
      prisma.courseVersion.findFirst.mockResolvedValue({
        id: 'v2',
        versionNumber: 2,
      });

      const result = await service.migrateLearnerToVersion(
        'admin',
        'uc-1',
        'v2',
      );

      expect(prisma.userCourse.update).toHaveBeenCalledWith({
        where: { id: 'uc-1' },
        data: { enrolledVersionId: 'v2' },
      });
      expect(result.data.versionNumber).toBe(2);
    });
  });

  describe('countCompletionDenominator', () => {
    it('uses live sections when unpinned', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({ enrolledVersionId: null });
      prisma.section.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);

      await expect(
        service.countCompletionDenominator('user-1', 'course-1'),
      ).resolves.toEqual({
        total: 2,
        liveSectionIds: ['s1', 's2'],
      });
    });

    it('uses version section source ids when pinned', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        enrolledVersionId: 'version-1',
      });
      prisma.courseVersion.findUnique.mockResolvedValue(mockVersionTree);
      (snapshotModule.getVersionActiveSectionSourceIds as jest.Mock).mockResolvedValue(
        ['sec-1', 'sec-2'],
      );

      await expect(
        service.countCompletionDenominator('user-1', 'course-1'),
      ).resolves.toEqual({
        total: 2,
        liveSectionIds: ['sec-1', 'sec-2'],
      });
    });
  });

  describe('buildUserModulesFromVersion', () => {
    it('builds tree with live ids and progress counts', () => {
      const progressByChapter = new Map([['ch-1', 1]]);
      const progressByModule = new Map([['mod-1', 1]]);

      const modules = service.buildUserModulesFromVersion(
        mockVersionTree as any,
        'user-1',
        progressByChapter,
        progressByModule,
      );

      expect(modules).toHaveLength(1);
      expect(modules[0].id).toBe('mod-1');
      expect(modules[0].chapters[0].id).toBe('ch-1');
      expect(modules[0].chapters[0]._count.sections).toBe(2);
      expect(modules[0].chapters[0]._count.UserCourseProgress).toBe(1);
    });
  });

  describe('findVersionChapterBySourceId', () => {
    it('finds chapter by live source id', () => {
      const found = service.findVersionChapterBySourceId(
        mockVersionTree as any,
        'ch-1',
      );
      expect(found?.chapter.sourceChapterId).toBe('ch-1');
    });

    it('returns null when not found', () => {
      expect(
        service.findVersionChapterBySourceId(mockVersionTree as any, 'missing'),
      ).toBeNull();
    });
  });

  describe('mapVersionQuizzesForLearner', () => {
    it('strips answers for learners', () => {
      const mapped = service.mapVersionQuizzesForLearner(
        mockVersionTree.modules[0].chapters[0].quizzes as any,
        false,
      );
      expect(mapped[0].id).toBe('quiz-1');
      expect(mapped[0]).not.toHaveProperty('answer');
    });

    it('includes answers for admin preview', () => {
      const mapped = service.mapVersionQuizzesForLearner(
        mockVersionTree.modules[0].chapters[0].quizzes as any,
        true,
      );
      expect(mapped[0]).toHaveProperty('answer', 'A');
    });
  });

  describe('summarizeNewSincePinnedVersion', () => {
    it('returns null when unpinned', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({ enrolledVersionId: null });
      await expect(
        service.summarizeNewSincePinnedVersion('user-1', 'course-1'),
      ).resolves.toBeNull();
    });

    it('returns diff when pinned to older version', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        enrolledVersionId: 'v1',
      });
      prisma.courseVersion.findFirst.mockResolvedValue({ id: 'v2' });
      prisma.courseVersionSection.findMany
        .mockResolvedValueOnce([{ sourceSectionId: 'sec-1' }])
        .mockResolvedValueOnce([
          {
            sourceSectionId: 'sec-new',
            versionChapterId: 'vc-new',
            createdAt: new Date('2026-06-15'),
          },
        ]);
      prisma.courseVersionChapter.findMany
        .mockResolvedValueOnce([{ sourceChapterId: 'ch-1' }])
        .mockResolvedValueOnce([
          { id: 'vc-new', sourceChapterId: 'ch-new' },
        ]);

      const result = await service.summarizeNewSincePinnedVersion(
        'user-1',
        'course-1',
      );

      expect(result).toEqual({
        newChapters: 1,
        newSections: 1,
        addedAt: new Date('2026-06-15'),
      });
    });
  });

  describe('isReferencedByAnyVersion', () => {
    it('checks section references', async () => {
      prisma.courseVersionSection.count.mockResolvedValue(1);
      await expect(
        service.isReferencedByAnyVersion('section', 'sec-1'),
      ).resolves.toBe(true);
    });

    it('returns false when not referenced', async () => {
      prisma.courseVersionQuiz.count.mockResolvedValue(0);
      await expect(
        service.isReferencedByAnyVersion('quiz', 'quiz-1'),
      ).resolves.toBe(false);
    });
  });
});
