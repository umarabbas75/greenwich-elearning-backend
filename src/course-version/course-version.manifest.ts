import { Prisma, PrismaClient, SectionType } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient | PrismaClient;

export type CourseVersionManifestChapter = {
  sourceId: string;
  order: number;
  sectionIds: string[];
  quizIds: string[];
};

export type CourseVersionManifestModule = {
  sourceId: string;
  order: number;
  chapters: CourseVersionManifestChapter[];
};

export type CourseVersionManifest = {
  modules: CourseVersionManifestModule[];
};

export type BuildManifestOptions = {
  excludeSourceSectionIds?: string[];
};

export type BuildManifestResult = {
  manifest: CourseVersionManifest;
  sectionCount: number;
  moduleCount: number;
  chapterCount: number;
  quizCount: number;
};

export type PinnedCurriculumSection = {
  id: string;
  title: string;
  description: string;
  chapterId: string;
  moduleId: string | null;
  createdAt: Date;
  updatedAt: Date;
  shortDescription: string | null;
  type: SectionType;
  orderIndex: number | null;
  itemLabel: string | null;
  categoryLabel: string | null;
  categories: string[];
  maxPerCategory: number;
  isActive: boolean;
  questionText: string | null;
  imageUrl: string | null;
  allowMultipleSelection: boolean;
  items: unknown;
  options: unknown;
  config: unknown;
};

export type PinnedCurriculumQuiz = {
  id: string;
  question: string;
  options: string[];
  answer: string;
};

export type PinnedCurriculumChapter = {
  sourceChapterId: string;
  title: string;
  description: string;
  pdfFile: string;
  orderIndex: number;
  sections: PinnedCurriculumSection[];
  quizzes: PinnedCurriculumQuiz[];
};

export type PinnedCurriculumModule = {
  sourceModuleId: string;
  title: string;
  description: string;
  orderIndex: number;
  chapters: PinnedCurriculumChapter[];
};

export type PinnedCurriculumTree = {
  versionId: string;
  versionNumber: number;
  manifest: CourseVersionManifest;
  modules: PinnedCurriculumModule[];
};

/** Lean tree for admin/learner reports — titles + structure only, no section bodies. */
export type ReportCurriculumSection = {
  id: string;
  title: string;
  orderIndex: number | null;
  type: SectionType;
};

export type ReportCurriculumChapter = {
  sourceChapterId: string;
  title: string;
  orderIndex: number;
  sections: ReportCurriculumSection[];
  quizzesTotal: number;
};

export type ReportCurriculumModule = {
  sourceModuleId: string;
  title: string;
  orderIndex: number;
  chapters: ReportCurriculumChapter[];
};

export type ReportCurriculumTree = {
  versionId: string;
  versionNumber: number;
  modules: ReportCurriculumModule[];
};

export function parseManifest(raw: unknown): CourseVersionManifest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as { modules?: unknown };
  if (!Array.isArray(obj.modules)) {
    return null;
  }
  return obj as CourseVersionManifest;
}

export function countSectionsInManifest(
  manifest: CourseVersionManifest,
): number {
  return manifest.modules.reduce(
    (sum, mod) =>
      sum + mod.chapters.reduce((chSum, ch) => chSum + ch.sectionIds.length, 0),
    0,
  );
}

export function getSectionIdsFromManifest(
  manifest: CourseVersionManifest,
): string[] {
  return manifest.modules.flatMap((mod) =>
    mod.chapters.flatMap((ch) => ch.sectionIds),
  );
}

export function getChapterIdsFromManifest(
  manifest: CourseVersionManifest,
): string[] {
  return manifest.modules.flatMap((mod) =>
    mod.chapters.map((ch) => ch.sourceId),
  );
}

export function getQuizIdsFromManifest(
  manifest: CourseVersionManifest,
): string[] {
  return manifest.modules.flatMap((mod) =>
    mod.chapters.flatMap((ch) => ch.quizIds),
  );
}

/**
 * Chapters in this manifest that carry at least one quiz, by source id.
 *
 * This is the frozen "which chapters must have a passing quiz" set used by the
 * course-completion gate. Deriving it from the manifest (rather than the live
 * tree) is what keeps a quiz added AFTER a learner pinned from retroactively
 * un-completing them — same reasoning as the section denominator.
 *
 * A `Quiz` row is a single question, so a chapter's quiz is the SET of its
 * quizIds; "has a quiz" is `quizIds.length > 0`, never a count of questions.
 * Courses with no quizzes anywhere yield `[]`, which callers treat as "no quiz
 * requirement" — keeping zero-quiz courses on exactly today's behaviour.
 */
