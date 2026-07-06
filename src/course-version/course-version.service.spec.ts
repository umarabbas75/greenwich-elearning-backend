import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CourseVersionService } from './course-version.service';
import * as manifestModule from './course-version.manifest';

jest.mock('./course-version.manifest', () => ({
  ...jest.requireActual('./course-version.manifest'),
  loadPinnedCurriculum: jest.fn(),
  buildManifestFromLiveTree: jest.fn(),
  publishManifestVersion: jest.fn(),
}));

const mockManifest = {
  modules: [
    {
      sourceId: 'mod-1',
      order: 0,
      chapters: [
        {
          sourceId: 'ch-1',
          order: 0,
          sectionIds: ['sec-1', 'sec-2'],
          quizIds: ['quiz-1'],
        },
      ],
    },
  ],
};

const mockPinnedTree = {
  versionId: 'version-1',
  versionNumber: 1,
  manifest: mockManifest,
  modules: [
    {
      sourceModuleId: 'mod-1',
      title: 'Module',
      description: 'Desc',
      orderIndex: 0,
      chapters: [
        {
          sourceChapterId: 'ch-1',
          title: 'Chapter',
          description: 'D',
          pdfFile: 'f.pdf',
          orderIndex: 0,
          sections: [
            {
              id: 'sec-1',
              title: 'S',
              description: 'D',
              chapterId: 'ch-1',
              moduleId: 'mod-1',
              isActive: true,
              orderIndex: 1,
              type: 'DEFAULT',
              categories: [],
              maxPerCategory: 1,
              allowMultipleSelection: false,
              createdAt: new Date(),
              updatedAt: new Date(),
              shortDescription: null,
              itemLabel: null,
              categoryLabel: null,
              questionText: null,
              imageUrl: null,
              items: null,
              options: null,
              config: null,
            },
            {
              id: 'sec-2',
              title: 'S2',
              description: 'D2',
              chapterId: 'ch-1',
              moduleId: 'mod-1',
              isActive: true,
              orderIndex: 2,
              type: 'DEFAULT',
              categories: [],
              maxPerCategory: 1,
              allowMultipleSelection: false,
              createdAt: new Date(),
              updatedAt: new Date(),
              shortDescription: null,
              itemLabel: null,
              categoryLabel: null,
              questionText: null,
              imageUrl: null,
              items: null,
              options: null,
              config: null,
            },
          ],
          quizzes: [
            {
              id: 'quiz-1',
              question: 'Q',
              options: ['A'],
              answer: 'A',
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
      section: {
        findMany: jest.fn(),
      },
      courseVersion: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({
          id: 'version-1',
          versionNumber: 1,
          status: 'PUBLISHED',
          isLatest: true,
          manifest: mockManifest,
          sectionCount: 2,
        }),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
      course: {
        findUnique: jest.fn(),
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
    (manifestModule.loadPinnedCurriculum as jest.Mock).mockResolvedValue(
      mockPinnedTree,
    );
  });

  describe('resolveCurriculumTree', () => {
    it('returns live mode when enrollment has no pin', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({ enrolledVersionId: null });

      await expect(
        service.resolveCurriculumTree('user-1', 'course-1'),
      ).resolves.toEqual({ mode: 'live' });
    });

    it('returns versioned tree when pin exists', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-1',
        enrolledVersionId: 'version-1',
      });
      prisma.courseVersion.findUnique.mockResolvedValue({ id: 'version-1' });

      const result = await service.resolveCurriculumTree('user-1', 'course-1');
      expect(result.mode).toBe('versioned');
      if (result.mode === 'versioned') {
        expect(result.versionNumber).toBe(1);
        expect(result.tree.modules).toHaveLength(1);
      }
      expect(manifestModule.loadPinnedCurriculum).toHaveBeenCalledWith(
        prisma,
        'version-1',
      );
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
      const result = await service.getVersionQuizzesForChapter(
        'user-1',
        'course-1',
        'ch-1',
        false,
        'version-1',
      );

      expect(result).toEqual([
        { id: 'quiz-1', question: 'Q', options: ['A'] },
      ]);
    });
  });

  describe('publishNewVersion', () => {
    it('throws when course not found', async () => {
      prisma.course.findUnique.mockResolvedValue(null);
      await expect(
        service.publishNewVersion('admin-1', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('skips publish when structural fingerprint unchanged', async () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'course-1',
        title: 'Test Course',
      });
      prisma.courseVersion.findFirst.mockResolvedValue({
        id: 'v-old',
        versionNumber: 1,
        manifest: mockManifest,
        sectionCount: 2,
      });
      (manifestModule.buildManifestFromLiveTree as jest.Mock).mockResolvedValue({
        manifest: mockManifest,
        sectionCount: 2,
        moduleCount: 1,
        chapterCount: 1,
        quizCount: 1,
      });

      const result = await service.publishNewVersion('admin-1', 'course-1');
      expect((result.data as { skipped?: boolean }).skipped).toBe(true);
      expect(manifestModule.publishManifestVersion).not.toHaveBeenCalled();
    });

    it('creates next manifest version and demotes previous latest', async () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'course-1',
        title: 'Test Course',
      });
      prisma.courseVersion.findFirst
        .mockResolvedValueOnce({
          id: 'v-old',
          versionNumber: 1,
          manifest: mockManifest,
          sectionCount: 2,
        })
        .mockResolvedValueOnce({
          id: 'v-old',
          versionNumber: 1,
        });
      (manifestModule.buildManifestFromLiveTree as jest.Mock).mockResolvedValue({
        manifest: {
          ...mockManifest,
          modules: [
            {
              ...mockManifest.modules[0],
              chapters: [
                {
                  ...mockManifest.modules[0].chapters[0],
                  sectionIds: ['sec-1', 'sec-2', 'sec-3'],
                },
              ],
            },
          ],
        },
        sectionCount: 3,
        moduleCount: 1,
        chapterCount: 1,
        quizCount: 1,
      });
      (manifestModule.publishManifestVersion as jest.Mock).mockResolvedValue({
        versionId: 'v-new',
        versionNumber: 2,
        sectionCount: 3,
        moduleCount: 1,
        chapterCount: 1,
        quizCount: 1,
      });
      prisma.courseVersion.findUnique.mockResolvedValue({
        id: 'v-new',
        versionNumber: 2,
        courseId: 'course-1',
      });

      const result = await service.publishNewVersion(
        'admin-1',
        'course-1',
        'Added section',
      );

      expect(prisma.courseVersion.update).toHaveBeenCalledWith({
        where: { id: 'v-old' },
        data: { isLatest: false },
      });
      expect(manifestModule.publishManifestVersion).toHaveBeenCalled();
      expect(result.statusCode).toBe(200);
      expect(result.data.stats.sections).toBe(3);
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

    it('uses sectionCount from manifest when pinned', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        enrolledVersionId: 'version-1',
      });
      prisma.courseVersion.findUnique.mockResolvedValue({
        sectionCount: 2,
        manifest: mockManifest,
      });

      await expect(
        service.countCompletionDenominator('user-1', 'course-1'),
      ).resolves.toEqual({
        total: 2,
        liveSectionIds: ['sec-1', 'sec-2'],
      });
    });

    it('falls back to loadPinnedCurriculum when sectionCount set but manifest corrupt', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        enrolledVersionId: 'version-1',
      });
      prisma.courseVersion.findUnique.mockResolvedValue({
        sectionCount: 2,
        manifest: { bad: true },
      });

      await expect(
        service.countCompletionDenominator('user-1', 'course-1'),
      ).resolves.toEqual({
        total: 2,
        liveSectionIds: ['sec-1', 'sec-2'],
      });
      expect(manifestModule.loadPinnedCurriculum).toHaveBeenCalled();
    });
  });

  describe('buildUserModulesFromVersion', () => {
    it('builds tree with live ids and progress counts', () => {
      const progressByChapter = new Map([['ch-1', 1]]);
      const progressByModule = new Map([['mod-1', 1]]);

      const modules = service.buildUserModulesFromVersion(
        mockPinnedTree as any,
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

  describe('summarizeNewSincePinnedVersion', () => {
    it('returns diff when pinned to older version', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        enrolledVersionId: 'v1',
      });
      prisma.courseVersion.findUnique.mockResolvedValue({
        manifest: mockManifest,
        publishedAt: new Date('2026-06-01'),
      });
      prisma.courseVersion.findFirst.mockResolvedValue({
        id: 'v2',
        manifest: {
          modules: [
            {
              ...mockManifest.modules[0],
              chapters: [
                ...mockManifest.modules[0].chapters,
                {
                  sourceId: 'ch-new',
                  order: 1,
                  sectionIds: ['sec-new'],
                  quizIds: [],
                },
              ],
            },
          ],
        },
        publishedAt: new Date('2026-06-15'),
      });

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
    it('checks manifest membership', async () => {
      prisma.courseVersion.findMany.mockResolvedValue([
        { manifest: mockManifest },
      ]);
      await expect(
        service.isReferencedByAnyVersion('section', 'sec-1', 'course-1'),
      ).resolves.toBe(true);
    });

    it('returns false when not referenced', async () => {
      prisma.courseVersion.findMany.mockResolvedValue([
        { manifest: mockManifest },
      ]);
      await expect(
        service.isReferencedByAnyVersion('quiz', 'quiz-9', 'course-1'),
      ).resolves.toBe(false);
    });
  });

  describe('pruneOrphanVersions', () => {
    it('deletes versions with zero enrollments that are not latest', async () => {
      prisma.courseVersion.findMany.mockResolvedValue([
        {
          id: 'v1',
          versionNumber: 1,
          isLatest: false,
          _count: { enrollments: 0 },
        },
        {
          id: 'v2',
          versionNumber: 2,
          isLatest: true,
          _count: { enrollments: 0 },
        },
      ]);

      const result = await service.pruneOrphanVersions('course-1');
      expect(prisma.courseVersion.delete).toHaveBeenCalledTimes(1);
      expect(result.data.deleted).toBe(1);
      expect(result.data.versionNumbers).toEqual([1]);
    });
  });
});
