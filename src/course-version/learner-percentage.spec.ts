import { PrismaService } from '../prisma/prisma.service';
import { resetManifestCache } from './course-version.manifest';
import {
  computeLearnerPercentage,
  computeLearnerPercentages,
  percentageKey,
} from './learner-percentage';

/**
 * The engine exists to make numerator/denominator scope mismatch
 * unrepresentable. The headline test is
 * "pinned learner with a since-archived section" — the exact shape that made
 * the admin roster read 92% for a learner the completion gate considered done.
 */
describe('computeLearnerPercentages', () => {
  let prisma: Record<string, any>;

  /** Manifest with the given section ids under one chapter. */
  const manifestWith = (sectionIds: string[], quizIds: string[] = []) => ({
    modules: [
      {
        sourceId: 'mod-1',
        order: 0,
        chapters: [{ sourceId: 'ch-1', order: 0, sectionIds, quizIds }],
      },
    ],
  });

  const liveSection = (id: string, courseId: string) => ({
    id,
    chapter: { module: { courseId } },
  });

  beforeEach(() => {
    resetManifestCache();
    prisma = {
      userCourse: { findMany: jest.fn().mockResolvedValue([]) },
      courseCompletion: { findMany: jest.fn().mockResolvedValue([]) },
      courseVersion: { findUnique: jest.fn() },
      section: { findMany: jest.fn().mockResolvedValue([]) },
      userCourseProgress: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
  });

  const run = (pairs: Array<{ userId: string; courseId: string }>) =>
    computeLearnerPercentages(prisma as unknown as PrismaService, pairs);

  it('reads 100 for a pinned learner who completed a since-archived section', async () => {
    // THE regression. v3 snapshotted 12 sections; one was archived afterwards.
    // The learner completed all 12. A live-filtered numerator over the frozen
    // denominator gives 11/12 = 92%. Deriving BOTH halves from the manifest
    // gives 12/12 = 100 — matching the completion gate.
    const sectionIds = Array.from({ length: 12 }, (_, i) => `sec-${i}`);
    prisma.userCourse.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', enrolledVersionId: 'ver-3' },
    ]);
    prisma.courseVersion.findUnique.mockResolvedValue({
      manifest: manifestWith(sectionIds),
    });
    prisma.userCourseProgress.findMany.mockResolvedValue(
      sectionIds.map((sectionId) => ({
        userId: 'u1',
        courseId: 'c1',
        sectionId,
      })),
    );

    const res = await run([{ userId: 'u1', courseId: 'c1' }]);
    const row = res.get(percentageKey('u1', 'c1'))!;

    expect(row).toMatchObject({
      percentage: 100,
      numerator: 12,
      denominator: 12,
      denominatorSource: 'manifest',
    });
    // The live-section query is never issued for a resolvable pinned learner.
    expect(prisma.section.findMany).not.toHaveBeenCalled();
  });

  it('uses the live tree for an unpinned learner', async () => {
    prisma.userCourse.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', enrolledVersionId: null },
    ]);
    prisma.section.findMany.mockResolvedValue([
      liveSection('s1', 'c1'),
      liveSection('s2', 'c1'),
      liveSection('s3', 'c1'),
    ]);
    prisma.userCourseProgress.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', sectionId: 's1' },
      { userId: 'u1', courseId: 'c1', sectionId: 's2' },
    ]);

    const row = (await run([{ userId: 'u1', courseId: 'c1' }])).get(
      percentageKey('u1', 'c1'),
    )!;

    expect(row).toMatchObject({
      percentage: 67,
      numerator: 2,
      denominator: 3,
      denominatorSource: 'live',
    });
  });

  it('ignores progress on sections outside the learner curriculum', async () => {
    // A row for a section archived after the learner pinned, or left over from
    // a reassignment, must not inflate the numerator past the denominator.
    prisma.userCourse.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', enrolledVersionId: 'ver-1' },
    ]);
    prisma.courseVersion.findUnique.mockResolvedValue({
      manifest: manifestWith(['s1', 's2']),
    });
    prisma.userCourseProgress.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', sectionId: 's1' },
      { userId: 'u1', courseId: 'c1', sectionId: 's2' },
      { userId: 'u1', courseId: 'c1', sectionId: 'stale-not-in-manifest' },
    ]);

    const row = (await run([{ userId: 'u1', courseId: 'c1' }])).get(
      percentageKey('u1', 'c1'),
    )!;

    expect(row.numerator).toBe(2);
    expect(row.denominator).toBe(2);
    expect(row.percentage).toBe(100);
  });

  it('falls back to the live tree when a pinned manifest is unresolvable', async () => {
    // Mirrors countCompletionDenominator: degrade to live, never to 0/0.
    prisma.userCourse.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', enrolledVersionId: 'gone' },
    ]);
    prisma.courseVersion.findUnique.mockResolvedValue(null);
    prisma.section.findMany.mockResolvedValue([liveSection('s1', 'c1')]);
    prisma.userCourseProgress.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', sectionId: 's1' },
    ]);

    const row = (await run([{ userId: 'u1', courseId: 'c1' }])).get(
      percentageKey('u1', 'c1'),
    )!;

    expect(row.denominatorSource).toBe('live');
    expect(row.percentage).toBe(100);
  });

  it('reads 100 for a certified learner whose course later grew', async () => {
    // The completion freeze: certified before new content landed.
    prisma.userCourse.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', enrolledVersionId: null },
    ]);
    prisma.courseCompletion.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1' },
    ]);
    prisma.section.findMany.mockResolvedValue([
      liveSection('s1', 'c1'),
      liveSection('s2', 'c1'),
    ]);
    prisma.userCourseProgress.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', sectionId: 's1' },
    ]);

    const row = (await run([{ userId: 'u1', courseId: 'c1' }])).get(
      percentageKey('u1', 'c1'),
    )!;

    expect(row.percentage).toBe(100);
    expect(row.isCompleted).toBe(true);
    // Raw counts stay truthful — only the displayed percentage is frozen.
    expect(row.numerator).toBe(1);
    expect(row.denominator).toBe(2);
  });

  it('returns a zeroed entry for a pair with no enrollment', async () => {
    prisma.userCourse.findMany.mockResolvedValue([]);

    const res = await run([{ userId: 'ghost', courseId: 'c1' }]);
    const row = res.get(percentageKey('ghost', 'c1'));

    expect(row).toMatchObject({ percentage: 0, numerator: 0, denominator: 0 });
  });

  it('returns an empty map for no pairs without querying', async () => {
    const res = await run([]);

    expect(res.size).toBe(0);
    expect(prisma.userCourse.findMany).not.toHaveBeenCalled();
  });

  // ─── Batching ────────────────────────────────────────────────────────

  it('loads each distinct version once regardless of learner count', async () => {
    // The N+1 guard. 4 learners across 2 versions => 2 manifest reads, and the
    // whole batch still costs a fixed number of round trips.
    prisma.userCourse.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', enrolledVersionId: 'ver-a' },
      { userId: 'u2', courseId: 'c1', enrolledVersionId: 'ver-a' },
      { userId: 'u3', courseId: 'c1', enrolledVersionId: 'ver-b' },
      { userId: 'u4', courseId: 'c1', enrolledVersionId: 'ver-b' },
    ]);
    prisma.courseVersion.findUnique.mockImplementation(({ where }: any) => ({
      manifest: manifestWith(
        where.id === 'ver-a' ? ['s1', 's2'] : ['s1', 's2', 's3', 's4'],
      ),
    }));
    prisma.userCourseProgress.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', sectionId: 's1' },
      { userId: 'u3', courseId: 'c1', sectionId: 's1' },
    ]);

    const res = await run([
      { userId: 'u1', courseId: 'c1' },
      { userId: 'u2', courseId: 'c1' },
      { userId: 'u3', courseId: 'c1' },
      { userId: 'u4', courseId: 'c1' },
    ]);

    expect(prisma.courseVersion.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.userCourseProgress.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.userCourse.findMany).toHaveBeenCalledTimes(1);

    // Same numerator, different pinned denominators.
    expect(res.get(percentageKey('u1', 'c1'))!.percentage).toBe(50); // 1/2
    expect(res.get(percentageKey('u3', 'c1'))!.percentage).toBe(25); // 1/4
    expect(res.get(percentageKey('u2', 'c1'))!.percentage).toBe(0);
  });

  it('keeps learners on different courses separate', async () => {
    prisma.userCourse.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', enrolledVersionId: null },
      { userId: 'u1', courseId: 'c2', enrolledVersionId: null },
    ]);
    prisma.section.findMany.mockResolvedValue([
      liveSection('a1', 'c1'),
      liveSection('a2', 'c1'),
      liveSection('b1', 'c2'),
    ]);
    prisma.userCourseProgress.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', sectionId: 'a1' },
      { userId: 'u1', courseId: 'c2', sectionId: 'b1' },
    ]);

    const res = await run([
      { userId: 'u1', courseId: 'c1' },
      { userId: 'u1', courseId: 'c2' },
    ]);

    expect(res.get(percentageKey('u1', 'c1'))!.percentage).toBe(50);
    expect(res.get(percentageKey('u1', 'c2'))!.percentage).toBe(100);
  });

  it('dedupes repeated pairs into one computation', async () => {
    prisma.userCourse.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', enrolledVersionId: 'ver-a' },
    ]);
    prisma.courseVersion.findUnique.mockResolvedValue({
      manifest: manifestWith(['s1']),
    });

    const res = await run([
      { userId: 'u1', courseId: 'c1' },
      { userId: 'u1', courseId: 'c1' },
    ]);

    expect(res.size).toBe(1);
    expect(prisma.courseVersion.findUnique).toHaveBeenCalledTimes(1);
  });

  it('computeLearnerPercentage wraps the batch for one learner', async () => {
    prisma.userCourse.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', enrolledVersionId: null },
    ]);
    prisma.section.findMany.mockResolvedValue([liveSection('s1', 'c1')]);

    const row = await computeLearnerPercentage(
      prisma as unknown as PrismaService,
      'u1',
      'c1',
    );

    expect(row).toMatchObject({ percentage: 0, denominator: 1 });
  });
});