export function getQuizBearingChapterIdsFromManifest(
  manifest: CourseVersionManifest,
): string[] {
  return manifest.modules.flatMap((mod) =>
    mod.chapters.filter((ch) => ch.quizIds.length > 0).map((ch) => ch.sourceId),
  );
}

export function computeStructuralFingerprint(
  manifest: CourseVersionManifest,
): string {
  // Nested + order-preserving. The previous implementation hashed four FLAT
  // sorted id sets, which was blind to RELOCATION: moving a quiz (or section)
  // from one chapter to another leaves every flat set unchanged, so the dedup
  // skipped the publish and `latest` never reflected the move (e.g. assignQuiz's
  // `connect` reassigns a quiz's chapterId). Encoding the tree — which chapter
  // owns which sections/quizzes, in order — makes a relocation change the shape.
  // This requires a TOTALLY deterministic order from buildManifestFromLiveTree:
  // modules/chapters by (createdAt, id), sections by (orderIndex, createdAt, id),
  // quizzes by (orderIndex, createdAt, id) in the live tree. Section order IS
  // structural; quiz order within a chapter is NOT — reorder-only must not bump
  // the version, so quiz ids are sorted for fingerprint comparison only.
  const shape = manifest.modules.map((mod) => ({
    m: mod.sourceId,
    c: mod.chapters.map((ch) => ({
      c: ch.sourceId,
      s: ch.sectionIds,
      q: [...ch.quizIds].sort(),
    })),
  }));
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}

export function isIdReferencedInManifest(
  manifest: CourseVersionManifest,
  table: 'section' | 'chapter' | 'module' | 'quiz',
  sourceId: string,
): boolean {
  switch (table) {
    case 'module':
      return manifest.modules.some((m) => m.sourceId === sourceId);
    case 'chapter':
      return manifest.modules.some((m) =>
        m.chapters.some((ch) => ch.sourceId === sourceId),
      );
    case 'section':
      return manifest.modules.some((m) =>
        m.chapters.some((ch) => ch.sectionIds.includes(sourceId)),
      );
    case 'quiz':
      return manifest.modules.some((m) =>
        m.chapters.some((ch) => ch.quizIds.includes(sourceId)),
      );
  }
}

// ──────────────────────────────────────────────────────────────────────
// PR 3 — Titled version diff
//
// `diffManifests` (below) returns count-only summaries; it's what the
// pinned-vs-latest "you're behind" banner uses. The FE spec asks for a
// richer, titled diff for admin drill-in: added/removed/moved/renamed
// entries with source ids, entity types, and human-readable paths.
//
// Design notes:
// - Manifests store ONLY sourceIds (§7 of course-versioning-plan.md).
//   Titles come from the live tables. That means renames can only be
//   detected if callers preserve historical titles — which we do NOT.
//   `renamed[]` will always be empty in the current schema. The plumbing
//   stays because a future schema change (title snapshot in manifest)
//   would light it up with zero call-site changes.
// - Move detection is STRUCTURAL, not string-based. Two entries "move"
//   iff their parent-sourceId chain differs. A pure title change on any
//   ancestor does NOT cascade into descendant `moved` entries — that
//   was the FE-review-flagged bug from v1 of the plan.
// - `path` in every emitted entry is title-derived for admin
//   readability. It is display-only; the diff logic never touches it.
// ──────────────────────────────────────────────────────────────────────

export type DiffEntityType = 'module' | 'chapter' | 'section' | 'quiz';

export type DiffAddedRemovedEntry = {
  id: string;
  entityType: DiffEntityType;
  title: string;
  path: string;
};

export type DiffMovedEntry = {
  id: string;
  entityType: DiffEntityType;
  title: string;
  fromPath: string;
  toPath: string;
};

export type DiffRenamedEntry = {
  id: string;
  entityType: DiffEntityType;
  fromTitle: string;
  toTitle: string;
  path: string;
};

export type DiffTitledResult = {
  added: DiffAddedRemovedEntry[];
  removed: DiffAddedRemovedEntry[];
  moved: DiffMovedEntry[];
  renamed: DiffRenamedEntry[];
};

type IndexedEntry = {
  entityType: DiffEntityType;
  title: string;
  path: string;
  parentChain: string[];
};

/**
 * Structural + title diff between two manifest snapshots. Pure function —
 * all DB reads happen in the service layer, which passes their result in
 * via the `titles` Map.
 *
 * `titles` is a `sourceId → display string` lookup. For sections/modules/
 * chapters the display string is the row's `title`; for quizzes it's the
 * row's `question` (Quiz has no title column). Missing entries fall back
 * to `'(untitled)'` so the diff never crashes on a stale reference.
 */
