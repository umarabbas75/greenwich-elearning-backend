import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  getSectionIdsFromManifest,
  loadManifestForVersion,
} from './course-version.manifest';

/**
 * The single source of truth for "how much of this course has this learner
 * consumed".
 *
 * ## Why this exists
 *
 * Progress percentage used to be re-derived at every call site, and each site
 * independently chose its numerator and denominator scope. That is not a style
 * problem — it is what produced real bugs:
 *
 *  - The admin roster filtered its numerator to LIVE sections
 *    (`Section: { isArchived: false, isActive: true }`) while taking its
 *    denominator from the pinned version's frozen `sectionCount`. A learner who
 *    completed every section of v3 read 92% after one of those sections was
 *    later archived — while the completion gate, which derives both halves from
 *    the manifest, correctly considered them done.
 *  - The bulk-migration dry-run inherited the same mismatch, understating
 *    `currentPercentage` and making the `wouldRegress` guard under-trigger, so
 *    a migration that genuinely regresses a learner could pass the default-deny.
 *
 * The invariant that prevents this is already stated in
 * `countCompletionDenominator`: numerator and denominator must be
 * *self-consistent by construction* — derived from the same view of the
 * curriculum, so they cannot disagree. This module makes that the only way to
 * obtain a percentage.
 *
 * ## Design
 *
 * - **Batch-first.** The signature takes `(courseId, userId)` PAIRS, not a
 *   single learner. A per-learner `getProgress(userId, courseId)` would have
 *   invited an N+1 at every list surface (a 10-course dashboard, a 20-row admin
 *   roster). Singular is expressed as `batch([one])`, never the reverse.
 * - **Manifest ids, never the stored `sectionCount` column.** Both halves come
 *   from `getSectionIdsFromManifest`, matching the completion gate exactly.
 *   `CourseVersion.sectionCount` is written from the same manifest build, so it
 *   *should* agree — but nothing structurally enforces that, and a denominator
 *   that can silently drift from the completion gate is the bug class above.
 *   The column stays useful for display/telemetry; it is never a denominator.
 * - **Query budget is independent of learner count.** One progress fetch, one
 *   enrollment fetch, one live-section count per course, and one manifest load
 *   per DISTINCT pinned version — and manifests are immutable and cached
 *   (see `loadManifestForVersion`), so repeat versions are memory hits.
 */

export type DenominatorSource = 'manifest' | 'live';

export type LearnerPercentage = {
  /** 0-100, rounded. Clamped to 100 (see `raw` for the unclamped ratio). */
  percentage: number;
  /** Distinct completed sections counted against the denominator. */
  numerator: number;
  /** Total sections in this learner's curriculum. */
  denominator: number;
  /** Whether the denominator came from a pinned manifest or the live tree. */
  denominatorSource: DenominatorSource;
  /** True once CourseCompletion.courseCompletedAt is set. */
  isCompleted: boolean;
};

export type LearnerCourseKey = {
  userId: string;
  courseId: string;
  /**
   * The learner's `UserCourse.enrolledVersionId`, when the caller already has
   * it. Supplying it skips the engine's enrollment lookup — worth doing from
   * surfaces that just read those rows (the admin roster paginates
   * `userCourse` itself, so re-querying would be a redundant round trip).
   *
   * `undefined` means "look it up"; `null` means "known to be unpinned".
   */
  enrolledVersionId?: string | null;
};

/** Stable map key. Both ids are uuids, so a separator collision is impossible. */
export const percentageKey = (userId: string, courseId: string): string =>
  `${userId}::${courseId}`;

/**
 * Compute progress for many (userId, courseId) pairs at once.
 *
 * Pairs with no enrollment row still get an entry (0%, live denominator) so
 * callers can `.get(key)!` without a nullish branch.
 */
