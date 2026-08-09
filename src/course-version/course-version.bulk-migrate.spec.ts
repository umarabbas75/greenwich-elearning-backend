import { HttpException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CourseVersionService } from './course-version.service';
import { makeAbortAwareTransactionMock } from '../test-utils/prisma-transaction-mock';

/**
 * PR 5 tests — bulk migration.
 *
 * Split into its own file because the per-learner tx loop + regression
 * check + skip taxonomy are complex enough to warrant focused mocks,
 * and course-version.service.spec.ts is already at ~1200 lines.
 *
 * Tests here rely on the transaction mock resolving to the outer prisma
 * (matching the pattern in other CourseVersionService specs): the tx
 * callback receives `prisma` itself, so writeAudit runs on the same
 * mock. The distinction between "tx-write" and "outer-write" is
 * verified by the dedicated writeAudit(tx) tests in
 * course-version.service.spec.ts — not repeated here.
 */
describe('CourseVersionService.migrateLearnersToVersionBulk (PR 5)', () => {
  let service: CourseVersionService;
  let prisma: Record<string, any>;

  const targetVersion = {
    id: 'ver-target',
    versionNumber: 5,
    sectionCount: 20,
  };

  const makeEnrollment = (over: Partial<any> = {}) => ({
    id: 'uc-1',
    userId: 'user-1',
    enrolledVersionId: 'ver-old',
    user: {
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      deletedAt: null,
    },
    enrolledVersion: { versionNumber: 3, sectionCount: 12 },
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      courseVersion: {
        findFirst: jest.fn().mockResolvedValue(targetVersion),
      },
      userCourse: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      userCourseProgress: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
      courseCompletion: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ email: 'admin@example.com' }),
      },
      adminAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      // Reproduces real Postgres abort semantics rather than a pass-through:
      // a failed statement poisons the tx and commit rolls back. A
      // pass-through mock cannot catch the class of bug where a swallowed
      // error inside a tx silently discards the surrounding writes.
      $transaction: undefined as any,
    };

    prisma.$transaction = makeAbortAwareTransactionMock(prisma);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseVersionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CourseVersionService);
    jest.clearAllMocks();
    // Reset the default resolutions after clearAllMocks wipes them.
    prisma.courseVersion.findFirst.mockResolvedValue(targetVersion);
    prisma.userCourseProgress.groupBy.mockResolvedValue([]);
    prisma.courseCompletion.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({ email: 'admin@example.com' });
    prisma.adminAuditLog.create.mockResolvedValue({ id: 'audit-1' });
    prisma.userCourse.update.mockResolvedValue({});
    prisma.$transaction = makeAbortAwareTransactionMock(prisma);
  });

  // ─── Guardrails ─────────────────────────────────────────────────────

  it('throws 400 with structured details when userIds exceeds ceiling of 500', async () => {
    const userIds = Array.from({ length: 501 }, (_, i) => `user-${i}`);
    try {
      await service.migrateLearnersToVersionBulk('admin-1', 'course-1', {
        userIds,
        targetVersionId: 'ver-target',
        dryRun: true,
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      const res = (e as HttpException).getResponse() as any;
      expect(res.status).toBe(400);
      // FE renders the ceiling + requested count so admin can split
      // the batch without a follow-up call.
      expect(res.details).toEqual({ ceiling: 500, requested: 501 });
    }
  });

  it('throws 404 when targetVersionId does not belong to the course', async () => {
    prisma.courseVersion.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.migrateLearnersToVersionBulk('admin-1', 'course-1', {
        userIds: ['user-1'],
        targetVersionId: 'ver-from-other-course',
        dryRun: true,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('dedupes duplicate userIds server-side', async () => {
    prisma.userCourse.findMany.mockResolvedValue([makeEnrollment()]);

    await service.migrateLearnersToVersionBulk('admin-1', 'course-1', {
      userIds: ['user-1', 'user-1', 'user-1'],
      targetVersionId: 'ver-target',
      dryRun: true,
    });

    // Only one enrollment lookup, one groupBy — dedupe happened BEFORE
    // any database work. Without this, a duplicate userId would
    // produce a duplicate audit row on real-run.
    const call = prisma.userCourse.findMany.mock.calls[0][0];
    expect(call.where.userId.in).toEqual(['user-1']);
  });

  // ─── Dry run ────────────────────────────────────────────────────────

  describe('dry run', () => {
    it('returns per-learner projection with current/projected percentages', async () => {
      prisma.userCourse.findMany.mockResolvedValue([
        makeEnrollment(), // pinned to v3 with 12 sections
      ]);
      // 6/12 = 50% current; 6/20 = 30% projected on target v5.
      prisma.userCourseProgress.groupBy.mockResolvedValue([
        { userId: 'user-1', _count: { _all: 6 } },
      ]);

      const result = await service.migrateLearnersToVersionBulk(
        'admin-1',
        'course-1',
        {
          userIds: ['user-1'],
          targetVersionId: 'ver-target',
          dryRun: true,
        },
      );

      if (!('results' in result.data))
        throw new Error('expected dryRun response');
      expect(result.data.results).toHaveLength(1);
      const row = result.data.results[0];
      expect(row.currentPercentage).toBe(50);
      expect(row.projectedPercentage).toBe(30);
      expect(row.wouldRegress).toBe(true); // 30 < 50
      expect(row.fromVersionNumber).toBe(3);
      expect(row.toSectionCount).toBe(20);
      expect(row.userLabel).toBe('Jane Doe');
    });

    it('summary counts wouldRegress and certifiedAndWouldRegress correctly', async () => {
      prisma.userCourse.findMany.mockResolvedValue([
        makeEnrollment({ userId: 'user-regress-only' }),
        makeEnrollment({
          id: 'uc-cert',
          userId: 'user-regress-and-cert',
          user: {
            email: 'c@x.com',
            firstName: 'C',
            lastName: '',
            deletedAt: null,
          },
        }),
      ]);
      prisma.userCourseProgress.groupBy.mockResolvedValue([
        { userId: 'user-regress-only', _count: { _all: 6 } },
        { userId: 'user-regress-and-cert', _count: { _all: 12 } },
      ]);
      // The certified learner clamps to 100 on BOTH sides (current AND
      // projected) — they're certified regardless of denominator.
      // So they should NOT count as wouldRegress. Bulk migration to a
      // larger denom preserves their 100% clamp.
      prisma.courseCompletion.findMany.mockResolvedValue([
        { userId: 'user-regress-and-cert' },
      ]);

      const result = await service.migrateLearnersToVersionBulk(
        'admin-1',
        'course-1',
        {
          userIds: ['user-regress-only', 'user-regress-and-cert'],
          targetVersionId: 'ver-target',
          dryRun: true,
        },
      );

      if (!('results' in result.data))
        throw new Error('expected dryRun response');
      // Certified learner never regresses (100 → 100 clamp), so
      // wouldRegress counts only the non-certified regressor.
      expect(result.data.summary.wouldRegress).toBe(1);
      expect(result.data.summary.certifiedAndWouldRegress).toBe(0);
      expect(result.data.summary.total).toBe(2);
    });

    it('surfaces notEnrolled and alreadyOnTarget in summary but not in results', async () => {
      prisma.userCourse.findMany.mockResolvedValue([
        makeEnrollment({
          userId: 'user-on-target',
          enrolledVersionId: 'ver-target', // already there
          enrolledVersion: { versionNumber: 5, sectionCount: 20 },
        }),
      ]);

      const result = await service.migrateLearnersToVersionBulk(
        'admin-1',
        'course-1',
        {
          userIds: ['user-on-target', 'user-does-not-exist'],
          targetVersionId: 'ver-target',
          dryRun: true,
        },
      );

      if (!('results' in result.data))
        throw new Error('expected dryRun response');
      expect(result.data.summary.alreadyOnTarget).toBe(1);
      expect(result.data.summary.notEnrolled).toBe(1);
      // The results table is only "projected" learners — skips don't
      // appear there because they have no meaningful before/after row.
      expect(result.data.results).toHaveLength(0);
    });
  });

  // ─── Real run ───────────────────────────────────────────────────────

  describe('real run', () => {
    it('skips regressing learners not in acceptRegressionFor', async () => {
      prisma.userCourse.findMany.mockResolvedValue([makeEnrollment()]);
      prisma.userCourseProgress.groupBy.mockResolvedValue([
        { userId: 'user-1', _count: { _all: 6 } },
      ]);
      // Real-run inside a tx re-reads the row.
      prisma.userCourse.findUnique.mockResolvedValue(null);

      const result = await service.migrateLearnersToVersionBulk(
        'admin-1',
        'course-1',
        {
          userIds: ['user-1'],
          targetVersionId: 'ver-target',
          dryRun: false,
        },
      );

      if (!('migrated' in result.data))
        throw new Error('expected real-run response');
      expect(result.data.migrated).toEqual([]);
      expect(result.data.skipped).toEqual([
        { userId: 'user-1', reason: 'would_regress_not_accepted' },
      ]);
      // Critical: the transaction was NOT opened for a regressing learner
      // — regression check is server-side, before any tx.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('migrates regressing learners when in acceptRegressionFor with forced=true audit', async () => {
      prisma.userCourse.findMany.mockResolvedValue([makeEnrollment()]);
      prisma.userCourseProgress.groupBy.mockResolvedValue([
        { userId: 'user-1', _count: { _all: 6 } },
      ]);
      // Inside the tx: reload the enrollment.
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-1',
        courseId: 'course-1',
        userId: 'user-1',
        enrolledVersionId: 'ver-old',
        enrolledVersion: { versionNumber: 3 },
      });

      const result = await service.migrateLearnersToVersionBulk(
        'admin-1',
        'course-1',
        {
          userIds: ['user-1'],
          targetVersionId: 'ver-target',
          dryRun: false,
          acceptRegressionFor: ['user-1'],
        },
      );

      if (!('migrated' in result.data))
        throw new Error('expected real-run response');
      expect(result.data.migrated).toEqual(['user-1']);
      expect(prisma.userCourse.update).toHaveBeenCalledWith({
        where: { id: 'uc-1' },
        data: { enrolledVersionId: 'ver-target' },
      });
      // The audit row must record forced: true — this is what an ops
      // review picks up to see which learners were regressed with
      // explicit acceptance vs. moved forward normally.
      const auditCall = prisma.adminAuditLog.create.mock.calls[0][0];
      expect(auditCall.data.action).toBe('BULK_MIGRATE_LEARNER_VERSION');
      expect(auditCall.data.metadata).toEqual(
        expect.objectContaining({
          wouldRegress: true,
          forced: true,
          fromVersionNumber: 3,
          toVersionNumber: 5,
        }),
      );
    });

    it('wedged learner rolls back its own tx only; others proceed', async () => {
      prisma.userCourse.findMany.mockResolvedValue([
        makeEnrollment({ userId: 'user-good', id: 'uc-good' }),
        makeEnrollment({ userId: 'user-wedged', id: 'uc-wedged' }),
      ]);
      prisma.userCourseProgress.groupBy.mockResolvedValue([
        // Non-regressing progress (both at 100% denom / low numer),
        // acceptRegressionFor is empty so both must pass regression
        // check. Set numer high enough that projected >= current.
        { userId: 'user-good', _count: { _all: 20 } },
        { userId: 'user-wedged', _count: { _all: 20 } },
      ]);

      // The first tx succeeds; the second throws at the tx boundary.
      prisma.$transaction = makeAbortAwareTransactionMock(prisma, {
        failOnCall: 2,
      });
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-good',
        courseId: 'course-1',
        userId: 'user-good',
        enrolledVersionId: 'ver-old',
        enrolledVersion: { versionNumber: 3 },
      });

      const result = await service.migrateLearnersToVersionBulk(
        'admin-1',
        'course-1',
        {
          userIds: ['user-good', 'user-wedged'],
          targetVersionId: 'ver-target',
          dryRun: false,
        },
      );

      if (!('migrated' in result.data))
        throw new Error('expected real-run response');
      // The good learner migrated, the wedged one is skipped with its
      // error message — the outer HTTP call is 200, not 500.
      expect(result.data.migrated).toEqual(['user-good']);
      expect(result.data.skipped).toEqual([
        expect.objectContaining({
          userId: 'user-wedged',
          reason: 'migration_failed',
          errorMessage: expect.stringContaining('P2034'),
        }),
      ]);
    });

    it('skipped user_not_enrolled when the UserCourse row is missing', async () => {
      prisma.userCourse.findMany.mockResolvedValue([]); // no enrollments

      const result = await service.migrateLearnersToVersionBulk(
        'admin-1',
        'course-1',
        {
          userIds: ['user-nonexistent'],
          targetVersionId: 'ver-target',
          dryRun: false,
        },
      );

      if (!('migrated' in result.data))
        throw new Error('expected real-run response');
      expect(result.data.migrated).toEqual([]);
      expect(result.data.skipped).toEqual([
        { userId: 'user-nonexistent', reason: 'user_not_enrolled' },
      ]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('skipped user_not_enrolled when the user is soft-deleted', async () => {
      prisma.userCourse.findMany.mockResolvedValue([
        makeEnrollment({
          user: {
            email: 'x@x.com',
            firstName: '',
            lastName: '',
            deletedAt: new Date('2026-01-01'), // ← soft deleted
          },
        }),
      ]);

      const result = await service.migrateLearnersToVersionBulk(
        'admin-1',
        'course-1',
        {
          userIds: ['user-1'],
          targetVersionId: 'ver-target',
          dryRun: false,
        },
      );

      if (!('migrated' in result.data))
        throw new Error('expected real-run response');
      // Soft-deleted user is treated same as "not enrolled" — the FE
      // never should have passed the id in the first place (roster
      // filters deletedAt: null) but the server double-guards.
      expect(result.data.skipped[0].reason).toBe('user_not_enrolled');
    });

    it('skipped already_on_target_version when the pin already matches', async () => {
      prisma.userCourse.findMany.mockResolvedValue([
        makeEnrollment({
          enrolledVersionId: 'ver-target',
          enrolledVersion: { versionNumber: 5, sectionCount: 20 },
        }),
      ]);

      const result = await service.migrateLearnersToVersionBulk(
        'admin-1',
        'course-1',
        {
          userIds: ['user-1'],
          targetVersionId: 'ver-target',
          dryRun: false,
        },
      );

      if (!('migrated' in result.data))
        throw new Error('expected real-run response');
      expect(result.data.skipped).toEqual([
        { userId: 'user-1', reason: 'already_on_target_version' },
      ]);
      // No wasted tx for a no-op skip.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('emits BULK_MIGRATE_LEARNER_VERSION audit for each migrated learner', async () => {
      prisma.userCourse.findMany.mockResolvedValue([
        // Both non-regressing: same denom means projected == current.
        makeEnrollment({
          userId: 'user-a',
          id: 'uc-a',
          enrolledVersion: { versionNumber: 3, sectionCount: 20 },
        }),
        makeEnrollment({
          userId: 'user-b',
          id: 'uc-b',
          enrolledVersion: { versionNumber: 4, sectionCount: 20 },
        }),
      ]);
      prisma.userCourse.findUnique.mockResolvedValueOnce({
        id: 'uc-a',
        courseId: 'course-1',
        userId: 'user-a',
        enrolledVersionId: 'ver-a',
        enrolledVersion: { versionNumber: 3 },
      });
      prisma.userCourse.findUnique.mockResolvedValueOnce({
        id: 'uc-b',
        courseId: 'course-1',
        userId: 'user-b',
        enrolledVersionId: 'ver-b',
        enrolledVersion: { versionNumber: 4 },
      });

      await service.migrateLearnersToVersionBulk('admin-1', 'course-1', {
        userIds: ['user-a', 'user-b'],
        targetVersionId: 'ver-target',
        dryRun: false,
      });

      // One audit row per migrated learner. Bulk action distinguishes
      // from the single-learner endpoint's MIGRATE_LEARNER_VERSION.
      const actions = prisma.adminAuditLog.create.mock.calls.map(
        (c: any) => c[0].data.action,
      );
      expect(actions).toEqual([
        'BULK_MIGRATE_LEARNER_VERSION',
        'BULK_MIGRATE_LEARNER_VERSION',
      ]);
    });

    it('keeps the migration when the audit write fails', async () => {
      // REGRESSION: the audit used to be written inside the migration tx via
      // writeAudit(entry, tx). On Postgres a failed statement aborts the tx and
      // commit then fails, so writeAudit swallowing the error did NOT save the
      // migration — it silently rolled it back and surfaced as a generic
      // "transaction aborted" migration_failed skip.
      //
      // The audit now runs after commit, so an audit failure degrades to a
      // logged warning and the learner is still migrated. This test only fails
      // meaningfully under an abort-aware $transaction mock.
      prisma.userCourse.findMany.mockResolvedValue([makeEnrollment()]);
      prisma.userCourseProgress.groupBy.mockResolvedValue([
        { userId: 'user-1', _count: { _all: 20 } },
      ]);
      prisma.userCourse.findUnique.mockResolvedValue({
        id: 'uc-1',
        courseId: 'course-1',
        userId: 'user-1',
        enrolledVersionId: 'ver-old',
        enrolledVersion: { versionNumber: 3 },
      });
      prisma.adminAuditLog.create.mockRejectedValue(
        new Error('audit insert exploded'),
      );

      const result = await service.migrateLearnersToVersionBulk(
        'admin-1',
        'course-1',
        {
          userIds: ['user-1'],
          targetVersionId: 'ver-target',
          dryRun: false,
        },
      );

      if (result.data.dryRun !== false)
        throw new Error('expected real-run response');
      // The pin was updated and the learner counts as migrated.
      expect(prisma.userCourse.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'uc-1' },
          data: { enrolledVersionId: 'ver-target' },
        }),
      );
      expect(result.data.migrated).toEqual(['user-1']);
      expect(result.data.skipped).toEqual([]);
    });
  });
});