export function diffManifestsTitled(
  from: CourseVersionManifest,
  to: CourseVersionManifest,
  titles: Map<string, string>,
): DiffTitledResult {
  const fromIndex = indexManifestBySourceId(from, titles);
  const toIndex = indexManifestBySourceId(to, titles);

  const added: DiffAddedRemovedEntry[] = [];
  const removed: DiffAddedRemovedEntry[] = [];
  const moved: DiffMovedEntry[] = [];
  const renamed: DiffRenamedEntry[] = [];

  for (const [sid, toEntry] of toIndex) {
    const fromEntry = fromIndex.get(sid);
    if (!fromEntry) {
      added.push({
        id: sid,
        entityType: toEntry.entityType,
        title: toEntry.title,
        path: toEntry.path,
      });
      continue;
    }

    // Structural comparison — same parent chain means same location,
    // regardless of any ancestor's title. This is the fix for the FE-
    // reviewer-flagged v1 bug where renaming a chapter title cascaded
    // into hundreds of spurious "moved" entries for its descendants
    // (their computed path string had changed).
    const sameChain = arraysEqual(fromEntry.parentChain, toEntry.parentChain);

    if (!sameChain) {
      moved.push({
        id: sid,
        entityType: toEntry.entityType,
        title: toEntry.title,
        fromPath: fromEntry.path,
        toPath: toEntry.path,
      });
    } else if (fromEntry.title !== toEntry.title) {
      // See design note: with current schema titles are always LIVE, so
      // fromEntry.title === toEntry.title identically. This branch is
      // reachable only if the caller supplies a per-version title Map
      // (future work).
      renamed.push({
        id: sid,
        entityType: toEntry.entityType,
        fromTitle: fromEntry.title,
        toTitle: toEntry.title,
        path: toEntry.path,
      });
    }
    // Same chain + same title = not in the diff. This is the base case;
    // the vast majority of entries hit it on every diff request.
  }
  for (const [sid, fromEntry] of fromIndex) {
    if (!toIndex.has(sid)) {
      removed.push({
        id: sid,
        entityType: fromEntry.entityType,
        title: fromEntry.title,
        path: fromEntry.path,
      });
    }
  }

  return { added, removed, moved, renamed };
}

/**
 * Flatten a manifest to `Map<sourceId, IndexedEntry>` with parent-sourceId
 * chain populated. This is the piece that makes structural move-detection
 * work: two entries have "moved" iff their parent chains differ.
 *
 * NOTE: `titles` overrides source-of-truth lookups — pass the same map
 * to both `from` and `to` and titles will resolve consistently. When the
 * source table has no row (archived + hard-deleted after the manifest
 * was published), the fallback string is `(untitled)` so the diff still
 * renders.
 */
