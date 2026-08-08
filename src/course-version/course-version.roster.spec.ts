import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CourseVersionService } from './course-version.service';

/**
 * PR 2 tests — `getRoster(courseId, opts)`. Kept in its own spec file
 * because the roster query graph (5 queries, two sort branches, percentage
 * calc alignment with countCompletionDenominator) is complex enough that
 * mixing it into the existing 700-line course-version.service.spec.ts would
 * make both harder to navigate.
 */
describe('CourseVersionService.getRoster (PR 2)', () => {
  let service: CourseVersionService;
  let prisma: Record<string, any>;

  const defaultLatest = {
    id: 'ver-latest',
    versionNumber: 5,
  };

  beforeEach(async () => {
    prisma = {
      courseVersion: {
        // The Phase-1 latest-published lookup.
        findFirst: jest.fn().mockResolvedValue(defaultLatest),
      },
      userCourse: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      userCourseProgress: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
      courseCompletion: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      section: {
        count: jest.fn().mockResolvedValue(10),
      },
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

  // Helper for a valid raw row shape (matches the `rosterSelect` const).
  const rawRow = (over: Partial<any> = {}) => ({
    userId: 'user-1',
    isActive: true,
    isPaid: true,
    enrolledVersionId: 'ver-latest',
    user: {
      email: 'user-1@example.com',
      firstName: 'One',
      lastName: 'Alpha',
    },
    enrolledVersion: { versionNumber: 5, sectionCount: 10 },
    ...over,
  });

  it('returns the paginated shape with latest published version at the top', async () => {
    prisma.userCourse.findMany.mockResolvedValue([rawRow()]);
    prisma.userCourse.count.mockResolvedValue(1);

    const result = await service.getRoster('course-1', {});

    // Top-level latest — FE derives per-row "isLatest" from this so a
    // publish mid-page never produces inconsistent rows.
    expect(result.data.latestPublishedVersionId).toBe('ver-latest');
    expect(result.data.latestPublishedVersionNumber).toBe(5);
    expect(result.data.total).toBe(1);
    expect(result.data.page).toBe(1);
    expect(result.data.pageSize).toBe(20);
    expect(result.data.rows).toHaveLength(1);
  });

  it('filters soft-deleted users (user.deletedAt: null) by default', async () => {
    await service.getRoster('course-1', {});

    // Both the findMany and the count must apply the same user filter,
    // otherwise total drifts from the visible rows.
    const findManyCall = prisma.userCourse.findMany.mock.calls[0][0];
    const countCall = prisma.userCourse.count.mock.calls[0][0];
    expect(findManyCall.where.user).toEqual(
      expect.objectContaining({ deletedAt: null }),
    );
    expect(countCall.where.user).toEqual(
      expect.objectContaining({ deletedAt: null }),
    );
  });

  it('applies versionFilter to narrow to one specific pinned version', async () => {
    await service.getRoster('course-1', { versionFilter: 'ver-3' });

    const call = prisma.userCourse.findMany.mock.calls[0][0];
    expect(call.where.enrolledVersionId).toBe('ver-3');
  });

  it('search matches email OR firstName OR lastName (case-insensitive)', async () => {
    await service.getRoster('course-1', { search: 'jane' });

    const call = prisma.userCourse.findMany.mock.calls[0][0];
    const userFilter = call.where.user;
    expect(userFilter.OR).toEqual(
      expect.arrayContaining([
        { email: { contains: 'jane', mode: 'insensitive' } },
        { firstName: { contains: 'jane', mode: 'insensitive' } },
        { lastName: { contains: 'jane', mode: 'insensitive' } },
      ]),
    );
    // deletedAt must survive the search overlay — a search for 'x' should
    // not resurrect deleted users.
    expect(userFilter.deletedAt).toBeNull();
  });

  it('non-percentage sort paginates in the DB (orderBy + take + skip in findMany)', async () => {
    await service.getRoster('course-1', {
      sort: 'email:asc',
      page: 3,
      pageSize: 10,
    });

    const call = prisma.userCourse.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ user: { email: 'asc' } });
    expect(call.take).toBe(10);
    expect(call.skip).toBe(20);
  });

  it('percentage sort overfetches (no orderBy/take/skip in findMany) and sorts in memory', async () => {
    // Ten rows spanning 0-90% so the sort is meaningful.
    const rows = Array.from({ length: 10 }, (_, i) =>
      rawRow({
        userId: `user-${i}`,
        user: {
          email: `u${i}@example.com`,
          firstName: `F${i}`,
          lastName: `L${i}`,
        },
      }),
    );
    prisma.userCourse.findMany.mockResolvedValue(rows);
    prisma.userCourse.count.mockResolvedValue(10);
    // Progress: user-i has i sections completed out of 10 (0%, 10%, …, 90%).
    prisma.userCourseProgress.groupBy.mockResolvedValue(
      rows.map((_, i) => ({ userId: `user-${i}`, _count: { _all: i } })),
    );

    const result = await service.getRoster('course-1', {
      sort: 'percentage:desc',
    });

    // Ensure orderBy/take/skip were NOT applied in the DB call — the
    // percentage branch must overfetch and sort in memory, otherwise
    // paginating by an uncomputed field would surface arbitrary rows.
    const call = prisma.userCourse.findMany.mock.calls[0][0];
    expect(call.orderBy).toBeUndefined();
    expect(call.take).toBeUndefined();
    expect(call.skip).toBeUndefined();

    // Verify actual sort direction.
    const pcts = result.data.rows.map((r) => r.percentage);
    for (let i = 1; i < pcts.length; i++) {
      expect(pcts[i - 1]).toBeGreaterThanOrEqual(pcts[i]);
    }
    // Highest percentage first — user-9 completed 9/10 → 90%.
    expect(result.data.rows[0].userId).toBe('user-9');
  });

  it('pinned learner uses the enrolledVersion.sectionCount as denominator', async () => {
    prisma.userCourse.findMany.mockResolvedValue([
      rawRow({
        enrolledVersion: { versionNumber: 3, sectionCount: 20 }, // pinned to 20
      }),
    ]);
    prisma.userCourse.count.mockResolvedValue(1);
    // 5 completed / 20 pinned = 25% (round(500/20) = 25).
    prisma.userCourseProgress.groupBy.mockResolvedValue([
      { userId: 'user-1', _count: { _all: 5 } },
    ]);
    // Live count set to 10 — MUST NOT be used for a pinned learner.
    // If it were, we'd wrongly get 50%.
    prisma.section.count.mockResolvedValue(10);

    const result = await service.getRoster('course-1', {});
    expect(result.data.rows[0].percentage).toBe(25);
  });

  it('unpinned learner uses the live section count as denominator', async () => {
    prisma.userCourse.findMany.mockResolvedValue([
      rawRow({ enrolledVersionId: null, enrolledVersion: null }),
    ]);
    prisma.userCourse.count.mockResolvedValue(1);
    prisma.userCourseProgress.groupBy.mockResolvedValue([
      { userId: 'user-1', _count: { _all: 4 } },
    ]);
    // Live count = 8 → 4/8 = 50%.
    prisma.section.count.mockResolvedValue(8);

    const result = await service.getRoster('course-1', {});
    expect(result.data.rows[0].percentage).toBe(50);
  });

  it('applies the isArchived/isActive Section filter on the numerator groupBy (aligns with countCompletionDenominator)', async () => {
    prisma.userCourse.findMany.mockResolvedValue([rawRow()]);
    prisma.userCourse.count.mockResolvedValue(1);

    await service.getRoster('course-1', {});

    // If this filter isn't applied, the roster's numerator counts
    // archived-section progress that the completion gate does not,
    // reproducing the roster-shows-92%-completion-says-100% bug. Pinning
    // it here catches an accidental removal.
    const call = prisma.userCourseProgress.groupBy.mock.calls[0][0];
    expect(call.where.Section).toEqual({
      isArchived: false,
      isActive: true,
    });
  });

  it('isCompleted flag reflects the CourseCompletion.courseCompletedAt filter', async () => {
    prisma.userCourse.findMany.mockResolvedValue([
      rawRow({ userId: 'completed-user' }),
      rawRow({
        userId: 'not-completed-user',
        user: { email: 'x@x.com', firstName: '', lastName: '' },
      }),
    ]);
    prisma.userCourse.count.mockResolvedValue(2);
    prisma.courseCompletion.findMany.mockResolvedValue([
      { userId: 'completed-user' },
    ]);

    const result = await service.getRoster('course-1', {});
    const completed = result.data.rows.find(
      (r) => r.userId === 'completed-user',
    )!;
    const notCompleted = result.data.rows.find(
      (r) => r.userId === 'not-completed-user',
    )!;
    expect(completed.isCompleted).toBe(true);
    expect(notCompleted.isCompleted).toBe(false);

    // The findMany must scope to courseCompletedAt NOT null — a
    // CourseCompletion row exists during progress but courseCompletedAt
    // is only set on true completion. Without this filter, in-progress
    // learners would be flagged as "completed".
    const call = prisma.courseCompletion.findMany.mock.calls[0][0];
    expect(call.where.courseCompletedAt).toEqual({ not: null });
  });

  it('clamps completers to exactly 100 regardless of raw numerator', async () => {
    // The learner completed the course, but their UserCourseProgress
    // rows haven't caught up (or archived sections are still counted).
    // The clamp guarantees the admin never sees 98.7% for a certified
    // learner — matches the frontend completion freeze.
    prisma.userCourse.findMany.mockResolvedValue([rawRow()]);
    prisma.userCourse.count.mockResolvedValue(1);
    prisma.userCourseProgress.groupBy.mockResolvedValue([
      { userId: 'user-1', _count: { _all: 3 } }, // 3/10 = 30% raw
    ]);
    prisma.courseCompletion.findMany.mockResolvedValue([{ userId: 'user-1' }]);

    const result = await service.getRoster('course-1', {});
    expect(result.data.rows[0].percentage).toBe(100);
    expect(result.data.rows[0].isCompleted).toBe(true);
  });

  it('returns a valid empty shape when the course has zero enrollments', async () => {
    prisma.userCourse.findMany.mockResolvedValue([]);
    prisma.userCourse.count.mockResolvedValue(0);

    const result = await service.getRoster('course-1', {});
    expect(result.data.rows).toEqual([]);
    expect(result.data.total).toBe(0);
    // Batch-per-user queries must not fire when userIds is empty (would
    // still work, but noisy in production logs).
    expect(prisma.userCourseProgress.groupBy).not.toHaveBeenCalled();
    expect(prisma.courseCompletion.findMany).not.toHaveBeenCalled();
  });

  it('returns latest = null when the course has no published versions yet', async () => {
    prisma.courseVersion.findFirst.mockResolvedValue(null);

    const result = await service.getRoster('course-1', {});
    expect(result.data.latestPublishedVersionId).toBeNull();
    expect(result.data.latestPublishedVersionNumber).toBeNull();
  });

  it('secondary-sorts by email for a deterministic order among percentage ties', async () => {
    // Three learners all at 100% (completed). Without a tiebreaker the
    // page order would depend on findMany's arbitrary ordering.
    prisma.userCourse.findMany.mockResolvedValue([
      rawRow({
        userId: 'u-c',
        user: { email: 'c@x.com', firstName: 'C', lastName: '' },
      }),
      rawRow({
        userId: 'u-a',
        user: { email: 'a@x.com', firstName: 'A', lastName: '' },
      }),
      rawRow({
        userId: 'u-b',
        user: { email: 'b@x.com', firstName: 'B', lastName: '' },
      }),
    ]);
    prisma.userCourse.count.mockResolvedValue(3);
    prisma.courseCompletion.findMany.mockResolvedValue([
      { userId: 'u-c' },
      { userId: 'u-a' },
      { userId: 'u-b' },
    ]);

    const result = await service.getRoster('course-1', {
      sort: 'percentage:desc',
    });
    expect(result.data.rows.map((r) => r.email)).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
    ]);
  });

  it('clamps pageSize to 100 (protection against unbounded requests)', async () => {
    // Use a non-percentage sort so pageSize actually surfaces as `take` in
    // the DB call. Percentage-sort branch overfetches by design (no take/
    // skip) and clamps only on the in-memory slice.
    await service.getRoster('course-1', {
      pageSize: 9999,
      sort: 'email:asc',
    });
    expect(prisma.userCourse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it('clamps overfetched page slice to pageSize=100 in the percentage-sort branch too', async () => {
    // Overfetch of 150 rows all at the same percentage → after in-memory
    // sort + slice, the page should still be bounded to pageSize (clamped
    // to 100). Without the max-clamp on `pageSize`, a caller could pass
    // `pageSize=1_000_000` and get every enrollment in a single response.
    const rows = Array.from({ length: 150 }, (_, i) =>
      rawRow({
        userId: `u-${i}`,
        user: {
          email: `u${String(i).padStart(3, '0')}@x.com`,
          firstName: '',
          lastName: '',
        },
      }),
    );
    prisma.userCourse.findMany.mockResolvedValue(rows);
    prisma.userCourse.count.mockResolvedValue(150);

    const result = await service.getRoster('course-1', {
      pageSize: 9999,
      sort: 'percentage:desc',
    });
    expect(result.data.pageSize).toBe(100);
    expect(result.data.rows.length).toBe(100);
  });
});
