import { PrismaService } from '../prisma/prisma.service';
import { resetManifestCache } from './course-version.manifest';
import { computeLearnerPercentages, percentageKey } from './learner-percentage';

/**
 * Contract tests for the properties every A5 caller depends on.
 *
 * The five learner-facing endpoints each embed the engine's output rather than
 * dividing counts themselves. These pin the guarantees they rely on, so a
 * change to the engine that would silently break a caller fails here first —
 * next to the invariant, not buried in one endpoint's spec.
 */
describe('learner-percentage contract', () => {
  let prisma: Record<string, any>;

  const manifestWith = (sectionIds: string[]) => ({
    modules: [
      {
        sourceId: 'mod-1',
        order: 0,
        chapters: [{ sourceId: 'ch-1', order: 0, sectionIds, quizIds: [] }],
      },
    ],
  });

  beforeEach(() => {
    resetManifestCache();
    prisma = {
      userCourse: { findMany: jest.fn().mockResolvedValue([]) },
      courseCompletion: { findMany: jest.fn().mockResolvedValue([]) },
      courseVersion: { findUnique: jest.fn().mockResolvedValue(null) },
      section: { findMany: jest.fn().mockResolvedValue([]) },
      userCourseProgress: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
  });

  const run = (pairs: any[]) =>
    computeLearnerPercentages(prisma as unknown as PrismaService, pairs);

  it('numerator never exceeds denominator (the invariant A6 asserts on)', async () => {
    // Feed deliberately hostile data: progress rows for sections that are NOT
    // in the learner's curriculum. The FE divides these two counts and its
    // `done >= sections` gate is unclamped, so a numerator overshoot would
    // unlock content early rather than merely render >100%.
    prisma.courseVersion.findUnique.mockResolvedValue({
      manifest: manifestWith(['s1', 's2']),
    });
    prisma.userCourseProgress.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', sectionId: 's1' },
      { userId: 'u1', courseId: 'c1', sectionId: 's2' },
      { userId: 'u1', courseId: 'c1', sectionId: 'ghost-1' },
      { userId: 'u1', courseId: 'c1', sectionId: 'ghost-2' },
      { userId: 'u1', courseId: 'c1', sectionId: 'ghost-3' },
    ]);

    const row = (
      await run([{ userId: 'u1', courseId: 'c1', enrolledVersionId: 'ver-1' }])
    ).get(percentageKey('u1', 'c1'))!;

    expect(row.numerator).toBeLessThanOrEqual(row.denominator);
    expect(row.percentage).toBeLessThanOrEqual(100);
    expect(row.percentage).toBe(100);
  });

  it('percentage is an integer in [0, 100]', async () => {
    // Callers embed this verbatim; the FE renders it without rounding.
    prisma.courseVersion.findUnique.mockResolvedValue({
      manifest: manifestWith(['a', 'b', 'c']),
    });
    prisma.userCourseProgress.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', sectionId: 'a' },
    ]);

    const row = (
      await run([{ userId: 'u1', courseId: 'c1', enrolledVersionId: 'ver-1' }])
    ).get(percentageKey('u1', 'c1'))!;

    expect(Number.isInteger(row.percentage)).toBe(true);
    expect(row.percentage).toBe(33);
  });

  it('pre-seeds every requested pair so callers can index without a null branch', async () => {
    const res = await run([
      { userId: 'u1', courseId: 'c1', enrolledVersionId: null },
      { userId: 'u2', courseId: 'c2', enrolledVersionId: null },
    ]);

    expect(res.get(percentageKey('u1', 'c1'))).toBeDefined();
    expect(res.get(percentageKey('u2', 'c2'))).toBeDefined();
  });

  it('supplied pins suppress the enrollment lookup entirely', async () => {
    // A5 callers already hold UserCourse rows; re-querying would be a wasted
    // round trip on every dashboard render.
    prisma.courseVersion.findUnique.mockResolvedValue({
      manifest: manifestWith(['s1']),
    });

    await run([{ userId: 'u1', courseId: 'c1', enrolledVersionId: 'ver-1' }]);

    expect(prisma.userCourse.findMany).not.toHaveBeenCalled();
  });

  it('looks pins up when the caller does not supply them', async () => {
    prisma.userCourse.findMany.mockResolvedValue([
      { userId: 'u1', courseId: 'c1', enrolledVersionId: null },
    ]);
    prisma.$queryRaw.mockResolvedValue([{ id: 's1', courseId: 'c1' }]);

    const row = (await run([{ userId: 'u1', courseId: 'c1' }])).get(
      percentageKey('u1', 'c1'),
    )!;

    expect(prisma.userCourse.findMany).toHaveBeenCalledTimes(1);
    expect(row.denominator).toBe(1);
  });

  it('queries only the requested pairs, not the user x course cross product', async () => {
    // REGRESSION: the pin lookup used `userId IN (...) AND courseId IN (...)`,
    // which matches every combination. Asking for (A,C1) and (B,C2) also
    // fetched (A,C2) and (B,C1) — and then loaded THEIR manifests too. Output
    // stayed correct (everything is keyed per-pair) but cost grew as
    // users x courses instead of pairs.
    prisma.userCourse.findMany.mockResolvedValue([]);

    await run([
      { userId: 'A', courseId: 'C1' },
      { userId: 'B', courseId: 'C2' },
    ]);

    const where = prisma.userCourse.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { userId: 'A', courseId: 'C1' },
      { userId: 'B', courseId: 'C2' },
    ]);
    // The cross-product shape must be gone.
    expect(where.userId).toBeUndefined();
    expect(where.courseId).toBeUndefined();
  });

  it('does not credit one learner with another learner-course pair progress', async () => {
    // The behavioural consequence of the same bug: with a cross-product WHERE,
    // an unrequested (A,C2) enrollment could pull its manifest into the batch.
    // Percentages must reflect ONLY the requested pairs.
    prisma.userCourse.findMany.mockResolvedValue([
      { userId: 'A', courseId: 'C1', enrolledVersionId: 'vA' },
      { userId: 'B', courseId: 'C2', enrolledVersionId: 'vB' },
    ]);
    prisma.courseVersion.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve({
        manifest: manifestWith(
          where.id === 'vA' ? ['a1', 'a2'] : ['b1', 'b2', 'b3', 'b4'],
        ),
      }),
    );
    prisma.userCourseProgress.findMany.mockResolvedValue([
      { userId: 'A', courseId: 'C1', sectionId: 'a1' },
      { userId: 'B', courseId: 'C2', sectionId: 'b1' },
    ]);

    const res = await run([
      { userId: 'A', courseId: 'C1' },
      { userId: 'B', courseId: 'C2' },
    ]);

    expect(res.size).toBe(2);
    expect(res.get(percentageKey('A', 'C1'))!.percentage).toBe(50); // 1/2
    expect(res.get(percentageKey('B', 'C2'))!.percentage).toBe(25); // 1/4
  });

  it('reports denominatorSource so callers can log scope drift', async () => {
    prisma.courseVersion.findUnique.mockResolvedValue({
      manifest: manifestWith(['s1']),
    });

    const pinned = (
      await run([{ userId: 'u1', courseId: 'c1', enrolledVersionId: 'ver-1' }])
    ).get(percentageKey('u1', 'c1'))!;
    expect(pinned.denominatorSource).toBe('manifest');

    prisma.$queryRaw.mockResolvedValue([{ id: 's1', courseId: 'c2' }]);
    const unpinned = (
      await run([{ userId: 'u1', courseId: 'c2', enrolledVersionId: null }])
    ).get(percentageKey('u1', 'c2'))!;
    expect(unpinned.denominatorSource).toBe('live');
  });

  it('property: a learner who finished their manifest reads exactly 100, unclamped', async () => {
    // A6's invariant, stated as a property rather than an example.
    //
    // For ANY manifest shape and ANY set of sections archived after publish,
    // a learner who completed their pinned curriculum computes exactly 100 —
    // arithmetically, without the isCompleted freeze doing the work. This is
    // what makes the freeze non-load-bearing for correctly-scoped learners,
    // and it is the property the roster violated (92% for a finished learner).
    const shapes = [1, 2, 3, 5, 7, 12, 13, 20, 31, 32, 50, 116];

    for (const size of shapes) {
      resetManifestCache();
      const sectionIds = Array.from({ length: size }, (_, i) => `s-${i}`);
      prisma.courseVersion.findUnique.mockResolvedValue({
        manifest: manifestWith(sectionIds),
      });
      // Learner completed every section in their manifest. Some of those
      // Section rows may since have been archived — irrelevant, because the
      // denominator comes from the same manifest the numerator is matched
      // against. NOT certified, so no freeze is available to mask an error.
      prisma.courseCompletion.findMany.mockResolvedValue([]);
      prisma.userCourseProgress.findMany.mockResolvedValue(
        sectionIds.map((sectionId) => ({
          userId: 'u1',
          courseId: 'c1',
          sectionId,
        })),
      );

      const row = (
        await run([{ userId: 'u1', courseId: 'c1', enrolledVersionId: 'v' }])
      ).get(percentageKey('u1', 'c1'))!;

      expect(row.isCompleted).toBe(false);
      expect(row.numerator).toBe(size);
      expect(row.denominator).toBe(size);
      expect(row.percentage).toBe(100);
    }
  });

  it('property: partial completion never rounds up to a false 100', async () => {
    // The dual guard. A learner one section short must not read 100 at any
    // curriculum size — that would let the FE's `done >= sections` gate
    // unlock the next chapter early.
    for (const size of [2, 3, 7, 12, 50, 116, 201]) {
      resetManifestCache();
      const sectionIds = Array.from({ length: size }, (_, i) => `s-${i}`);
      prisma.courseVersion.findUnique.mockResolvedValue({
        manifest: manifestWith(sectionIds),
      });
      prisma.courseCompletion.findMany.mockResolvedValue([]);
      prisma.userCourseProgress.findMany.mockResolvedValue(
        sectionIds.slice(0, size - 1).map((sectionId) => ({
          userId: 'u1',
          courseId: 'c1',
          sectionId,
        })),
      );

      const row = (
        await run([{ userId: 'u1', courseId: 'c1', enrolledVersionId: 'v' }])
      ).get(percentageKey('u1', 'c1'))!;

      expect(row.numerator).toBe(size - 1);
      expect(row.percentage).toBeLessThan(100);
    }
  });

  it('an empty curriculum reads 0, never NaN', async () => {
    prisma.courseVersion.findUnique.mockResolvedValue({
      manifest: manifestWith([]),
    });

    const row = (
      await run([{ userId: 'u1', courseId: 'c1', enrolledVersionId: 'ver-1' }])
    ).get(percentageKey('u1', 'c1'))!;

    expect(row.percentage).toBe(0);
    expect(Number.isNaN(row.percentage)).toBe(false);
  });
});