function indexManifestBySourceId(
  m: CourseVersionManifest,
  titles: Map<string, string>,
): Map<string, IndexedEntry> {
  const out = new Map<string, IndexedEntry>();
  const t = (sid: string) => titles.get(sid) ?? '(untitled)';

  for (const mod of m.modules) {
    out.set(mod.sourceId, {
      entityType: 'module',
      title: t(mod.sourceId),
      path: '',
      parentChain: [],
    });
    const modPath = t(mod.sourceId);
    for (const ch of mod.chapters) {
      out.set(ch.sourceId, {
        entityType: 'chapter',
        title: t(ch.sourceId),
        path: modPath, // display: parent title
        parentChain: [mod.sourceId], // detection: parent sourceId
      });
      const chPath = `${modPath} › ${t(ch.sourceId)}`;
      for (const sid of ch.sectionIds) {
        out.set(sid, {
          entityType: 'section',
          title: t(sid),
          path: chPath,
          parentChain: [mod.sourceId, ch.sourceId],
        });
      }
      for (const qid of ch.quizIds) {
        out.set(qid, {
          entityType: 'quiz',
          title: t(qid),
          path: chPath,
          parentChain: [mod.sourceId, ch.sourceId],
        });
      }
    }
  }
  return out;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function diffManifests(
  pinned: CourseVersionManifest,
  latest: CourseVersionManifest,
): { newSections: number; newChapters: number } {
  const pinnedSectionIds = new Set(getSectionIdsFromManifest(pinned));
  const pinnedChapterIds = new Set(getChapterIdsFromManifest(pinned));
  const latestSectionIds = getSectionIdsFromManifest(latest);
  const newSectionIds = latestSectionIds.filter(
    (id) => !pinnedSectionIds.has(id),
  );
  const newChapterSourceIds = new Set<string>();
  for (const mod of latest.modules) {
    for (const ch of mod.chapters) {
      if (
        ch.sectionIds.some((sid) => newSectionIds.includes(sid)) &&
        !pinnedChapterIds.has(ch.sourceId)
      ) {
        newChapterSourceIds.add(ch.sourceId);
      }
    }
  }
  return {
    newSections: newSectionIds.length,
    newChapters: newChapterSourceIds.size,
  };
}

function sortSectionsByOrderIndex<T extends { orderIndex: number | null }>(
  sections: T[],
): T[] {
  return [...sections].sort((a, b) => {
    if (a.orderIndex === null && b.orderIndex === null) return 0;
    if (a.orderIndex === null) return 1;
    if (b.orderIndex === null) return -1;
    return a.orderIndex - b.orderIndex;
  });
}

/** Walk the live tree and build a structural manifest (no content duplication). */
export async function buildManifestFromLiveTree(
  prisma: Db,
  courseId: string,
  options: BuildManifestOptions = {},
): Promise<BuildManifestResult> {
  const excluded = new Set(options.excludeSourceSectionIds ?? []);
  // `id: 'asc'` is a REQUIRED final tiebreaker on every level: the structural
  // fingerprint (computeStructuralFingerprint) now hashes this array order, and
  // the pinned manifest's chapter/section order is consumed by
  // getOrderedChapterIdsForVersion + the progression gate. createdAt/orderIndex
  // alone are not unique (bulk import, seed, same-request creates all tie), and
  // Postgres does not guarantee a stable order for ties — without the id
  // tiebreaker the fingerprint would false-negative (spurious versions) and the
  // pinned order could shift between publishes.
  const modules = await prisma.module.findMany({
    where: { courseId, isArchived: false },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      chapters: {
        where: { isArchived: false },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          sections: {
            where: { isArchived: false, isActive: true },
            orderBy: [
              { orderIndex: 'asc' },
              { createdAt: 'asc' },
              { id: 'asc' },
            ],
            select: { id: true },
          },
          quizzes: {
            where: { isArchived: false },
            orderBy: [
              { orderIndex: 'asc' },
              { createdAt: 'asc' },
              { id: 'asc' },
            ],
            select: { id: true },
          },
        },
      },
    },
  });

  const manifest: CourseVersionManifest = { modules: [] };
  let chapterCount = 0;
  let quizCount = 0;

  for (let modIdx = 0; modIdx < modules.length; modIdx++) {
    const mod = modules[modIdx];
    const chapters: CourseVersionManifestChapter[] = [];

    for (let chIdx = 0; chIdx < mod.chapters.length; chIdx++) {
      const ch = mod.chapters[chIdx];
      chapterCount++;
      const sectionIds = ch.sections
        .map((s) => s.id)
        .filter((id) => !excluded.has(id));
      const quizIds = ch.quizzes.map((q) => q.id);
      quizCount += quizIds.length;

      chapters.push({
        sourceId: ch.id,
        order: chIdx,
        sectionIds,
        quizIds,
      });
    }

    manifest.modules.push({
      sourceId: mod.id,
      order: modIdx,
      chapters,
    });
  }

  const sectionCount = countSectionsInManifest(manifest);
  return {
    manifest,
    sectionCount,
    moduleCount: modules.length,
    chapterCount,
    quizCount,
  };
}

