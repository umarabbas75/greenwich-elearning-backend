import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CourseVersionService } from '../course-version/course-version.service';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { FeedbackService } from '../feedback/feedback.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { CourseService } from './course.service';

/**
 * PR 1 tests — restore endpoints (module, chapter, section) + archive
 * inventory endpoint. `restoreQuiz` lives in the QuizService test file
 * because it's owned by QuizService.
 *
 * Split into its own spec file so `course.service.versioning.spec.ts` does
 * not keep growing without bound as new admin-visibility features land.
 */
describe('CourseService — restore + archive inventory (PR 1)', () => {
  let service: CourseService;
  let prisma: Record<string, any>;
  let courseVersionService: Record<string, jest.Mock>;

  // Minimal manifest fixture: v1 references sec-1 (and no others), so the
  // "publishedInLatest" branch in restoreSection can be exercised in both
  // states just by choosing sec-1 vs sec-2.
  const mockManifest = {
    modules: [
      {
        sourceId: 'mod-1',
        order: 0,
        chapters: [
          {
            sourceId: 'ch-1',
            order: 0,
            sectionIds: ['sec-1'],
            quizIds: [],
          },
        ],
      },
    ],
  };

  const latestPublished = {
    id: 'ver-latest',
    versionNumber: 5,
    manifest: mockManifest,
    sectionCount: 1,
    publishedAt: new Date('2026-08-01'),
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      course: { findUnique: jest.fn() },
      module: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn((args) =>
          Promise.resolve({ id: args.where.id, ...args.data }),
        ),
      },
      chapter: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn((args) =>
          Promise.resolve({ id: args.where.id, ...args.data }),
        ),
      },
      section: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn((args) =>
          Promise.resolve({ id: args.where.id, ...args.data }),
        ),
      },
      quiz: { findMany: jest.fn().mockResolvedValue([]) },
    };

    courseVersionService = {
      getLatestPublishedVersion: jest.fn().mockResolvedValue(latestPublished),
      writeAudit: jest.fn().mockResolvedValue(undefined),
      buildRestoreNote: jest.fn().mockReturnValue('BUILD_RESTORE_NOTE_STUB'),
      getReferencingVersionsWithEnrollmentsBatch: jest
        .fn()
        .mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: MailService, useValue: { send: jest.fn() } },
        {
          provide: FeedbackService,
          useValue: { notifyFeedbackRequiredIfNeeded: jest.fn() },
        },
        { provide: CourseVersionService, useValue: courseVersionService },
        {
          provide: CourseCompletionService,
          useValue: { checkContentCompletion: jest.fn() },
        },
        {
          provide: NotificationService,
          useValue: {
            createNotification: jest.fn(),
            createNotificationForMany: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(CourseService);
    jest.clearAllMocks();
  });

  // ─── restoreModule ─────────────────────────────────────────────────────

  describe('restoreModule', () => {
    it('flips isArchived to false and clears archivedAt', async () => {
      prisma.module.findUnique.mockResolvedValue({
        id: 'mod-archived',
        courseId: 'course-1',
        isArchived: true,
        title: 'Archived Module',
      });

      const result = await service.restoreModule('mod-archived', 'admin-1');

      expect(prisma.module.update).toHaveBeenCalledWith({
        where: { id: 'mod-archived' },
        // archivedAt: null — restored rows must not linger in the inventory's
        // "recently archived" sort. Leaving archivedAt populated would resurface
        // them there confusingly.
        data: { isArchived: false, archivedAt: null },
      });
      expect(result.statusCode).toBe(200);
      expect(result.message).toBe('Restored');
      expect((result.data as any).entityType).toBe('module');
    });

    it('emits RESTORE_ENTITY audit with correct metadata', async () => {
      prisma.module.findUnique.mockResolvedValue({
        id: 'mod-archived',
        courseId: 'course-1',
        isArchived: true,
        title: 'Archived Module',
      });

      await service.restoreModule('mod-archived', 'admin-1');

      expect(courseVersionService.writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 'admin-1',
          action: 'RESTORE_ENTITY',
          targetType: 'Module',
          targetId: 'mod-archived',
          courseId: 'course-1',
          metadata: expect.objectContaining({
            entityType: 'module',
            priorIsArchived: true,
            parentWasArchived: false,
            title: 'Archived Module',
          }),
        }),
      );
    });

    it('returns 409 when the row is already live', async () => {
      prisma.module.findUnique.mockResolvedValue({
        id: 'mod-live',
        courseId: 'course-1',
        isArchived: false,
        title: 'Live',
      });

      await expect(
        service.restoreModule('mod-live', 'admin-1'),
      ).rejects.toThrow(HttpException);
      expect(prisma.module.update).not.toHaveBeenCalled();
    });

    it('returns 404 when the row is missing', async () => {
      prisma.module.findUnique.mockResolvedValue(null);

      await expect(
        service.restoreModule('mod-does-not-exist', 'admin-1'),
      ).rejects.toThrow(HttpException);
    });

    it('omits the restore note when publishedInLatest is true', async () => {
      // The manifest references sec-1 but not any module id we test with,
      // so we need a manifest that has our module. Rewrite the latest for
      // this test — the isIdReferencedInManifest is a pure function of the
      // manifest, so we swap in one that references the module we restore.
      courseVersionService.getLatestPublishedVersion.mockResolvedValue({
        id: 'ver-latest',
        versionNumber: 5,
        manifest: {
          modules: [
            {
              sourceId: 'mod-restored',
              order: 0,
              chapters: [
                { sourceId: 'ch-a', order: 0, sectionIds: [], quizIds: [] },
              ],
            },
          ],
        },
      });
      prisma.module.findUnique.mockResolvedValue({
        id: 'mod-restored',
        courseId: 'course-1',
        isArchived: true,
        title: 'Restored',
      });

      const result = await service.restoreModule('mod-restored', 'admin-1');

      expect((result.data as any).publishedInLatest).toBe(true);
      // No secondary note when the latest already renders this row — the
      // admin doesn't need the "publish to make visible" nudge.
      expect((result.data as any).note).toBeUndefined();
    });

    it('includes the restore note when publishedInLatest is false', async () => {
      // Default `mockManifest` doesn't reference this module — expect the note.
      prisma.module.findUnique.mockResolvedValue({
        id: 'mod-orphan',
        courseId: 'course-1',
        isArchived: true,
        title: 'Orphan',
      });

      const result = await service.restoreModule('mod-orphan', 'admin-1');

      expect((result.data as any).publishedInLatest).toBe(false);
      expect((result.data as any).note).toBe('BUILD_RESTORE_NOTE_STUB');
      expect(courseVersionService.buildRestoreNote).toHaveBeenCalledWith(5);
    });
  });

  // ─── restoreChapter ────────────────────────────────────────────────────

  describe('restoreChapter', () => {
    it('returns 409 with structured details when the parent module is archived', async () => {
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-archived',
        moduleId: 'mod-parent',
        isArchived: true,
        title: 'Archived Ch',
        module: {
          id: 'mod-parent',
          isArchived: true,
          title: 'Archived Parent',
          courseId: 'course-1',
        },
      });

      try {
        await service.restoreChapter('ch-archived', 'admin-1');
        throw new Error('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        const err = (e as HttpException).getResponse() as any;
        expect(err.status).toBe(409);
        // FE reads these to route the admin at the correct-level restore.
        expect(err.details.parentEntityType).toBe('module');
        expect(err.details.parentId).toBe('mod-parent');
        expect(err.details.parentTitle).toBe('Archived Parent');
        expect(err.details.chain).toHaveLength(1);
      }
      expect(prisma.chapter.update).not.toHaveBeenCalled();
    });

    it('restores when the parent module is live', async () => {
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-archived',
        moduleId: 'mod-parent',
        isArchived: true,
        title: 'Ch',
        module: {
          id: 'mod-parent',
          isArchived: false,
          title: 'Live Parent',
          courseId: 'course-1',
        },
      });

      const result = await service.restoreChapter('ch-archived', 'admin-1');

      expect(result.statusCode).toBe(200);
      expect(prisma.chapter.update).toHaveBeenCalledWith({
        where: { id: 'ch-archived' },
        data: { isArchived: false, archivedAt: null },
      });
    });
  });

  // ─── restoreSection ────────────────────────────────────────────────────

  describe('restoreSection', () => {
    it('returns 409 when the parent chapter is archived', async () => {
      prisma.section.findUnique.mockResolvedValue({
        id: 'sec-archived',
        chapterId: 'ch-parent',
        isArchived: true,
        title: 'S',
        chapter: {
          id: 'ch-parent',
          isArchived: true,
          title: 'Archived Ch',
          module: {
            id: 'mod-grandparent',
            isArchived: false,
            title: 'Live Mod',
            courseId: 'course-1',
          },
        },
      });

      try {
        await service.restoreSection('sec-archived', 'admin-1');
        throw new Error('should have thrown');
      } catch (e) {
        const err = (e as HttpException).getResponse() as any;
        expect(err.details.parentEntityType).toBe('chapter');
        expect(err.details.chain).toHaveLength(1);
      }
    });

    it('returns 409 when the grandparent module is archived — reports module first in chain', async () => {
      // The verified-2026-08-08 answer to the plan's research TODO: archiving
      // does NOT cascade downward. So a section can legitimately sit under
      // an archived module even when its immediate chapter parent is live,
      // and the restore endpoint must catch that.
      prisma.section.findUnique.mockResolvedValue({
        id: 'sec-archived',
        chapterId: 'ch-parent',
        isArchived: true,
        title: 'S',
        chapter: {
          id: 'ch-parent',
          isArchived: false, // chapter live…
          title: 'Live Ch',
          module: {
            id: 'mod-grandparent',
            isArchived: true, // …but grandparent archived
            title: 'Archived Mod',
            courseId: 'course-1',
          },
        },
      });

      try {
        await service.restoreSection('sec-archived', 'admin-1');
        throw new Error('should have thrown');
      } catch (e) {
        const err = (e as HttpException).getResponse() as any;
        // The highest archived ancestor is what the admin has to fix first,
        // so it must appear first in the chain and drive the top-level error
        // message.
        expect(err.details.parentEntityType).toBe('module');
        expect(err.details.parentId).toBe('mod-grandparent');
        expect(err.details.chain[0].entityType).toBe('module');
      }
    });

    it('restores when the whole parent chain is live', async () => {
      prisma.section.findUnique.mockResolvedValue({
        id: 'sec-archived',
        chapterId: 'ch-parent',
        isArchived: true,
        title: 'S',
        chapter: {
          id: 'ch-parent',
          isArchived: false,
          title: 'Live Ch',
          module: {
            id: 'mod-grandparent',
            isArchived: false,
            title: 'Live Mod',
            courseId: 'course-1',
          },
        },
      });

      const result = await service.restoreSection('sec-archived', 'admin-1');
      expect(result.statusCode).toBe(200);
      expect(prisma.section.update).toHaveBeenCalledWith({
        where: { id: 'sec-archived' },
        data: { isArchived: false, archivedAt: null },
      });
    });
  });

  // ─── getArchivedInventory ──────────────────────────────────────────────

  describe('getArchivedInventory', () => {
    // A small fixture that puts one row of each entity type in play so the
    // "returns all four types" and "filters by entityType" cases share a
    // single dataset.
    const now = new Date('2026-08-08T10:00:00Z');
    const older = new Date('2026-08-01T10:00:00Z');
    const oldest = new Date('2026-07-01T10:00:00Z');

    const setupFullDataset = () => {
      prisma.module.findMany.mockResolvedValue([
        {
          id: 'mod-a',
          title: 'Module A',
          archivedAt: oldest,
          updatedAt: oldest,
        },
      ]);
      prisma.chapter.findMany.mockResolvedValue([
        {
          id: 'ch-a',
          title: 'Chapter A',
          archivedAt: older,
          updatedAt: older,
          module: { id: 'mod-p', title: 'Parent Module', isArchived: false },
        },
      ]);
      prisma.section.findMany.mockResolvedValue([
        {
          id: 'sec-a',
          title: 'Section A',
          archivedAt: now,
          updatedAt: now,
          chapter: {
            id: 'ch-p',
            title: 'Parent Ch',
            isArchived: true, // parent archived → parentIsArchived: true
            module: {
              id: 'mod-p2',
              title: 'Grandparent Mod',
              isArchived: false,
            },
          },
        },
      ]);
      prisma.quiz.findMany.mockResolvedValue([]);
    };

    it('returns rows of every entity type when no entityType filter is given', async () => {
      setupFullDataset();

      const result = await service.getArchivedInventory('course-1', {});

      const rows = (result.data as any).rows;
      const types = new Set(rows.map((r: any) => r.entityType));
      // Empty types (quizzes) don't appear but the three populated types do.
      expect(types).toEqual(new Set(['module', 'chapter', 'section']));
      expect((result.data as any).total).toBe(3);
    });

    it('respects entityType filter (only queries the requested table)', async () => {
      setupFullDataset();

      await service.getArchivedInventory('course-1', {
        entityType: 'section',
      });

      // The three other findMany calls must be skipped — otherwise inventory
      // pays for a full 4-table scan on every filtered request. The service
      // shortcuts with `Promise.resolve([])` for un-requested tables so those
      // findMany mocks stay untouched.
      expect(prisma.module.findMany).not.toHaveBeenCalled();
      expect(prisma.chapter.findMany).not.toHaveBeenCalled();
      expect(prisma.quiz.findMany).not.toHaveBeenCalled();
      expect(prisma.section.findMany).toHaveBeenCalledTimes(1);
    });

    it('applies search as a case-insensitive title contains filter', async () => {
      prisma.section.findMany.mockResolvedValue([]);

      await service.getArchivedInventory('course-1', {
        entityType: 'section',
        search: 'PPE',
      });

      const call = prisma.section.findMany.mock.calls[0][0];
      expect(call.where.title).toEqual({
        contains: 'PPE',
        mode: 'insensitive',
      });
    });

    it('sorts by archivedAt descending by default (newest first)', async () => {
      setupFullDataset();

      const result = await service.getArchivedInventory('course-1', {});
      const rows = (result.data as any).rows;

      // Section (now) → Chapter (older) → Module (oldest)
      expect(rows[0].entityType).toBe('section');
      expect(rows[1].entityType).toBe('chapter');
      expect(rows[2].entityType).toBe('module');
    });

    it('surfaces parentIsArchived and parentId when the parent chain has an archive', async () => {
      // Section with archived parent chapter → row should reflect that so
      // the FE toast can render "restore chapter first" without a follow-up
      // request.
      setupFullDataset();
      const result = await service.getArchivedInventory('course-1', {
        entityType: 'section',
      });
      const [sec] = (result.data as any).rows;
      expect(sec.parentIsArchived).toBe(true);
      expect(sec.parentEntityType).toBe('chapter');
      expect(sec.parentId).toBe('ch-p');
    });

    it('merges stillServedTo and versionsReferencing from the batched helper', async () => {
      prisma.section.findMany.mockResolvedValue([
        {
          id: 'sec-1',
          title: 'S1',
          archivedAt: new Date(),
          updatedAt: new Date(),
          chapter: {
            id: 'ch',
            title: 'C',
            isArchived: false,
            module: {
              id: 'm',
              title: 'M',
              isArchived: false,
            },
          },
        },
      ]);
      courseVersionService.getReferencingVersionsWithEnrollmentsBatch.mockResolvedValue(
        new Map([
          [
            'sec-1',
            {
              stillServedTo: 12,
              versions: [
                {
                  versionId: 'v-1',
                  versionNumber: 3,
                  status: 'PUBLISHED',
                  enrollmentCount: 12,
                },
              ],
            },
          ],
        ]),
      );

      const result = await service.getArchivedInventory('course-1', {
        entityType: 'section',
      });

      const [row] = (result.data as any).rows;
      expect(row.stillServedTo).toBe(12);
      expect(row.versionsReferencing[0].versionNumber).toBe(3);
    });

    it('paginates correctly — page/pageSize/total', async () => {
      const rows = Array.from({ length: 25 }, (_, i) => ({
        id: `sec-${i}`,
        title: `Section ${i}`,
        archivedAt: new Date(2026, 0, 1 + i), // increasing so sort is deterministic
        updatedAt: new Date(2026, 0, 1 + i),
        chapter: {
          id: 'ch',
          title: 'C',
          isArchived: false,
          module: { id: 'm', title: 'M', isArchived: false },
        },
      }));
      prisma.section.findMany.mockResolvedValue(rows);

      const page2 = await service.getArchivedInventory('course-1', {
        entityType: 'section',
        page: 2,
        pageSize: 10,
      });

      const data2 = page2.data as any;
      expect(data2.total).toBe(25);
      expect(data2.page).toBe(2);
      expect(data2.pageSize).toBe(10);
      expect(data2.rows).toHaveLength(10);
    });

    it('clamps pageSize to 100 (protection against unbounded queries)', async () => {
      prisma.section.findMany.mockResolvedValue([]);

      const result = await service.getArchivedInventory('course-1', {
        entityType: 'section',
        pageSize: 9999,
      });

      // Silent clamp — no error, just a bounded page size, so the FE can
      // pass user input directly without pre-validation.
      expect((result.data as any).pageSize).toBe(100);
    });
  });
});
