import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CourseVersionService } from '../course-version/course-version.service';
import { FeedbackService } from '../feedback/feedback.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CourseService } from './course.service';

describe('CourseService — course versioning', () => {
  let service: CourseService;
  let prisma: Record<string, any>;
  let courseVersionService: Record<string, jest.Mock>;

  const versionTree = {
    mode: 'versioned' as const,
    versionId: 'version-1',
    versionNumber: 1,
    version: {
      id: 'version-1',
      versionNumber: 1,
      modules: [
        {
          id: 'vm-1',
          sourceModuleId: 'mod-1',
          title: 'M',
          orderIndex: 0,
          chapters: [
            {
              id: 'vc-1',
              sourceChapterId: 'ch-1',
              title: 'C',
              description: 'D',
              pdfFile: 'f.pdf',
              orderIndex: 0,
              sections: [
                {
                  id: 'vs-1',
                  sourceSectionId: 'sec-1',
                  isActive: true,
                  orderIndex: 1,
                  title: 'S1',
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
              ],
              quizzes: [],
            },
          ],
        },
      ],
    },
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      course: { findUnique: jest.fn(), findFirst: jest.fn() },
      userCourse: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      section: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
        update: jest.fn(),
      },
      chapter: { findUnique: jest.fn(), delete: jest.fn(), update: jest.fn() },
      module: { findUnique: jest.fn(), delete: jest.fn(), update: jest.fn() },
      userCourseProgress: { findMany: jest.fn() },
      courseCompletion: { findUnique: jest.fn() },
      lastSeenSection: { findUnique: jest.fn() },
      quizProgress: { findMany: jest.fn() },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };

    courseVersionService = {
      resolveCurriculumTree: jest.fn(),
      summarizeNewSincePinnedVersion: jest.fn().mockResolvedValue(null),
      pinEnrollmentToLatest: jest.fn(),
      isReferencedByAnyVersion: jest.fn(),
      findVersionChapterBySourceId: jest.fn(),
      mapVersionSectionsForLearner: jest.fn(),
      mapVersionQuizzesForLearner: jest.fn(),
      buildUserModulesFromVersion: jest.fn(),
      countCompletionDenominator: jest.fn(),
      syncPublishedVersionWithLiveTree: jest.fn(),
      autoPublishAfterStructuralChange: jest.fn().mockResolvedValue({
        versionNumber: 2,
        versionId: 'version-2',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: MailService, useValue: { send: jest.fn() } },
        { provide: FeedbackService, useValue: { notifyFeedbackRequiredIfNeeded: jest.fn() } },
        { provide: CourseVersionService, useValue: courseVersionService },
      ],
    }).compile();

    service = module.get(CourseService);
    jest.clearAllMocks();
  });

  describe('toggleCourseStatus', () => {
    it('pins enrollment on first activation', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.course.findUnique.mockResolvedValue({ id: 'course-1' });
      prisma.userCourse.findFirst.mockResolvedValue({
        id: 'uc-1',
        isActive: false,
        activatedAt: null,
        enrolledVersionId: null,
      });
      prisma.userCourse.update.mockResolvedValue({});

      await service.toggleCourseStatus('user-1', 'course-1', true);

      expect(
        courseVersionService.syncPublishedVersionWithLiveTree,
      ).toHaveBeenCalledWith(
        'course-1',
        null,
        'Sync before first enrollment activation',
      );
      expect(courseVersionService.pinEnrollmentToLatest).toHaveBeenCalledWith(
        'uc-1',
        prisma,
      );
    });

    it('does not pin on deactivation', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.course.findUnique.mockResolvedValue({ id: 'course-1' });
      prisma.userCourse.findFirst.mockResolvedValue({
        id: 'uc-1',
        isActive: true,
        activatedAt: new Date(),
        enrolledVersionId: 'version-1',
      });
      prisma.userCourse.update.mockResolvedValue({});

      await service.toggleCourseStatus('user-1', 'course-1', false);

      expect(courseVersionService.pinEnrollmentToLatest).not.toHaveBeenCalled();
    });
  });

  describe('deleteSection', () => {
    it('archives when referenced by a published version', async () => {
      prisma.section.findUnique.mockResolvedValue({
        id: 'sec-1',
        title: 'S',
        chapterId: 'ch-1',
      });
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        moduleId: 'mod-1',
        module: { courseId: 'course-1' },
      });
      courseVersionService.isReferencedByAnyVersion.mockResolvedValue(true);
      prisma.section.update.mockResolvedValue({ id: 'sec-1', isArchived: true });

      const result = await service.deleteSection('sec-1');

      expect(prisma.section.update).toHaveBeenCalledWith({
        where: { id: 'sec-1' },
        data: { isArchived: true },
      });
      expect(prisma.section.delete).not.toHaveBeenCalled();
      expect(result.message).toContain('archived');
    });

    it('hard-deletes when never published', async () => {
      prisma.section.findUnique.mockResolvedValue({
        id: 'sec-1',
        chapterId: 'ch-1',
      });
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        moduleId: 'mod-1',
        module: { courseId: 'course-1' },
      });
      courseVersionService.isReferencedByAnyVersion.mockResolvedValue(false);
      prisma.section.delete.mockResolvedValue({ id: 'sec-1' });

      await service.deleteSection('sec-1');

      expect(prisma.section.delete).toHaveBeenCalledWith({
        where: { id: 'sec-1' },
      });
    });
  });

  describe('deleteChapter', () => {
    it('archives when referenced by a published version', async () => {
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        moduleId: 'mod-1',
        title: 'C',
      });
      prisma.module.findUnique.mockResolvedValue({
        id: 'mod-1',
        courseId: 'course-1',
      });
      courseVersionService.isReferencedByAnyVersion.mockResolvedValue(true);
      prisma.chapter.update.mockResolvedValue({ id: 'ch-1', isArchived: true });

      const result = await service.deleteChapter('ch-1');

      expect(prisma.chapter.update).toHaveBeenCalled();
      expect(result.message).toContain('archived');
    });
  });

  describe('deleteModule', () => {
    it('archives when referenced by a published version', async () => {
      prisma.module.findUnique.mockResolvedValue({
        id: 'mod-1',
        courseId: 'course-1',
        title: 'M',
      });
      courseVersionService.isReferencedByAnyVersion.mockResolvedValue(true);
      prisma.module.update.mockResolvedValue({ id: 'mod-1', isArchived: true });

      const result = await service.deleteModule('mod-1');

      expect(prisma.module.update).toHaveBeenCalled();
      expect(result.message).toContain('archived');
    });
  });

  describe('getUserChapterProgress', () => {
    it('uses version section count when enrollment is pinned', async () => {
      courseVersionService.resolveCurriculumTree.mockResolvedValue(versionTree);
      courseVersionService.findVersionChapterBySourceId.mockReturnValue({
        module: versionTree.version.modules[0],
        chapter: versionTree.version.modules[0].chapters[0],
      });
      prisma.userCourseProgress.findMany.mockResolvedValue([
        { sectionId: 'sec-1' },
      ]);
      prisma.courseCompletion.findUnique.mockResolvedValue(null);

      const result = await service.getUserChapterProgress(
        'user-1',
        'course-1',
        'ch-1',
      );
      const data = result.data as any;

      expect(data.totalSections).toBe(2);
      expect(data.userCourseProgress).toBe(50);
      expect(data.enrolledVersionNumber).toBe(1);
    });

    it('returns 100% for frozen completers on versioned tree', async () => {
      courseVersionService.resolveCurriculumTree.mockResolvedValue(versionTree);
      courseVersionService.findVersionChapterBySourceId.mockReturnValue({
        module: versionTree.version.modules[0],
        chapter: versionTree.version.modules[0].chapters[0],
      });
      prisma.userCourseProgress.findMany.mockResolvedValue([
        { sectionId: 'sec-1' },
      ]);
      prisma.courseCompletion.findUnique.mockResolvedValue({
        courseCompletedAt: new Date('2026-05-01'),
      });

      const result = await service.getUserChapterProgress(
        'user-1',
        'course-1',
        'ch-1',
      );
      const data = result.data as any;

      expect(data.userCourseProgress).toBe(100);
      expect(data.isCompleted).toBe(true);
    });

    it('uses live chapter sections when unpinned', async () => {
      courseVersionService.resolveCurriculumTree.mockResolvedValue({
        mode: 'live',
      });
      prisma.userCourseProgress.findMany.mockResolvedValue([
        { sectionId: 'sec-1' },
      ]);
      prisma.courseCompletion.findUnique.mockResolvedValue(null);
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        sections: [{ id: 'sec-1' }, { id: 'sec-2' }, { id: 'sec-3' }],
        module: { courseId: 'course-1' },
      });

      const result = await service.getUserChapterProgress(
        'user-1',
        'course-1',
        'ch-1',
      );
      const data = result.data as any;

      expect(data.totalSections).toBe(3);
      expect(data.userCourseProgress).toBeCloseTo(33.33, 0);
    });
  });

  describe('getAllUserSections', () => {
    it('returns versioned sections for pinned enrollment', async () => {
      courseVersionService.resolveCurriculumTree.mockResolvedValue(versionTree);
      courseVersionService.findVersionChapterBySourceId.mockReturnValue({
        module: versionTree.version.modules[0],
        chapter: versionTree.version.modules[0].chapters[0],
      });
      courseVersionService.mapVersionSectionsForLearner.mockReturnValue([
        { id: 'sec-1', title: 'S1', isCompleted: false },
      ]);
      courseVersionService.mapVersionQuizzesForLearner.mockReturnValue([]);
      prisma.userCourseProgress.findMany.mockResolvedValue([]);
      prisma.lastSeenSection.findUnique.mockResolvedValue(null);
      prisma.courseCompletion.findUnique.mockResolvedValue(null);

      const result = await service.getAllUserSections(
        'ch-1',
        'user-1',
        'course-1',
      );

      expect(result.statusCode).toBe(200);
      expect(result.enrolledVersionNumber).toBe(1);
      expect(courseVersionService.mapVersionSectionsForLearner).toHaveBeenCalled();
      expect(prisma.section.findMany).not.toHaveBeenCalled();
    });

    it('throws when chapter missing from pinned version', async () => {
      courseVersionService.resolveCurriculumTree.mockResolvedValue(versionTree);
      courseVersionService.findVersionChapterBySourceId.mockReturnValue(null);
      prisma.userCourseProgress.findMany.mockResolvedValue([]);
      prisma.lastSeenSection.findUnique.mockResolvedValue(null);
      prisma.courseCompletion.findUnique.mockResolvedValue(null);

      await expect(
        service.getAllUserSections('missing-ch', 'user-1', 'course-1'),
      ).rejects.toBeInstanceOf(HttpException);
    });
  });
});
