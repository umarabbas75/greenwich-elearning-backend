import { Prisma } from '@prisma/client';
import {
  countVersionActiveSections,
  getVersionActiveSectionSourceIds,
  mapVersionQuizToLiveShape,
  mapVersionSectionToLiveShape,
  snapshotLiveTree,
  sortVersionSections,
} from './course-version.snapshot';

describe('course-version.snapshot', () => {
  describe('sortVersionSections', () => {
    it('orders by orderIndex ascending with nulls last', () => {
      const sorted = sortVersionSections([
        { orderIndex: null, id: 'c' },
        { orderIndex: 2, id: 'b' },
        { orderIndex: 1, id: 'a' },
      ]);
      expect(sorted.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('mapVersionSectionToLiveShape', () => {
    it('uses sourceSectionId as id for FE/progress alignment', () => {
      const mapped = mapVersionSectionToLiveShape({
        id: 'version-sec-1',
        sourceSectionId: 'live-sec-1',
        title: 'Intro',
        description: 'Desc',
        shortDescription: null,
        type: 'DEFAULT',
        orderIndex: 1,
        itemLabel: null,
        categoryLabel: null,
        categories: [],
        maxPerCategory: 1,
        isActive: true,
        questionText: null,
        imageUrl: null,
        allowMultipleSelection: false,
        items: null,
        options: null,
        config: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
        versionChapterId: 'version-ch-1',
      });

      expect(mapped.id).toBe('live-sec-1');
      expect(mapped.title).toBe('Intro');
    });

    it('falls back to version row id when sourceSectionId is null', () => {
      const mapped = mapVersionSectionToLiveShape({
        id: 'version-sec-only',
        sourceSectionId: null,
        title: 'T',
        description: 'D',
        shortDescription: null,
        type: 'DEFAULT',
        orderIndex: null,
        itemLabel: null,
        categoryLabel: null,
        categories: [],
        maxPerCategory: 1,
        isActive: true,
        questionText: null,
        imageUrl: null,
        allowMultipleSelection: false,
        items: null,
        options: null,
        config: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        versionChapterId: 'ch',
      });

      expect(mapped.id).toBe('version-sec-only');
    });
  });

  describe('mapVersionQuizToLiveShape', () => {
    it('uses sourceQuizId as id', () => {
      const mapped = mapVersionQuizToLiveShape({
        id: 'version-quiz',
        sourceQuizId: 'live-quiz',
        question: 'Q?',
        answer: 'A',
        options: ['A', 'B'],
      });
      expect(mapped.id).toBe('live-quiz');
      expect(mapped.answer).toBe('A');
    });
  });

  describe('getVersionActiveSectionSourceIds', () => {
    it('returns non-null source section ids', async () => {
      const prisma = {
        courseVersionSection: {
          findMany: jest.fn().mockResolvedValue([
            { sourceSectionId: 's1' },
            { sourceSectionId: 's2' },
          ]),
        },
      };

      const ids = await getVersionActiveSectionSourceIds(prisma as any, 'v1');
      expect(ids).toEqual(['s1', 's2']);
    });
  });

  describe('countVersionActiveSections', () => {
    it('counts active sections in a version', async () => {
      const prisma = {
        courseVersionSection: {
          count: jest.fn().mockResolvedValue(8),
        },
      };

      await expect(
        countVersionActiveSections(prisma as any, 'v1'),
      ).resolves.toBe(8);
    });
  });

  describe('snapshotLiveTree', () => {
    it('materialises live tree into version rows via batched createMany', async () => {
      const createMany = {
        courseVersionModule: jest.fn().mockResolvedValue({ count: 1 }),
        courseVersionChapter: jest.fn().mockResolvedValue({ count: 1 }),
        courseVersionSection: jest.fn().mockResolvedValue({ count: 1 }),
        courseVersionQuiz: jest.fn().mockResolvedValue({ count: 1 }),
      };

      const prisma = {
        courseVersion: { create: jest.fn().mockResolvedValue({}) },
        courseVersionModule: { createMany: createMany.courseVersionModule },
        courseVersionChapter: { createMany: createMany.courseVersionChapter },
        courseVersionSection: { createMany: createMany.courseVersionSection },
        courseVersionQuiz: { createMany: createMany.courseVersionQuiz },
        module: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'mod-1',
              title: 'Module 1',
              description: 'M desc',
              chapters: [
                {
                  id: 'ch-1',
                  title: 'Chapter 1',
                  description: 'C desc',
                  pdfFile: 'pdf.pdf',
                  sections: [
                    {
                      id: 'sec-1',
                      title: 'Section 1',
                      description: 'S desc',
                      shortDescription: null,
                      type: 'DEFAULT',
                      orderIndex: 1,
                      itemLabel: null,
                      categoryLabel: null,
                      categories: [],
                      maxPerCategory: 1,
                      isActive: true,
                      questionText: null,
                      imageUrl: null,
                      allowMultipleSelection: false,
                      items: null,
                      options: null,
                      config: null,
                    },
                  ],
                  quizzes: [
                    {
                      id: 'quiz-1',
                      question: 'Q?',
                      answer: 'A',
                      options: ['A', 'B'],
                    },
                  ],
                },
              ],
            },
          ]),
        },
      };

      const result = await snapshotLiveTree(prisma as any, 'course-1', {
        versionNumber: 1,
        isLatest: true,
      });

      expect(result.versionNumber).toBe(1);
      expect(result.moduleCount).toBe(1);
      expect(result.chapterCount).toBe(1);
      expect(result.sectionCount).toBe(1);
      expect(result.quizCount).toBe(1);
      expect(createMany.courseVersionModule).toHaveBeenCalledTimes(1);
      expect(createMany.courseVersionChapter).toHaveBeenCalledTimes(1);
      expect(createMany.courseVersionSection).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            sourceSectionId: 'sec-1',
            items: Prisma.JsonNull,
          }),
        ]),
      });
      expect(createMany.courseVersionQuiz).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ sourceQuizId: 'quiz-1' }),
        ]),
      });
    });

    it('excludes archived live rows via findMany filters', async () => {
      const prisma = {
        courseVersion: { create: jest.fn().mockResolvedValue({}) },
        courseVersionModule: { createMany: jest.fn() },
        courseVersionChapter: { createMany: jest.fn() },
        courseVersionSection: { createMany: jest.fn() },
        courseVersionQuiz: { createMany: jest.fn() },
        module: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };

      const result = await snapshotLiveTree(prisma as any, 'course-1', {
        versionNumber: 1,
      });

      expect(prisma.module.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { courseId: 'course-1', isArchived: false },
        }),
      );
      expect(result.moduleCount).toBe(0);
      expect(result.sectionCount).toBe(0);
      expect(prisma.courseVersionModule.createMany).not.toHaveBeenCalled();
    });
  });
});
