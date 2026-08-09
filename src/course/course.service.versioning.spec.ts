import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CourseVersionService } from '../course-version/course-version.service';
import { makeAbortAwareTransactionMock } from '../test-utils/prisma-transaction-mock';
import { CourseCompletionService } from '../course-completion/course-completion.service';
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
    tree: {
      versionId: 'version-1',
      versionNumber: 1,
      manifest: { modules: [] },
      modules: [
        {
          sourceModuleId: 'mod-1',
          title: 'M',
          description: '',
          orderIndex: 0,
          chapters: [
            {
              sourceChapterId: 'ch-1',
              title: 'C',
              description: 'D',
              pdfFile: 'f.pdf',
              orderIndex: 0,
              sections: [
                {
                  id: 'sec-1',
                  title: 'S1',
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
                  description: 'D',
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
        delete: jest.fn().mockResolvedValue({}),
      },
      section: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
        update: jest.fn(),
      },
      module: { findUnique: jest.fn(), delete: jest.fn(), update: jest.fn() },
      userCourseDelete: null,
      userCourseProgress: {
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      courseCompletion: {
        findUnique: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      lastSeenSection: {
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      quizProgress: {
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      quizAnswer: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userChapterCompletion: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userModuleCompletion: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      sectionTimeSpent: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userFormCompletion: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userPolicyCompletion: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userPolicyItemCompletion: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      courseFeedbackSubmission: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      assessmentAttempt: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      assessment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      chapter: {
        findUnique: jest.fn(),
        delete: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: undefined as any,
    };

    courseVersionService = {
      resolveCurriculumTree: jest.fn(),
      summarizeNewSincePinnedVersion: jest.fn().mockResolvedValue(null),
      pinEnrollmentToLatest: jest.fn(),
      isReferencedByAnyVersion: jest.fn(),
      // New: delete responses now include stillServedTo + versionsReferencing.
      // Default mock returns "not referenced"; individual tests override.
      getReferencingVersionsWithEnrollments: jest
        .fn()
        .mockResolvedValue({ stillServedTo: 0, versions: [] }),
      buildArchiveMessage: jest.fn().mockReturnValue('Archived'),
      writeAudit: jest.fn().mockResolvedValue(undefined),
      findVersionChapterBySourceId: jest.fn(),
      mapVersionSectionsForLearner: jest.fn(),
      mapVersionQuizzesForLearner: jest.fn(),
      buildUserModulesFromVersion: jest.fn(),
      countCompletionDenominator: jest.fn(),
      autoPublishAfterStructuralChange: jest.fn().mockResolvedValue({
        versionNumber: 2,
        versionId: 'version-2',
      }),
    };

    prisma.$transaction = makeAbortAwareTransactionMock(prisma);

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

      // Pins inside the transaction, so it receives the tx client rather than
      // the outer prisma. Asserted structurally: the abort-aware $transaction
      // mock hands the callback a wrapped client (that wrapper is what lets a
      // failed statement poison the tx), so identity-comparing it to `prisma`
      // would test the mock rather than the behaviour.
      expect(courseVersionService.pinEnrollmentToLatest).toHaveBeenCalledWith(
        'uc-1',
        expect.objectContaining({ userCourse: expect.any(Object) }),
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
        isArchived: false,
      });
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        moduleId: 'mod-1',
        module: { courseId: 'course-1' },
      });
      courseVersionService.isReferencedByAnyVersion.mockResolvedValue(true);
      courseVersionService.getReferencingVersionsWithEnrollments.mockResolvedValue(
        {
          stillServedTo: 3,
          versions: [
            {
              versionId: 'v-1',
              versionNumber: 1,
              status: 'PUBLISHED',
              enrollmentCount: 3,
            },
          ],
        },
      );
      prisma.section.update.mockResolvedValue({
        id: 'sec-1',
        isArchived: true,
      });

      const result = await service.deleteSection('sec-1', 'admin-1');

      expect(prisma.section.update).toHaveBeenCalledWith({
        where: { id: 'sec-1' },
        data: { isArchived: true, archivedAt: expect.any(Date) },
      });
      expect(prisma.section.delete).not.toHaveBeenCalled();
      expect(result.message).toContain('Archived');
      expect((result as any).outcome).toBe('archived');
      expect((result as any).stillServedTo).toBe(3);
      // Archive is high-consequence — the section vanishes from the admin
      // list but keeps being served to pinned learners. Prior to this audit
      // write, only the auto-publish landed in any log; the admin's own
      // click was untraceable. Pin the ARCHIVE_SECTION row and its
      // stillServedTo payload so a regression here is loud.
      expect(courseVersionService.writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 'admin-1',
          action: 'ARCHIVE_SECTION',
          targetType: 'Section',
          targetId: 'sec-1',
          courseId: 'course-1',
          metadata: expect.objectContaining({ stillServedTo: 3 }),
        }),
      );
    });

    it('hard-deletes when already archived and not in any manifest', async () => {
      prisma.section.findUnique.mockResolvedValue({
        id: 'sec-1',
        title: 'S',
        chapterId: 'ch-1',
        isArchived: true,
      });
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        moduleId: 'mod-1',
        module: { courseId: 'course-1' },
      });
      courseVersionService.isReferencedByAnyVersion.mockResolvedValue(false);
      prisma.section.delete.mockResolvedValue({ id: 'sec-1' });

      const result = await service.deleteSection('sec-1');

      expect(prisma.section.delete).toHaveBeenCalledWith({
        where: { id: 'sec-1' },
      });
      expect(prisma.section.update).not.toHaveBeenCalled();
      expect(result.message).toContain('permanently removed');
    });

    it('hard-deletes when never published', async () => {
      prisma.section.findUnique.mockResolvedValue({
        id: 'sec-1',
        chapterId: 'ch-1',
        isArchived: false,
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
      courseVersionService.getReferencingVersionsWithEnrollments.mockResolvedValue(
        {
          stillServedTo: 1,
          versions: [
            {
              versionId: 'v-1',
              versionNumber: 2,
              status: 'PUBLISHED',
              enrollmentCount: 1,
            },
          ],
        },
      );
      prisma.chapter.update.mockResolvedValue({ id: 'ch-1', isArchived: true });

      const result = await service.deleteChapter('ch-1');

      expect(prisma.chapter.update).toHaveBeenCalled();
      expect(result.message).toContain('Archived');
      expect((result as any).outcome).toBe('archived');
      expect((result as any).stillServedTo).toBe(1);
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
      courseVersionService.getReferencingVersionsWithEnrollments.mockResolvedValue(
        {
          stillServedTo: 5,
          versions: [
            {
              versionId: 'v-3',
              versionNumber: 3,
              status: 'PUBLISHED',
              enrollmentCount: 5,
            },
          ],
        },
      );
      prisma.module.update.mockResolvedValue({ id: 'mod-1', isArchived: true });

      const result = await service.deleteModule('mod-1');

      expect(prisma.module.update).toHaveBeenCalled();
      expect(result.message).toContain('Archived');
      expect((result as any).outcome).toBe('archived');
      expect((result as any).stillServedTo).toBe(5);
    });
  });

  describe('getUserChapterProgress', () => {
    it('uses version section count when enrollment is pinned', async () => {
      courseVersionService.resolveCurriculumTree.mockResolvedValue(versionTree);
      courseVersionService.findVersionChapterBySourceId.mockReturnValue({
        module: versionTree.tree.modules[0],
        chapter: versionTree.tree.modules[0].chapters[0],
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
        module: versionTree.tree.modules[0],
        chapter: versionTree.tree.modules[0].chapters[0],
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

    it('excludes inactive sections from the live denominator', async () => {
      // A5: this query filtered isArchived only, so an inactive section
      // inflated the denominator here while every other live path
      // (countCompletionDenominator, getAllUserModules, the percentage
      // engine) excluded it — the same chapter read differently depending
      // on which endpoint you asked.
      courseVersionService.resolveCurriculumTree.mockResolvedValue({
        mode: 'live',
      });
      prisma.userCourseProgress.findMany.mockResolvedValue([
        { sectionId: 'sec-1' },
      ]);
      prisma.courseCompletion.findUnique.mockResolvedValue(null);
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        sections: [{ id: 'sec-1' }, { id: 'sec-2' }],
        module: { courseId: 'course-1' },
      });

      await service.getUserChapterProgress('user-1', 'course-1', 'ch-1');

      const call = prisma.chapter.findUnique.mock.calls[0][0];
      expect(call.include.sections.where).toEqual({
        isArchived: false,
        isActive: true,
      });
    });

    it('ignores progress on sections no longer in the live chapter', async () => {
      // A5: the numerator was a raw count of the learner's progress rows,
      // clamped to the section total. Clamping reported a learner with stale
      // rows as exactly 100%; intersecting reports their true position.
      courseVersionService.resolveCurriculumTree.mockResolvedValue({
        mode: 'live',
      });
      prisma.userCourseProgress.findMany.mockResolvedValue([
        { sectionId: 'sec-1' },
        { sectionId: 'gone-1' },
        { sectionId: 'gone-2' },
      ]);
      prisma.courseCompletion.findUnique.mockResolvedValue(null);
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        sections: [{ id: 'sec-1' }, { id: 'sec-2' }],
        module: { courseId: 'course-1' },
      });

      const result = await service.getUserChapterProgress(
        'user-1',
        'course-1',
        'ch-1',
      );
      const data = result.data as any;

      // 1 of 2 live sections done — NOT 100% via a clamped count of 3.
      expect(data.completedSections).toBe(1);
      expect(data.userCourseProgress).toBe(50);
    });
  });

  describe('getAllUserSections', () => {
    it('excludes inactive sections from the live section list', async () => {
      // A5: this query filtered isArchived only. The lesson-player sidebar
      // derives its "N/N" from this array's length, so an inactive section
      // made that denominator disagree with the chapter percentage and the
      // completion gate.
      courseVersionService.resolveCurriculumTree.mockResolvedValue({
        mode: 'live',
      });
      prisma.userCourseProgress.findMany.mockResolvedValue([]);
      prisma.courseCompletion.findUnique.mockResolvedValue(null);
      prisma.lastSeenSection.findUnique.mockResolvedValue(null);
      // Only the live/active section comes back — the inactive one is
      // excluded by the query filter this test pins.
      prisma.section.findMany.mockResolvedValue([
        { id: 'sec-1', title: 'S1', chapterId: 'ch-1' },
      ]);
      prisma.chapter.findUnique.mockResolvedValue({
        id: 'ch-1',
        quizzes: [],
        module: { courseId: 'course-1' },
      });

      await service.getAllUserSections('ch-1', 'user-1', 'course-1');

      const call = prisma.section.findMany.mock.calls[0][0];
      expect(call.where).toEqual(
        expect.objectContaining({ isArchived: false, isActive: true }),
      );
    });

    it('returns versioned sections for pinned enrollment', async () => {
      courseVersionService.resolveCurriculumTree.mockResolvedValue(versionTree);
      courseVersionService.findVersionChapterBySourceId.mockReturnValue({
        module: versionTree.tree.modules[0],
        chapter: versionTree.tree.modules[0].chapters[0],
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
      expect(
        courseVersionService.mapVersionSectionsForLearner,
      ).toHaveBeenCalled();
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

  describe('unAssignCourse — loophole guard', () => {
    // These tests pin the actual bug that motivated the whole fix:
    // (userId, courseId)-keyed progress/completion rows have no FK to
    // UserCourse, so a bare delete leaves them orphaned to re-attach on
    // re-enrollment. The guard's job is to (a) refuse when residual state
    // exists and force is not set, and (b) wipe EVERY table when force is
    // set — including the ones Claude's review caught missing on the first
    // pass (quiz answers, assessment attempts, form/policy completions).
    const setupUnassignPreconditions = () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.course.findUnique.mockResolvedValue({ id: 'course-1' });
      prisma.userCourse.findFirst.mockResolvedValue({
        id: 'uc-1',
        userId: 'user-1',
        courseId: 'course-1',
        enrolledVersionId: 'v-1',
      });
    };

    it('unassigns cleanly when the learner has zero residual state', async () => {
      setupUnassignPreconditions();
      // All count mocks default to 0 in beforeEach → hasAny should be false.

      const result = await service.unAssignCourse('user-1', 'course-1');

      expect(result.statusCode).toBe(200);
      expect(result.message).toContain('Successfully unassigned');
      expect(prisma.userCourse.delete).toHaveBeenCalledWith({
        where: { id: 'uc-1' },
      });
      // Clean unassign: no audit row is written when there was nothing to
      // wipe (adminId not supplied here anyway).
      expect(courseVersionService.writeAudit).not.toHaveBeenCalled();
    });

    it('refuses with 409 and structured details when learner has section progress', async () => {
      setupUnassignPreconditions();
      prisma.userCourseProgress.count.mockResolvedValue(42);

      await expect(
        service.unAssignCourse('user-1', 'course-1'),
      ).rejects.toMatchObject({
        response: {
          status: 409,
          details: expect.objectContaining({ progressRows: 42 }),
        },
      });
      expect(prisma.userCourse.delete).not.toHaveBeenCalled();
    });

    // The exact regression Claude's review caught: pre-fix, only 6 tables
    // were checked, so a learner who did chapter quizzes but had zero
    // UserCourseProgress passed as "clean" and the guard was bypassed.
    it('refuses when learner has quiz answers but no section progress', async () => {
      setupUnassignPreconditions();
      prisma.chapter.findMany.mockResolvedValue([{ id: 'ch-1' }]);
      prisma.quizAnswer.count.mockResolvedValue(5);

      await expect(
        service.unAssignCourse('user-1', 'course-1'),
      ).rejects.toMatchObject({
        response: {
          status: 409,
          details: expect.objectContaining({ quizAnswerRows: 5 }),
        },
      });
    });

    it('refuses when learner has an assessment attempt but no section progress', async () => {
      setupUnassignPreconditions();
      prisma.assessment.findMany.mockResolvedValue([{ id: 'a-1' }]);
      // No count mock for assessmentAttempt yet; wire one so the probe sees it.
      prisma.assessmentAttempt.count = jest.fn().mockResolvedValue(1);

      await expect(
        service.unAssignCourse('user-1', 'course-1'),
      ).rejects.toMatchObject({
        response: {
          status: 409,
          details: expect.objectContaining({ assessmentAttemptRows: 1 }),
        },
      });
    });

    it('refuses when learner has a policy completion but no section progress', async () => {
      setupUnassignPreconditions();
      prisma.userPolicyCompletion.count.mockResolvedValue(1);

      await expect(
        service.unAssignCourse('user-1', 'course-1'),
      ).rejects.toMatchObject({
        response: {
          status: 409,
          details: expect.objectContaining({ policyCompletionRows: 1 }),
        },
      });
    });

    it('force: true wipes ALL learner state tables and audits the destructive path', async () => {
      setupUnassignPreconditions();
      prisma.userCourseProgress.count.mockResolvedValue(42);
      prisma.chapter.findMany.mockResolvedValue([{ id: 'ch-1' }]);
      prisma.assessment.findMany.mockResolvedValue([{ id: 'a-1' }]);
      prisma.quizAnswer.count = jest.fn().mockResolvedValue(3);
      prisma.assessmentAttempt.count = jest.fn().mockResolvedValue(1);
      prisma.courseCompletion.findUnique.mockResolvedValue({
        id: 'cc-1',
        isPassed: true,
        courseCompletedAt: new Date(),
      });

      const result = await service.unAssignCourse('user-1', 'course-1', {
        force: true,
        adminId: 'admin-1',
      });

      // Every table in the wipe enumeration must have been called — not just
      // the six that were on the first pass.
      expect(prisma.userCourseProgress.deleteMany).toHaveBeenCalled();
      expect(prisma.userChapterCompletion.deleteMany).toHaveBeenCalled();
      expect(prisma.userModuleCompletion.deleteMany).toHaveBeenCalled();
      expect(prisma.courseCompletion.deleteMany).toHaveBeenCalled();
      expect(prisma.lastSeenSection.deleteMany).toHaveBeenCalled();
      expect(prisma.quizProgress.deleteMany).toHaveBeenCalled();
      expect(prisma.quizAnswer.deleteMany).toHaveBeenCalled();
      expect(prisma.userFormCompletion.deleteMany).toHaveBeenCalled();
      expect(prisma.userPolicyCompletion.deleteMany).toHaveBeenCalled();
      expect(prisma.userPolicyItemCompletion.deleteMany).toHaveBeenCalled();
      expect(prisma.courseFeedbackSubmission.deleteMany).toHaveBeenCalled();
      expect(prisma.assessmentAttempt.deleteMany).toHaveBeenCalled();
      // sectionTimeSpent is hard-deleted (not just counter-reset) on the
      // unassign path — the enrollment is going away.
      expect(prisma.sectionTimeSpent.deleteMany).toHaveBeenCalled();
      expect(prisma.userCourse.delete).toHaveBeenCalled();

      expect(courseVersionService.writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 'admin-1',
          action: 'UNASSIGN_COURSE_FORCE',
          targetType: 'UserCourse',
          courseId: 'course-1',
          userId: 'user-1',
        }),
      );
      expect(result.statusCode).toBe(200);
      expect(result.message).toContain('force');
    });

    it('propagates the 409 as an HttpException — not silently swallowed to 403', async () => {
      // Regression: the catch block adds `if (error instanceof HttpException) throw error;`
      // for exactly this reason. Without it the CONFLICT is repackaged as
      // FORBIDDEN and the FE loses the structured details payload.
      setupUnassignPreconditions();
      prisma.userCourseProgress.count.mockResolvedValue(1);

      await expect(
        service.unAssignCourse('user-1', 'course-1'),
      ).rejects.toMatchObject({ status: 409 });
    });
  });
});
