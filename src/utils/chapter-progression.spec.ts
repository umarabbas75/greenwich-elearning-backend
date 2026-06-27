import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertChapterAccessible,
  getOrderedChapterIdsForVersion,
  isChapterComplete,
} from './chapter-progression';

describe('chapter-progression', () => {
  let prisma: Record<string, any>;
  let config: ConfigService;

  beforeEach(() => {
    prisma = {
      chapter: { findUnique: jest.fn() },
      userCourse: { findUnique: jest.fn() },
      courseVersionModule: { findMany: jest.fn() },
      module: { findMany: jest.fn() },
      courseVersionChapter: { findFirst: jest.fn() },
      section: { count: jest.fn() },
      quiz: { count: jest.fn() },
      userCourseProgress: { count: jest.fn() },
      quizProgress: { findFirst: jest.fn() },
    };
    config = { get: jest.fn().mockReturnValue('') } as unknown as ConfigService;
  });

  describe('getOrderedChapterIdsForVersion', () => {
    it('returns source chapter ids in order', async () => {
      prisma.courseVersionModule.findMany.mockResolvedValue([
        {
          chapters: [{ sourceChapterId: 'ch-1' }, { sourceChapterId: 'ch-2' }],
        },
      ]);

      await expect(
        getOrderedChapterIdsForVersion(prisma as unknown as PrismaService, 'v1'),
      ).resolves.toEqual(['ch-1', 'ch-2']);
    });
  });

  describe('isChapterComplete', () => {
    it('uses version denominator when enrollment context is provided', async () => {
      prisma.courseVersionChapter.findFirst.mockResolvedValue({
        _count: { sections: 2, quizzes: 1 },
      });
      prisma.userCourseProgress.count.mockResolvedValue(2);
      prisma.quizProgress.findFirst.mockResolvedValue({ isPassed: true });

      await expect(
        isChapterComplete(prisma as unknown as PrismaService, 'user-1', 'ch-1', {
          courseId: 'course-1',
          enrolledVersionId: 'version-1',
        }),
      ).resolves.toBe(true);

      expect(prisma.chapter.findUnique).not.toHaveBeenCalled();
      expect(prisma.userCourse.findUnique).not.toHaveBeenCalled();
    });

    it('returns false when sections incomplete', async () => {
      prisma.courseVersionChapter.findFirst.mockResolvedValue({
        _count: { sections: 3, quizzes: 0 },
      });
      prisma.userCourseProgress.count.mockResolvedValue(2);
      prisma.quizProgress.findFirst.mockResolvedValue(null);

      await expect(
        isChapterComplete(prisma as unknown as PrismaService, 'user-1', 'ch-1', {
          courseId: 'course-1',
          enrolledVersionId: 'version-1',
        }),
      ).resolves.toBe(false);
    });
  });

  describe('assertChapterAccessible', () => {
    it('skips gate for first chapter in course', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        enrolledVersionId: 'version-1',
      });
      prisma.courseVersionModule.findMany.mockResolvedValue([
        { chapters: [{ sourceChapterId: 'ch-1' }] },
      ]);

      await expect(
        assertChapterAccessible(
          prisma as unknown as PrismaService,
          config,
          'user-1',
          'ch-1',
          'learner@test.com',
          { courseId: 'course-1' },
        ),
      ).resolves.toBeUndefined();

      expect(prisma.userCourseProgress.count).not.toHaveBeenCalled();
    });

    it('throws when previous chapter is incomplete', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        enrolledVersionId: 'version-1',
      });
      prisma.courseVersionModule.findMany.mockResolvedValue([
        {
          chapters: [
            { sourceChapterId: 'ch-1' },
            { sourceChapterId: 'ch-2' },
          ],
        },
      ]);
      prisma.courseVersionChapter.findFirst.mockResolvedValue({
        _count: { sections: 2, quizzes: 1 },
      });
      prisma.userCourseProgress.count.mockResolvedValue(1);
      prisma.quizProgress.findFirst.mockResolvedValue({ isPassed: false });

      await expect(
        assertChapterAccessible(
          prisma as unknown as PrismaService,
          config,
          'user-1',
          'ch-2',
          'learner@test.com',
          { courseId: 'course-1' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