/** Reconstruct manifest from legacy snapshot rows (one-time backfill; pre-migration-2 only). */
export async function buildManifestFromLegacySnapshot(
  prisma: Db,
  versionId: string,
): Promise<BuildManifestResult | null> {
  // Legacy child tables are removed from the Prisma schema (and dropped by
  // migration 2), so the typed delegates no longer exist. During the backfill
  // window the tables still exist in the database, so read them via raw SQL.
  // After migration 2 these queries throw (missing relation); callers guard
  // against that and degrade gracefully.
  const moduleRows = await prisma.$queryRaw<
    Array<{ id: string; sourceModuleId: string | null; orderIndex: number }>
  >(Prisma.sql`
    SELECT "id", "sourceModuleId", "orderIndex"
    FROM "course_version_modules"
    WHERE "versionId" = ${versionId}
    ORDER BY "orderIndex" ASC
  `);

  if (moduleRows.length === 0) {
    return null;
  }

  const chapterRows = await prisma.$queryRaw<
    Array<{
      id: string;
      versionModuleId: string;
      sourceChapterId: string | null;
      orderIndex: number;
    }>
  >(Prisma.sql`
    SELECT "id", "versionModuleId", "sourceChapterId", "orderIndex"
    FROM "course_version_chapters"
    WHERE "versionId" = ${versionId}
    ORDER BY "orderIndex" ASC
  `);

  const sectionRows = await prisma.$queryRaw<
    Array<{ versionChapterId: string; sourceSectionId: string | null }>
  >(Prisma.sql`
    SELECT "versionChapterId", "sourceSectionId"
    FROM "course_version_sections"
    WHERE "versionId" = ${versionId}
      AND "isActive" = true
      AND "sourceSectionId" IS NOT NULL
    ORDER BY "orderIndex" ASC, "createdAt" ASC
  `);

  const quizRows = await prisma.$queryRaw<
    Array<{ versionChapterId: string; sourceQuizId: string | null }>
  >(Prisma.sql`
    SELECT "versionChapterId", "sourceQuizId"
    FROM "course_version_quizzes"
    WHERE "versionId" = ${versionId}
    ORDER BY "createdAt" ASC
  `);

  const sectionsByChapter = new Map<string, string[]>();
  for (const s of sectionRows) {
    if (!s.sourceSectionId) continue;
    const list = sectionsByChapter.get(s.versionChapterId) ?? [];
    list.push(s.sourceSectionId);
    sectionsByChapter.set(s.versionChapterId, list);
  }

  const quizzesByChapter = new Map<string, string[]>();
  for (const q of quizRows) {
    if (!q.sourceQuizId) continue;
    const list = quizzesByChapter.get(q.versionChapterId) ?? [];
    list.push(q.sourceQuizId);
    quizzesByChapter.set(q.versionChapterId, list);
  }

  const chaptersByModule = new Map<string, typeof chapterRows>();
  for (const ch of chapterRows) {
    const list = chaptersByModule.get(ch.versionModuleId) ?? [];
    list.push(ch);
    chaptersByModule.set(ch.versionModuleId, list);
  }

  const manifest: CourseVersionManifest = {
    modules: moduleRows.map((mod) => ({
      sourceId: mod.sourceModuleId ?? mod.id,
      order: mod.orderIndex,
      chapters: (chaptersByModule.get(mod.id) ?? []).map((ch) => ({
        sourceId: ch.sourceChapterId ?? ch.id,
        order: ch.orderIndex,
        sectionIds: sectionsByChapter.get(ch.id) ?? [],
        quizIds: quizzesByChapter.get(ch.id) ?? [],
      })),
    })),
  };

  const sectionCount = countSectionsInManifest(manifest);
  const chapterCount = manifest.modules.reduce(
    (sum, m) => sum + m.chapters.length,
    0,
  );
  const quizCount = getQuizIdsFromManifest(manifest).length;

  return {
    manifest,
    sectionCount,
    moduleCount: manifest.modules.length,
    chapterCount,
    quizCount,
  };
}

export type PublishManifestVersionOptions = {
  versionNumber: number;
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  isLatest?: boolean;
  publishedAt?: Date | null;
  publishedByAdminId?: string | null;
  changeNotes?: string | null;
  excludeSourceSectionIds?: string[];
  // Reuse an already-built manifest instead of rebuilding the live tree. The
  // caller must have built it from the SAME live state being published (e.g.
  // inside the same transaction), so the fingerprint and the stored row match.
  prebuiltManifest?: BuildManifestResult;
};

export type PublishManifestVersionResult = {
  versionId: string;
  versionNumber: number;
  sectionCount: number;
  moduleCount: number;
  chapterCount: number;
  quizCount: number;
};

/** Create a CourseVersion row with manifest only (no heavy snapshot tables). */
export async function publishManifestVersion(
  prisma: Db,
  courseId: string,
  options: PublishManifestVersionOptions,
): Promise<PublishManifestVersionResult> {
  const built =
    options.prebuiltManifest ??
    (await buildManifestFromLiveTree(prisma, courseId, {
      excludeSourceSectionIds: options.excludeSourceSectionIds,
    }));

  const versionId = randomUUID();
  const now = new Date();

  await prisma.courseVersion.create({
    data: {
      id: versionId,
      courseId,
      versionNumber: options.versionNumber,
      status: options.status ?? 'PUBLISHED',
      isLatest: options.isLatest ?? false,
      publishedAt:
        options.publishedAt ?? (options.status === 'PUBLISHED' ? now : null),
      publishedByAdminId: options.publishedByAdminId ?? null,
      changeNotes: options.changeNotes ?? null,
      manifest: built.manifest as unknown as Prisma.InputJsonValue,
      sectionCount: built.sectionCount,
      updatedAt: now,
    },
  });

  return {
    versionId,
    versionNumber: options.versionNumber,
    sectionCount: built.sectionCount,
    moduleCount: built.moduleCount,
    chapterCount: built.chapterCount,
    quizCount: built.quizCount,
  };
}