export async function computeLearnerPercentages(
  prisma: PrismaService,
  pairs: LearnerCourseKey[],
): Promise<Map<string, LearnerPercentage>> {
  const result = new Map<string, LearnerPercentage>();
  if (pairs.length === 0) return result;

  // Dedupe: a caller may legitimately pass the same pair twice (e.g. two
  // widgets on one page). One computation, both readers get it.
  const unique = new Map<string, LearnerCourseKey>();
  for (const p of pairs) unique.set(percentageKey(p.userId, p.courseId), p);
  const keys = Array.from(unique.values());

  // Courses are still deduped for the live-section query, which is genuinely
  // per-course (not per-pair) — every learner unpinned on the same course
  // shares one live curriculum.
  const courseIds = Array.from(new Set(keys.map((k) => k.courseId)));

  // Only look up pins the caller didn't already supply.
  const pinByKey = new Map<string, string | null>();
  const needsPinLookup: LearnerCourseKey[] = [];
  for (const k of keys) {
    if (k.enrolledVersionId === undefined) {
      needsPinLookup.push(k);
    } else {
      pinByKey.set(percentageKey(k.userId, k.courseId), k.enrolledVersionId);
    }
  }

  const [enrollments, completions] = await Promise.all([
    needsPinLookup.length
      ? prisma.userCourse.findMany({
          // OR of per-pair AND, not `userId IN (...) AND courseId IN (...)`.
          // The latter is a CROSS PRODUCT: asking for (A,C1) and (B,C2) would
          // also match (A,C2) and (B,C1), fetching enrollments nobody asked
          // for and then loading their manifests too. Requested pairs still
          // computed correctly either way (everything is keyed per-pair), but
          // the cost grew as users × courses instead of pairs.
          where: {
            OR: needsPinLookup.map((k) => ({
              userId: k.userId,
              courseId: k.courseId,
            })),
          },
          select: { userId: true, courseId: true, enrolledVersionId: true },
        })
      : Promise.resolve(
          [] as Array<{
            userId: string;
            courseId: string;
            enrolledVersionId: string | null;
          }>,
        ),
    prisma.courseCompletion.findMany({
      where: {
        OR: keys.map((k) => ({ userId: k.userId, courseId: k.courseId })),
        courseCompletedAt: { not: null },
      },
      select: { userId: true, courseId: true },
    }),
  ]);

  for (const e of enrollments) {
    pinByKey.set(percentageKey(e.userId, e.courseId), e.enrolledVersionId);
  }
  const completedKeys = new Set(
    completions.map((c) => percentageKey(c.userId, c.courseId)),
  );

  // Load each DISTINCT pinned manifest once. Immutable + cached, so a roster
  // spanning many learners on few versions costs a handful of loads at most.
  const versionIds = Array.from(
    new Set(
      Array.from(pinByKey.values()).filter((v): v is string => v !== null),
    ),
  );
  const sectionIdsByVersion = new Map<string, string[]>();
  await Promise.all(
    versionIds.map(async (versionId) => {
      const manifest = await loadManifestForVersion(prisma, versionId);
      if (manifest) {
        sectionIdsByVersion.set(versionId, getSectionIdsFromManifest(manifest));
      }
    }),
  );

  // Live section ids per course, for unpinned learners and for pinned learners
  // whose manifest could not be resolved. Filters mirror
  // countCompletionDenominator's live branch exactly so an unpinned learner's
  // percentage agrees with the completion gate.
  const needsLive = keys.some((k) => {
    const pin = pinByKey.get(percentageKey(k.userId, k.courseId)) ?? null;
    return pin === null || !sectionIdsByVersion.has(pin);
  });
  const liveSectionIdsByCourse = new Map<string, string[]>();
  if (needsLive) {
    // One round trip, not three.
    //
    // A nested `select: { chapter: { select: { module: ... } } }` reads as a
    // join but Prisma resolves relation selects as SEPARATE queries — this was
    // measurably issuing three (sections, then chapters, then modules). The
    // filters live in the WHERE either way, so grouping per course only needs
    // the courseId travelling back with each row, which a raw join gives us in
    // a single query. Filters mirror countCompletionDenominator's live branch.
    const liveSections = await prisma.$queryRaw<
      Array<{ id: string; courseId: string }>
    >`
      SELECT s."id", m."courseId"
        FROM "sections" s
        JOIN "chapters" c ON c."id" = s."chapterId"
        JOIN "modules"  m ON m."id" = c."moduleId"
       WHERE s."isActive" = true
         AND s."isArchived" = false
         AND c."isArchived" = false
         AND m."isArchived" = false
         AND m."courseId" IN (${Prisma.join(courseIds)})
    `;
    for (const s of liveSections) {
      const bucket = liveSectionIdsByCourse.get(s.courseId) ?? [];
      bucket.push(s.id);
      liveSectionIdsByCourse.set(s.courseId, bucket);
    }
  }

  // Resolve each learner's section id set, then count progress against exactly
  // those ids. Counting against the SAME id set the denominator came from is
  // the whole point — it is what makes numerator > denominator unrepresentable.
  const sectionIdsByKey = new Map<
    string,
    { ids: string[]; source: DenominatorSource }
  >();
  const allSectionIds = new Set<string>();
  for (const k of keys) {
    const key = percentageKey(k.userId, k.courseId);
    const pin = pinByKey.get(key) ?? null;
    const pinned = pin ? sectionIdsByVersion.get(pin) : undefined;
    const ids = pinned ?? liveSectionIdsByCourse.get(k.courseId) ?? [];
    sectionIdsByKey.set(key, {
      ids,
      source: pinned ? 'manifest' : 'live',
    });
    for (const id of ids) allSectionIds.add(id);
  }

  const progressRows = allSectionIds.size
    ? await prisma.userCourseProgress.findMany({
        where: {
          OR: keys.map((k) => ({ userId: k.userId, courseId: k.courseId })),
          sectionId: { in: Array.from(allSectionIds) },
        },
        select: { userId: true, courseId: true, sectionId: true },
        distinct: ['userId', 'courseId', 'sectionId'],
      })
    : [];

  const progressByKey = new Map<string, Set<string>>();
  for (const row of progressRows) {
    const key = percentageKey(row.userId, row.courseId);
    const set = progressByKey.get(key) ?? new Set<string>();
    set.add(row.sectionId);
    progressByKey.set(key, set);
  }

  for (const k of keys) {
    const key = percentageKey(k.userId, k.courseId);
    const { ids, source } = sectionIdsByKey.get(key)!;
    const done = progressByKey.get(key);
    const isCompleted = completedKeys.has(key);

    // Intersect rather than trusting a raw count: a progress row for a section
    // outside this learner's curriculum (archived after they pinned, or left
    // over from a reassignment) must not inflate the numerator.
    const numerator = done
      ? ids.reduce((n, id) => (done.has(id) ? n + 1 : n), 0)
      : 0;
    const denominator = ids.length;

    result.set(key, {
      percentage: toPercentage(numerator, denominator, isCompleted),
      numerator,
      denominator,
      denominatorSource: source,
      isCompleted,
    });
  }

  return result;
}

