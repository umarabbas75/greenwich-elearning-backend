import { Prisma, PrismaClient, SectionType } from '@prisma/client';
import { randomUUID } from 'crypto';
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

export function countSectionsInManifest(manifest: CourseVersionManifest): number {
  return manifest.modules.reduce(
    (sum, mod) =>
      sum +
      mod.chapters.reduce((chSum, ch) => chSum + ch.sectionIds.length, 0),
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

export function computeStructuralFingerprint(
  manifest: CourseVersionManifest,
): string {
  const moduleIds = manifest.modules.map((m) => m.sourceId).sort();
  const chapterIds = getChapterIdsFromManifest(manifest).sort();
  const sectionIds = getSectionIdsFromManifest(manifest).sort();
  const quizIds = getQuizIdsFromManifest(manifest).sort();
  return JSON.stringify({ moduleIds, chapterIds, sectionIds, quizIds });
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
  const modules = await prisma.module.findMany({
    where: { courseId, isArchived: false },
    orderBy: { createdAt: 'asc' },
    include: {
      chapters: {
        where: { isArchived: false },
        orderBy: { createdAt: 'asc' },
        include: {
          sections: {
            where: { isArchived: false, isActive: true },
            orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
            select: { id: true },
          },
          quizzes: {
            where: { isArchived: false },
            orderBy: { createdAt: 'asc' },
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
  const built = await buildManifestFromLiveTree(prisma, courseId, {
    excludeSourceSectionIds: options.excludeSourceSectionIds,
  });

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
        options.publishedAt ??
        (options.status === 'PUBLISHED' ? now : null),
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
  const version = await prisma.courseVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      versionNumber: true,
      manifest: true,
    },
  });
  if (!version) {
    return null;
  }

  let manifest = parseManifest(version.manifest);
  if (!manifest) {
    // Backfill window only: a pre-migration version whose manifest hasn't been
    // populated yet. After migration 2 drops the legacy tables this throws, so
    // swallow it and fall through to a null tree (caller degrades to live).
    try {
      manifest =
        (await buildManifestFromLegacySnapshot(prisma, versionId))?.manifest ??
        null;
    } catch {
      manifest = null;
    }
  }
  if (!manifest) {
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
 * Report-only hydrate: section titles/types + quiz counts.
 * Avoids pulling full section HTML/config payloads (~10x less DB transfer).
 */
export async function loadPinnedCurriculumForReport(
  prisma: Db,
  versionId: string,
): Promise<ReportCurriculumTree | null> {
  const version = await prisma.courseVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      versionNumber: true,
      manifest: true,
    },
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
  if (!manifest) {
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