/** Load manifest + batch-fetch live content for learner reads. */
export async function loadPinnedCurriculum(
  prisma: Db,
  versionId: string,
): Promise<PinnedCurriculumTree | null> {
  // Fetch only the lightweight meta here; get the (large) manifest from the
  // shared cache so this path reuses the read resolveEnrolledVersionId already
  // warmed instead of pulling the manifest column a second time.
  const [version, manifest] = await Promise.all([
    prisma.courseVersion.findUnique({
      where: { id: versionId },
      select: { id: true, versionNumber: true },
    }),
    loadManifestForVersion(prisma, versionId),
  ]);
  if (!version || !manifest) {
    return null;
  }

  const allSectionIds = getSectionIdsFromManifest(manifest);
  const allQuizIds = getQuizIdsFromManifest(manifest);
  const allModuleIds = manifest.modules.map((m) => m.sourceId);
  const allChapterIds = getChapterIdsFromManifest(manifest);

  const [liveSections, liveQuizzes, liveModules, liveChapters] =
    await Promise.all([
      allSectionIds.length > 0
        ? prisma.section.findMany({ where: { id: { in: allSectionIds } } })
        : Promise.resolve([]),
      allQuizIds.length > 0
        ? prisma.quiz.findMany({ where: { id: { in: allQuizIds } } })
        : Promise.resolve([]),
      allModuleIds.length > 0
        ? prisma.module.findMany({
            where: { id: { in: allModuleIds } },
            select: { id: true, title: true, description: true },
          })
        : Promise.resolve([]),
      allChapterIds.length > 0
        ? prisma.chapter.findMany({
            where: { id: { in: allChapterIds } },
            select: {
              id: true,
              title: true,
              description: true,
              pdfFile: true,
            },
          })
        : Promise.resolve([]),
    ]);

  const sectionById = new Map(liveSections.map((s) => [s.id, s]));
  const quizById = new Map(liveQuizzes.map((q) => [q.id, q]));
  const moduleById = new Map(liveModules.map((m) => [m.id, m]));
  const chapterById = new Map(liveChapters.map((c) => [c.id, c]));

  const modules: PinnedCurriculumModule[] = manifest.modules.map((mod) => {
    const liveMod = moduleById.get(mod.sourceId);
    const chapters: PinnedCurriculumChapter[] = mod.chapters.map((ch) => {
      const liveCh = chapterById.get(ch.sourceId);
      const sections: PinnedCurriculumSection[] = ch.sectionIds
        .map((sid) => sectionById.get(sid))
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          chapterId: ch.sourceId,
          moduleId: mod.sourceId,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          shortDescription: s.shortDescription,
          type: s.type,
          orderIndex: s.orderIndex,
          itemLabel: s.itemLabel,
          categoryLabel: s.categoryLabel,
          categories: s.categories,
          maxPerCategory: s.maxPerCategory,
          isActive: s.isActive,
          questionText: s.questionText,
          imageUrl: s.imageUrl,
          allowMultipleSelection: s.allowMultipleSelection,
          items: s.items,
          options: s.options,
          config: s.config,
        }));

      const quizzes: PinnedCurriculumQuiz[] = ch.quizIds
        .map((qid) => quizById.get(qid))
        .filter((q): q is NonNullable<typeof q> => Boolean(q))
        .sort((a, b) =>
          compareQuizDisplayOrder(
            {
              orderIndex: a.orderIndex,
              createdAt: a.createdAt,
              id: a.id,
            },
            {
              orderIndex: b.orderIndex,
              createdAt: b.createdAt,
              id: b.id,
            },
          ),
        )
        .map((q) => ({
          id: q.id,
          question: q.question,
          options: q.options,
          answer: q.answer,
        }));

      return {
        sourceChapterId: ch.sourceId,
        title: liveCh?.title ?? '',
        description: liveCh?.description ?? '',
        pdfFile: liveCh?.pdfFile ?? '',
        orderIndex: ch.order,
        sections: sortSectionsByOrderIndex(sections),
        quizzes,
      };
    });

    return {
      sourceModuleId: mod.sourceId,
      title: liveMod?.title ?? '',
      description: liveMod?.description ?? '',
      orderIndex: mod.order,
      chapters,
    };
  });

  return {
    versionId: version.id,
    versionNumber: version.versionNumber,
    manifest,
    modules,
  };
}

/**
 * Bounded in-process LRU of parsed, PUBLISHED manifests keyed by versionId.
 *
 * Safe with zero invalidation: a published version's manifest is immutable —
 * publishing always creates a brand-new versionId (see publishManifestVersion),
 * and existing rows only ever flip `isLatest`/`status`, never `manifest`. So a
 * versionId → manifest mapping can never go stale.
 *
 * On serverless (Vercel) this only helps within a warm instance, but manifest
 * JSON can be large (every section/quiz id in the course) and a learner paging
 * through a course re-reads the same versionId repeatedly, so skipping the fetch
 * + parse is a cheap, correct win. Bounded to cap memory; simple LRU eviction.
 */