/** Convenience wrapper for the single-learner case. Never call this in a loop. */
export async function computeLearnerPercentage(
  prisma: PrismaService,
  userId: string,
  courseId: string,
): Promise<LearnerPercentage> {
  const map = await computeLearnerPercentages(prisma, [{ userId, courseId }]);
  return map.get(percentageKey(userId, courseId))!;
}

/**
 * Ratio → displayed percentage.
 *
 * Certified learners read 100 regardless of the raw ratio. Note this is no
 * longer load-bearing for correctly-scoped pinned learners: when numerator and
 * denominator come from the same manifest, a learner who finished their
 * curriculum computes 100 arithmetically. It still matters for the freeze case
 * the completion work introduced — a learner certified before the course gained
 * content — and for unpinned learners whose live denominator can still grow.
 *
 * `Math.min` is a defensive floor, not a fix: with a self-consistent id set the
 * numerator cannot exceed the denominator. If it ever does, that is a real bug
 * and the caller-side invariant check in A6 should surface it.
 */
function toPercentage(
  numerator: number,
  denominator: number,
  isCompleted: boolean,
): number {
  if (isCompleted) return 100;
  if (denominator <= 0) return 0;

  const raw = (numerator * 100) / denominator;

  // 100 must mean "finished", never "rounded up to finished". On a 201-section
  // curriculum 200/201 = 99.5%, and Math.round would report that as 100 — a
  // learner one section short reading as complete. The FE's `done >= sections`
  // gate gives that real teeth: it unlocks the next chapter. Floor anything
  // short of the full count to 99, and reserve an exact 100 for numerator ===
  // denominator. The same argument applies at the bottom: a learner with one
  // section done on a huge course should read 1, not 0.
  if (numerator >= denominator) return 100;
  // Math.round(99.5) is 100, so cap BEFORE rounding, not after.
  if (numerator > 0 && raw < 1) return 1;
  return Math.min(99, Math.round(raw));
}
