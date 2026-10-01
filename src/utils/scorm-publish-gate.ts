import { Prisma, SectionType } from '@prisma/client';

/**
 * Pure halves of CourseService.assertScormCoursePublishable, shared with
 * scripts/diagnose-scorm-import.ts so the diagnosis cannot drift from the gate
 * it explains (it previously re-implemented an older, count-based gate and
 * reported "activatable: YES" for courses the real gate rejected).
 */

/**
 * The sections the newest READY package produced: one per manifest lesson
 * (`lessons[].sectionId`), else the single synthetic `sectionId`. Empty when
 * there is no READY package or it has neither.
 */
export function scormPackageSectionIds(
  pkg: { sectionId: string | null; lessons: unknown } | null | undefined,
): Set<string> {
  const lessonSectionIds = Array.isArray(pkg?.lessons)
    ? (pkg!.lessons as Array<{ sectionId?: unknown }>)
        .map((l) => l?.sectionId)
        .filter((id): id is string => typeof id === 'string' && !!id)
    : [];
  return new Set(
    lessonSectionIds.length > 0
      ? lessonSectionIds
      : pkg?.sectionId
        ? [pkg.sectionId]
        : [],
  );
}

/**
 * Mirrors countCompletionDenominator's live branch with two differences:
 *  - `isActive` is omitted; callers split it out in memory so a deactivated
 *    section can be told apart from an archived one.
 *  - `type: SCORM` is added; the denominator has no type filter. That is safe
 *    only because an imported course's tree can contain nothing else: the
 *    importer creates SCORM sections only, refuses to convert a native course
 *    that already has modules, and assertImportedCourseTreeLocked blocks every
 *    native create/update/restore on an IMPORTED_SCORM course. If that lock
 *    ever loosens, a live non-SCORM section would be counted by the
 *    denominator but never seen here.
 * Any other filter this omits is a section the denominator counts and the
 * gate does not.
 */
export function scormGateCandidateSectionsWhere(
  courseId: string,
): Prisma.SectionWhereInput {
  return {
    type: SectionType.SCORM,
    isArchived: false,
    chapter: {
      isArchived: false,
      module: { courseId, isArchived: false },
    },
  };
}

export type ScormPublishGateResult = {
  missing: string[];
  /** Subset of `missing` that exists but is deactivated (fixable in place). */
  deactivated: string[];
  /** `missing` minus `deactivated`: archived or never built. */
  gone: number;
  /** Live SCORM sections the package did not produce. */
  extra: string[];
  /** Admin-facing reasons; empty ⇔ publishable. */
  problems: string[];
};

/**
 * Compares the live SCORM section SET against `expected` (non-empty — the
 * no-READY-package case is the caller's to report).
 *  - missing ⇒ the denominator has fewer sections than the package reports
 *    progress for: deactivated (reactivate) or archived / never built
 *    (re-import).
 *  - extra ⇒ a leftover from a previous package is still live, and the
 *    denominator would demand progress on a section no learner can reach.
 */
export function evaluateScormPublishGate(
  expected: Set<string>,
  candidates: Array<{ id: string; isActive: boolean }>,
): ScormPublishGateResult {
  const liveIds = new Set(
    candidates.filter((s) => s.isActive).map((s) => s.id),
  );
  const deactivatedIds = new Set(
    candidates.filter((s) => !s.isActive).map((s) => s.id),
  );

  const missing = [...expected].filter((id) => !liveIds.has(id));
  const extra = [...liveIds].filter((id) => !expected.has(id));
  const deactivated = missing.filter((id) => deactivatedIds.has(id));
  const gone = missing.length - deactivated.length;

  const problems: string[] = [];
  if (gone > 0) {
    problems.push(
      `${gone} of the ${expected.size} section(s) its READY package produced are archived or missing — the import is incomplete; re-import the package`,
    );
  }
  if (deactivated.length > 0) {
    problems.push(
      `${deactivated.length} section(s) of this package are deactivated — reactivate them`,
    );
  }
  if (extra.length > 0) {
    problems.push(
      `${extra.length} leftover SCORM section(s) not from this package are live — archive them`,
    );
  }
  return { missing, deactivated, gone, extra, problems };
}
