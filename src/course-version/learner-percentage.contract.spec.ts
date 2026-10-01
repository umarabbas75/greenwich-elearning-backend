import { readFileSync } from 'fs';
import { join } from 'path';
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

/**
 * The test of the SCORM lesson-progress design.
 *
 * An imported SCORM course materialises one Section per Rise lesson and writes
 * decoded lesson completions as ordinary `UserCourseProgress` rows. If that is
 * right, the engine needs no SCORM branch at all — a SCORM learner is
 * arithmetically indistinguishable from a native one.
 *
 * If any of these ever require a change to learner-percentage.ts, that is the
 * signal the write-side design is wrong. Do not add the branch here.
 */
describe('learner-percentage — imported SCORM parity', () => {
  let prisma: Record<string, any>;

  const lessonSections = Array.from({ length: 14 }, (_, i) => `sec-${i}`);

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

  /** A 14-lesson SCORM course on the live tree, learner done with `completed`. */
  const setupLive = (completed: string[]) => {
    prisma.$queryRaw.mockResolvedValue(
      lessonSections.map((id) => ({ id, courseId: 'course-1' })),
    );
    prisma.userCourseProgress.findMany.mockResolvedValue(
      completed.map((sectionId) => ({
        userId: 'user-1',
        courseId: 'course-1',
        sectionId,
      })),
    );
  };

  /**
   * The plan's definition of done: 3 of 14 lessons reads 21% — the same number
   * Rise's own `progress.p` reported for this learner on live data.
   */
  it('reports 21% for a learner 3 lessons into 14', async () => {
    setupLive(['sec-0', 'sec-1', 'sec-4']);

    const result = await run([
      { userId: 'user-1', courseId: 'course-1', enrolledVersionId: null },
    ]);
    const entry = result.get(percentageKey('user-1', 'course-1'))!;

    expect(entry.numerator).toBe(3);
    expect(entry.denominator).toBe(14);
    expect(entry.percentage).toBe(21);
  });

  it('reads 0% before the learner completes a lesson, not "not started"', async () => {
    setupLive([]);
    const result = await run([
      { userId: 'user-1', courseId: 'course-1', enrolledVersionId: null },
    ]);
    const entry = result.get(percentageKey('user-1', 'course-1'))!;
    expect(entry.percentage).toBe(0);
    expect(entry.denominator).toBe(14);
  });

  /**
   * The completion bridge stamps every section the gate counts, so a certified
   * SCORM learner arrives here with all 14 rows and must read exactly 100 —
   * not 99 from the "never round up to finished" floor.
   */
  it('reads exactly 100% once the bridge has stamped every lesson', async () => {
    setupLive(lessonSections);
    const result = await run([
      { userId: 'user-1', courseId: 'course-1', enrolledVersionId: null },
    ]);
    const entry = result.get(percentageKey('user-1', 'course-1'))!;
    expect(entry.numerator).toBe(14);
    expect(entry.percentage).toBe(100);
  });

  /**
   * A learner pinned before the lesson backfill keeps a one-section curriculum.
   * Their progress row against the old synthetic section still counts, and they
   * read binary 0/100 — correct for the curriculum they were pinned to.
   */
  it('keeps a pre-backfill learner on their one-section denominator', async () => {
    prisma.userCourse.findMany.mockResolvedValue([
      { userId: 'user-1', courseId: 'course-1', enrolledVersionId: 'ver-old' },
    ]);
    prisma.courseVersion.findUnique.mockResolvedValue({
      id: 'ver-old',
      manifest: {
        modules: [
          {
            sourceId: 'mod-1',
            order: 0,
            chapters: [
              {
                sourceId: 'ch-1',
                order: 0,
                sectionIds: ['sec-legacy'],
                quizIds: [],
              },
            ],
          },
        ],
      },
    });
    prisma.userCourseProgress.findMany.mockResolvedValue([
      { userId: 'user-1', courseId: 'course-1', sectionId: 'sec-legacy' },
    ]);

    const result = await run([{ userId: 'user-1', courseId: 'course-1' }]);
    const entry = result.get(percentageKey('user-1', 'course-1'))!;
    expect(entry.denominator).toBe(1);
    expect(entry.percentage).toBe(100);
    expect(entry.denominatorSource).toBe('manifest');
  });

  /**
   * Progress rows written against a SUPERSEDED package's archived sections must
   * not leak into the live denominator — the engine intersects rather than
   * counting raw rows, and that is what stops a package replace inflating a
   * learner past their real position.
   */
  it('ignores rows for sections outside the learner curriculum', async () => {
    prisma.$queryRaw.mockResolvedValue(
      lessonSections.map((id) => ({ id, courseId: 'course-1' })),
    );
    prisma.userCourseProgress.findMany.mockResolvedValue([
      { userId: 'user-1', courseId: 'course-1', sectionId: 'sec-0' },
      { userId: 'user-1', courseId: 'course-1', sectionId: 'old-pkg-sec-3' },
      { userId: 'user-1', courseId: 'course-1', sectionId: 'old-pkg-sec-7' },
    ]);

    const result = await run([
      { userId: 'user-1', courseId: 'course-1', enrolledVersionId: null },
    ]);
    const entry = result.get(percentageKey('user-1', 'course-1'))!;
    expect(entry.numerator).toBe(1);
    expect(entry.denominator).toBe(14);
  });

  /** The engine must contain no SCORM-specific code for any of the above. */
  it('learner-percentage.ts references nothing SCORM', () => {
    const source = readFileSync(
      join(__dirname, 'learner-percentage.ts'),
      'utf8',
    );
    expect(source.toLowerCase()).not.toContain('scorm');
  });
});
