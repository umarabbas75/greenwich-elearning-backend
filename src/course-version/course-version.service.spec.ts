import { NotFoundException } from '@nestjs/common';
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
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userCourseProgress: {
        count: jest.fn().mockResolvedValue(1),
      },
      section: {
        findMany: jest.fn(),
      },
      quiz: {
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
        aggregate: jest.fn().mockResolvedValue({ _max: { versionNumber: 0 } }),
      },
      course: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
      // Non-blocking advisory lock inside publishNewVersion's tx — grant it.
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseVersionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CourseVersionService);
    manifestModule.resetManifestCache();
    jest.clearAllMocks();
    (manifestModule.loadPinnedCurriculum as jest.Mock).mockResolvedValue(
      mockPinnedTree,
    );
  });

  describe('resolveCurriculumTree', () => {
    it('returns live mode when enrollment has no pin', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        enrolledVersionId: null,
      });

      await expect(
        service.resolveCurriculumTree('user-1', 'course-1'),
      ).resolves.toEqual({ mode: 'live' });
    });

    it('returns versioned tree when pin exists', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-1',
        enrolledVersionId: 'version-1',
      });
      prisma.courseVersion.findUnique.mockResolvedValue({
        manifest: mockManifest,
      });

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

  describe('resolveEnrolledVersionId', () => {
    it('returns null when the enrollment is unpinned', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-1',
        enrolledVersionId: null,
      });

      await expect(
        service.resolveEnrolledVersionId('user-1', 'course-1'),
      ).resolves.toBeNull();
    });

    it('returns the pinned version WITHOUT writing (pure read, no re-pin)', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-1',
        enrolledVersionId: 'version-1',
      });
      // Existence check now resolves the (cached) manifest, not just the id.
      prisma.courseVersion.findUnique.mockResolvedValue({
        manifest: mockManifest,
      });

      await expect(
        service.resolveEnrolledVersionId('user-1', 'course-1'),
      ).resolves.toBe('version-1');

      // Regression: resolution must never mutate the enrollment (the old code
      // "bumped zero-progress" learners to latest on read, shifting curriculum).
      expect(prisma.userCourse.update).not.toHaveBeenCalled();
      expect(prisma.userCourse.updateMany).not.toHaveBeenCalled();
      // And it must not re-pin: the current latest is irrelevant to a pinned read.
      expect(prisma.courseVersion.findFirst).not.toHaveBeenCalled();
    });

    it('degrades to live (null) when the pinned version no longer exists', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-1',
        enrolledVersionId: 'gone',
      });
      prisma.courseVersion.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveEnrolledVersionId('user-1', 'course-1'),
      ).resolves.toBeNull();
      expect(prisma.userCourse.update).not.toHaveBeenCalled();
    });
  });

  describe('pinEnrollmentToLatest', () => {
    it('pins an unpinned enrollment via a conditional (idempotent) write', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-1',
        courseId: 'course-1',
        enrolledVersionId: null,
      });
      prisma.courseVersion.findFirst.mockResolvedValue({ id: 'version-1' });

      await service.pinEnrollmentToLatest('uc-1');

      // Conditional update guarded by enrolledVersionId: null — never overwrites.
      expect(prisma.userCourse.updateMany).toHaveBeenCalledWith({
        where: { id: 'uc-1', enrolledVersionId: null },
        data: { enrolledVersionId: 'version-1' },
      });
    });

    it('is a no-op when the enrollment is already pinned', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-1',
        courseId: 'course-1',
        enrolledVersionId: 'version-1',
      });

      await service.pinEnrollmentToLatest('uc-1');

      expect(prisma.userCourse.updateMany).not.toHaveBeenCalled();
      expect(prisma.courseVersion.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('getVersionQuizzesForChapter', () => {
    it('returns null when learner is unpinned', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        enrolledVersionId: null,
      });

      await expect(
        service.getVersionQuizzesForChapter('user-1', 'course-1', 'ch-1'),
      ).resolves.toBeNull();
    });

    it('returns mapped quizzes for pinned chapter only (chapter-scoped load)', async () => {
      // Chapter-scoped loader: reads the manifest, then loads ONLY ch-1's quizzes.
      prisma.courseVersion.findUnique.mockResolvedValue({
        manifest: mockManifest,
      });
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-1', question: 'Q', options: ['A'], answer: 'A' },
      ]);

      const result = await service.getVersionQuizzesForChapter(
        'user-1',
        'course-1',
        'ch-1',
        false,
        'version-1',
      );

      expect(result).toEqual([{ id: 'quiz-1', question: 'Q', options: ['A'] }]);
      // Only the target chapter's quiz ids are queried — no whole-tree hydration.
      expect(prisma.quiz.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['quiz-1'] } },
        select: { id: true, question: true, options: true, answer: true },
      });
    });

    it('caches the immutable manifest: a second read skips the version fetch', async () => {
      prisma.courseVersion.findUnique.mockResolvedValue({
        manifest: mockManifest,
      });
      prisma.quiz.findMany.mockResolvedValue([
        { id: 'quiz-1', question: 'Q', options: ['A'], answer: 'A' },
      ]);

      await service.getVersionQuizzesForChapter(
        'u',
        'c',
        'ch-1',
        false,
        'version-1',
      );
      await service.getVersionQuizzesForChapter(
        'u',
        'c',
        'ch-1',
        false,
        'version-1',
      );

      // Manifest fetched once, served from cache the second time.
      expect(prisma.courseVersion.findUnique).toHaveBeenCalledTimes(1);
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
      (manifestModule.buildManifestFromLiveTree as jest.Mock).mockResolvedValue(
        {
          manifest: mockManifest,
          sectionCount: 2,
          moduleCount: 1,
          chapterCount: 1,
          quizCount: 1,
        },
      );

      const result = await service.publishNewVersion('admin-1', 'course-1');
      expect((result.data as { skipped?: boolean }).skipped).toBe(true);
      expect(manifestModule.publishManifestVersion).not.toHaveBeenCalled();
    });

    it('creates next manifest version and demotes previous latest', async () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'course-1',
        title: 'Test Course',
      });
      // Dedup + versioning now run inside one tx, so findFirst is called once.
      prisma.courseVersion.findFirst.mockResolvedValue({
        id: 'v-old',
        versionNumber: 1,
        manifest: mockManifest,
        sectionCount: 2,
      });
      // nextNumber now derives from MAX(versionNumber), not currentLatest.
      prisma.courseVersion.aggregate.mockResolvedValue({
        _max: { versionNumber: 1 },
      });
      (manifestModule.buildManifestFromLiveTree as jest.Mock).mockResolvedValue(
        {
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
        },
      );
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
      // Per-course advisory lock is attempted inside the publish transaction.
      expect(prisma.$queryRaw).toHaveBeenCalled();
      // The active-unpinned enrollments get pinned to the new version.
      expect(prisma.userCourse.updateMany).toHaveBeenCalledWith({
        where: {
          courseId: 'course-1',
          isActive: true,
          enrolledVersionId: null,
        },
        data: { enrolledVersionId: 'v-new' },
      });
    });

    it('throws ConflictException when the advisory lock is not granted', async () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'course-1',
        title: 'Test Course',
      });
      prisma.$queryRaw.mockResolvedValueOnce([{ locked: false }]);

      await expect(
        service.publishNewVersion('admin-1', 'course-1'),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('countCompletionDenominator', () => {
    it('uses live sections when unpinned', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        enrolledVersionId: null,
      });
      prisma.section.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);

      await expect(
        service.countCompletionDenominator('user-1', 'course-1'),
      ).resolves.toEqual({
        total: 2,
        liveSectionIds: ['s1', 's2'],
      });
    });

    it('uses the manifest section ids when pinned', async () => {
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

    it('falls back to LIVE count when the manifest is corrupt (not total: 0)', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        enrolledVersionId: 'version-1',
      });
      prisma.courseVersion.findUnique.mockResolvedValue({
        sectionCount: 2,
        manifest: { bad: true },
      });
      // loadManifestForVersion's legacy fallback runs $queryRaw; return [] so it
      // resolves to null (in prod the legacy tables are dropped and it throws →
      // also null). Overrides the default advisory-lock stub for this test.
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.section.findMany.mockResolvedValue([
        { id: 's1' },
        { id: 's2' },
        { id: 's3' },
      ]);

      // F4: a corrupt/missing pinned manifest degrades to the live section count,
      // NOT { total: 0 } (which corrupted the completion denominator).
      await expect(
        service.countCompletionDenominator('user-1', 'course-1'),
      ).resolves.toEqual({
        total: 3,
        liveSectionIds: ['s1', 's2', 's3'],
      });
    });

    it('falls back to LIVE count when the pinned version row is gone', async () => {
      prisma.userCourse.findUnique.mockResolvedValue({
        enrolledVersionId: 'gone',
      });
      prisma.courseVersion.findUnique.mockResolvedValue(null);
      prisma.section.findMany.mockResolvedValue([{ id: 's1' }]);

      await expect(
        service.countCompletionDenominator('user-1', 'course-1'),
      ).resolves.toEqual({ total: 1, liveSectionIds: ['s1'] });
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

  describe('getReferencingVersionsWithEnrollments', () => {
    // The whole point of this method is to answer "still shown to how many
    // active users?". These tests pin the two behaviours the delete-response
    // UX depends on: (a) count only referencing versions, and (b) sum only
    // active enrollments — inactive ones are not being served and would
    // recreate the "how many is that really?" confusion that motivated the
    // field. The prisma mock's `enrollments: { where: { isActive: true } }`
    // shape is asserted in the query args.
    it('sums enrollmentCount across referencing versions only', async () => {
      prisma.courseVersion.findMany.mockResolvedValue([
        {
          id: 'v1',
          versionNumber: 1,
          status: 'PUBLISHED',
          manifest: mockManifest,
          _count: { enrollments: 3 },
        },
        {
          id: 'v2',
          versionNumber: 2,
          status: 'ARCHIVED',
          // Different manifest — does not reference sec-1
          manifest: {
            modules: [
              {
                sourceId: 'mod-x',
                order: 0,
                chapters: [
                  {
                    sourceId: 'ch-x',
                    order: 0,
                    sectionIds: ['sec-x'],
                    quizIds: [],
                  },
                ],
              },
            ],
          },
          _count: { enrollments: 99 },
        },
        {
          id: 'v3',
          versionNumber: 3,
          status: 'PUBLISHED',
          manifest: mockManifest,
          _count: { enrollments: 7 },
        },
      ]);

      const result = await service.getReferencingVersionsWithEnrollments(
        'section',
        'sec-1',
        'course-1',
      );

      // v2 does not reference sec-1 → excluded; its 99 enrollments must NOT
      // inflate stillServedTo.
      expect(result.stillServedTo).toBe(10);
      expect(result.versions).toHaveLength(2);
      // Sorted by versionNumber DESC — matches the FE toast order (newest
      // versions first) and stops the test from depending on manifest scan
      // order.
      expect(result.versions.map((v) => v.versionNumber)).toEqual([3, 1]);
    });

    it('scopes the count query to isActive:true enrollments', async () => {
      prisma.courseVersion.findMany.mockResolvedValue([]);
      await service.getReferencingVersionsWithEnrollments(
        'quiz',
        'quiz-1',
        'course-1',
      );

      // This is the fix Claude's review caught: without the isActive filter,
      // the delete-response would announce "still shown to 47 active users"
      // when only 3 are actually being served, defeating the whole point of
      // the field.
      const call = prisma.courseVersion.findMany.mock.calls[0][0];
      expect(call.select._count.select.enrollments).toEqual({
        where: { isActive: true },
      });
    });

    it('returns empty inventory when the id is not referenced anywhere', async () => {
      prisma.courseVersion.findMany.mockResolvedValue([
        {
          id: 'v1',
          versionNumber: 1,
          status: 'PUBLISHED',
          manifest: mockManifest,
          _count: { enrollments: 3 },
        },
      ]);

      const result = await service.getReferencingVersionsWithEnrollments(
        'quiz',
        'quiz-does-not-exist',
        'course-1',
      );

      expect(result.stillServedTo).toBe(0);
      expect(result.versions).toEqual([]);
    });
  });

  describe('buildArchiveMessage', () => {
    // These strings appear verbatim in the admin toast. The whole reason the
    // helper lives on CourseVersionService is so CourseService and QuizService
    // produce identical wording — a snapshot here catches accidental drift.
    it('renders the zero-stillServed variant', () => {
      const msg = service.buildArchiveMessage('Section', 0, []);
      expect(msg).toContain('Archived');
      expect(msg).toContain('hidden from new users');
      // Must NOT reference migration when nobody is on a referencing version.
      expect(msg).not.toContain('migrate-version');
    });

    it('renders the stillServed variant with version list and migrate hint', () => {
      const msg = service.buildArchiveMessage('Quiz', 12, [
        { versionNumber: 3 } as any,
        { versionNumber: 2 } as any,
      ]);
      expect(msg).toContain('12 active users');
      expect(msg).toContain('v3');
      expect(msg).toContain('v2');
      expect(msg).toContain('migrate-version');
    });

    it('pluralises singular vs plural users', () => {
      expect(
        service.buildArchiveMessage('Chapter', 1, [
          { versionNumber: 2 } as any,
        ]),
      ).toContain('1 active user pinned');
      expect(
        service.buildArchiveMessage('Chapter', 2, [
          { versionNumber: 2 } as any,
        ]),
      ).toContain('2 active users pinned');
    });
  });

  describe('writeAudit', () => {
    // The audit table exists specifically because the two most sensitive
    // admin ops used to `void adminId`. These tests pin (a) the actor email
    // gets denormalised so the row remains attributable after a user hard
    // delete nulls adminId, and (b) audit failures never propagate.
    it('denormalises adminEmail from the actor', async () => {
      prisma.user = {
        findUnique: jest.fn().mockResolvedValue({ email: 'admin@example.com' }),
      };
      prisma.adminAuditLog = { create: jest.fn().mockResolvedValue({}) };

      await service.writeAudit({
        adminId: 'admin-1',
        action: 'ARCHIVE_VERSION',
        targetType: 'CourseVersion',
        targetId: 'v-1',
        courseId: 'c-1',
      });

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminId: 'admin-1',
            adminEmail: 'admin@example.com',
            action: 'ARCHIVE_VERSION',
            targetType: 'CourseVersion',
            targetId: 'v-1',
            courseId: 'c-1',
          }),
        }),
      );
    });

    it('never throws — audit write failures are best-effort', async () => {
      prisma.user = {
        findUnique: jest.fn().mockRejectedValue(new Error('db down')),
      };
      prisma.adminAuditLog = {
        create: jest.fn().mockRejectedValue(new Error('db down')),
      };

      await expect(
        service.writeAudit({
          adminId: 'admin-1',
          action: 'MIGRATE_LEARNER_VERSION',
          targetType: 'UserCourse',
        }),
      ).resolves.toBeUndefined();
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