// Bounded by entry count. Each entry holds every section/quiz id in a course, so
// keep the cap modest to bound memory (a handful of large courses, not 512).
//
// Sized for 64 when the only readers were learner-facing paths touching one or
// two versions per request. The batched percentage engine
// (computeLearnerPercentages) and the admin roster span every DISTINCT version
// on a page — a course with a long publish history plus learners spread across
// it blew past 64 and thrashed. 256 still bounds memory to a few large courses'
// worth of ids while keeping those pages on cache hits.
const MANIFEST_CACHE_MAX = 256;
const manifestCache = new Map<string, CourseVersionManifest>();

function getCachedManifest(
  versionId: string,
): CourseVersionManifest | undefined {
  const cached = manifestCache.get(versionId);
  if (cached) {
    // Refresh recency: move to newest position.
    manifestCache.delete(versionId);
    manifestCache.set(versionId, cached);
  }
  return cached;
}

function setCachedManifest(
  versionId: string,
  manifest: CourseVersionManifest,
): void {
  manifestCache.delete(versionId);
  manifestCache.set(versionId, manifest);
  if (manifestCache.size > MANIFEST_CACHE_MAX) {
    const oldest = manifestCache.keys().next().value;
    if (oldest !== undefined) manifestCache.delete(oldest);
  }
}

/** Test hook: clears the module-level manifest cache to avoid cross-test bleed. */
export function resetManifestCache(): void {
  manifestCache.clear();
}

/**
 * Load and parse a version's (immutable) manifest, with the same legacy-snapshot
 * fallback loadPinnedCurriculum uses. Returns null when the version row or its
 * manifest can't be resolved. Parsed results are cached (see manifestCache).
 */
export async function loadManifestForVersion(
  prisma: Db,
  versionId: string,
): Promise<CourseVersionManifest | null> {
  if (!versionId) {
    return null;
  }
  const cached = getCachedManifest(versionId);
  if (cached) {
    return cached;
  }
  const version = await prisma.courseVersion.findUnique({
    where: { id: versionId },
    select: { manifest: true },
  });
  if (!version) {
    return null;
  }
  let manifest = parseManifest(version.manifest);
  if (!manifest) {
    try {
      manifest =
        (await buildManifestFromLegacySnapshot(prisma, versionId))?.manifest ??
        null;
    } catch {
      manifest = null;
    }
  }
  if (manifest) {
    setCachedManifest(versionId, manifest);
  }
  return manifest;
}

function findManifestChapter(
  manifest: CourseVersionManifest,
  sourceChapterId: string,
): CourseVersionManifestChapter | null {
  for (const mod of manifest.modules) {
    const ch = mod.chapters.find((c) => c.sourceId === sourceChapterId);
    if (ch) return ch;
  }
  return null;
}

/** Compare quizzes within a chapter by live orderIndex (nulls last). */
export function compareQuizDisplayOrder(
  a: { orderIndex: number | null; createdAt: Date; id: string },
  b: { orderIndex: number | null; createdAt: Date; id: string },
): number {
  if (a.orderIndex === null && b.orderIndex === null) {
    return (
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
    );
  }
  if (a.orderIndex === null) return 1;
  if (b.orderIndex === null) return -1;
  if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
  return (
    a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
  );
}

/**
 * Order manifest (or any) quiz ids by live DB orderIndex. Drops ids with no row.
 * Pinned learners: membership from manifest, sequence from live order (no version bump on reorder).
 */
export async function sortQuizIdsByLiveOrder(
  prisma: Db,
  quizIds: string[],
): Promise<string[]> {
  if (quizIds.length === 0) return [];
  const rows = await prisma.quiz.findMany({
    where: { id: { in: quizIds } },
    select: { id: true, orderIndex: true, createdAt: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = quizIds
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
  ordered.sort(compareQuizDisplayOrder);
  return ordered.map((r) => r.id);
}

/**
 * Chapter-scoped quiz loader — the learner quiz-fetch hot path. Instead of
 * hydrating the WHOLE course tree (every section body + all quizzes) the way
 * loadPinnedCurriculum does, it reads the manifest, locates the one target
 * chapter, and loads ONLY that chapter's quizzes, in manifest order. Returns []
 * (never null) when the version/manifest is unresolved or the chapter isn't part
 * of this version — the caller already maps "no version" to a null/live result
 * before calling this.
 */
export async function loadPinnedChapterQuizzes(
  prisma: Db,
  versionId: string,
  sourceChapterId: string,
  includeAnswers: boolean,
): Promise<Array<Omit<PinnedCurriculumQuiz, 'answer'> & { answer?: string }>> {
  const manifest = await loadManifestForVersion(prisma, versionId);
  if (!manifest) return [];

  const chapter = findManifestChapter(manifest, sourceChapterId);
  if (!chapter || chapter.quizIds.length === 0) return [];

  const orderedIds = await sortQuizIdsByLiveOrder(prisma, chapter.quizIds);
  if (orderedIds.length === 0) return [];

  const rows = await prisma.quiz.findMany({
    where: { id: { in: orderedIds } },
    select: { id: true, question: true, options: true, answer: true },
  });
  const byId = new Map(rows.map((q) => [q.id, q]));

  const ordered: PinnedCurriculumQuiz[] = orderedIds
    .map((qid) => byId.get(qid))
    .filter((q): q is NonNullable<typeof q> => Boolean(q))
    .map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options,
      answer: q.answer,
    }));

  return mapPinnedQuizzesForLearner(ordered, includeAnswers);
}

/**
 * Report-only hydrate: section titles/types + quiz counts.
 * Avoids pulling full section HTML/config payloads (~10x less DB transfer).
 */
export async function loadPinnedCurriculumForReport(
  prisma: Db,
  versionId: string,
): Promise<ReportCurriculumTree | null> {
  // Lightweight meta here; large manifest from the shared cache (see
  // loadPinnedCurriculum for the rationale).
  const [version, manifest] = await Promise.all([
    prisma.courseVersion.findUnique({
      where: { id: versionId },
      select: { id: true, versionNumber: true },
    }),
    loadManifestForVersion(prisma, versionId),
  ]);
  if (!version || !manifest) {
    return null;
  }

  const allSectionIds = getSectionIdsFromManifest(manifest);
  const allQuizIds = getQuizIdsFromManifest(manifest);
  const allModuleIds = manifest.modules.map((m) => m.sourceId);
  const allChapterIds = getChapterIdsFromManifest(manifest);

  const [liveSections, liveQuizzes, liveModules, liveChapters] =
    await Promise.all([
      allSectionIds.length > 0
        ? prisma.section.findMany({
            where: { id: { in: allSectionIds } },
            select: {
              id: true,
              title: true,
              orderIndex: true,
              type: true,
            },
          })
        : Promise.resolve([]),
      allQuizIds.length > 0
        ? prisma.quiz.findMany({
            where: { id: { in: allQuizIds } },
            select: { id: true },
          })
        : Promise.resolve([]),
      allModuleIds.length > 0
        ? prisma.module.findMany({
            where: { id: { in: allModuleIds } },
            select: { id: true, title: true },
          })
        : Promise.resolve([]),
      allChapterIds.length > 0
        ? prisma.chapter.findMany({
            where: { id: { in: allChapterIds } },
            select: { id: true, title: true },
          })
        : Promise.resolve([]),
    ]);

  const sectionById = new Map(liveSections.map((s) => [s.id, s]));
  const quizIdSet = new Set(liveQuizzes.map((q) => q.id));
  const moduleById = new Map(liveModules.map((m) => [m.id, m]));
  const chapterById = new Map(liveChapters.map((c) => [c.id, c]));

  const modules: ReportCurriculumModule[] = manifest.modules.map((mod) => {
    const liveMod = moduleById.get(mod.sourceId);
    const chapters: ReportCurriculumChapter[] = mod.chapters.map((ch) => {
      const liveCh = chapterById.get(ch.sourceId);
      const sections: ReportCurriculumSection[] = sortSectionsByOrderIndex(
        ch.sectionIds
          .map((sid) => sectionById.get(sid))
          .filter((s): s is NonNullable<typeof s> => Boolean(s))
          .map((s) => ({
            id: s.id,
            title: s.title,
            orderIndex: s.orderIndex,
            type: s.type,
          })),
      );

      return {
        sourceChapterId: ch.sourceId,
        title: liveCh?.title ?? '',
        orderIndex: ch.order,
        sections,
        quizzesTotal: ch.quizIds.filter((qid) => quizIdSet.has(qid)).length,
      };
    });

    return {
      sourceModuleId: mod.sourceId,
      title: liveMod?.title ?? '',
      orderIndex: mod.order,
      chapters,
    };
  });

  return {
    versionId: version.id,
    versionNumber: version.versionNumber,
    modules,
  };
}

export function mapPinnedSectionsForLearner(
  sections: PinnedCurriculumSection[],
): PinnedCurriculumSection[] {
  return sortSectionsByOrderIndex(sections);
}

export function mapPinnedQuizzesForLearner(
  quizzes: PinnedCurriculumQuiz[],
  includeAnswers: boolean,
): Array<Omit<PinnedCurriculumQuiz, 'answer'> & { answer?: string }> {
  return quizzes.map((q) => {
    if (!includeAnswers) {
      const { answer: _a, ...rest } = q;
      return rest;
    }
    return q;
  });
}
