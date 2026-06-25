import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

type Tx = Prisma.TransactionClient | PrismaClient;

/** Use for publish/backfill transactions that snapshot large courses. */
export const SNAPSHOT_TRANSACTION_OPTIONS = {
  maxWait: 15_000,
  timeout: 120_000,
} as const;

export type SnapshotLiveTreeOptions = {
  versionNumber: number;
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  isLatest?: boolean;
  publishedAt?: Date | null;
  publishedByAdminId?: string | null;
  changeNotes?: string | null;
  /** Live section ids to omit from the snapshot (e.g. post-cutover remediation). */
  excludeSourceSectionIds?: string[];
};

export type SnapshotLiveTreeResult = {
  versionId: string;
  versionNumber: number;
  moduleCount: number;
  chapterCount: number;
  sectionCount: number;
  quizCount: number;
};

/**
 * Materialises the live Module → Chapter → Section → Quiz tree into
 * CourseVersion* rows. Uses batched createMany to stay within transaction
 * timeouts on pooled connections (Neon/PgBouncer).
 */
export async function snapshotLiveTree(
  prisma: Tx,
  courseId: string,
  options: SnapshotLiveTreeOptions,
): Promise<SnapshotLiveTreeResult> {
  const {
    versionNumber,
    status = 'PUBLISHED',
    isLatest = false,
    publishedAt = status === 'PUBLISHED' ? new Date() : null,
    publishedByAdminId = null,
    changeNotes = null,
    excludeSourceSectionIds = [],
  } = options;
  const excludedSectionIds = new Set(excludeSourceSectionIds);

  const versionId = randomUUID();
  const now = new Date();

  await prisma.courseVersion.create({
    data: {
      id: versionId,
      courseId,
      versionNumber,
      status,
      isLatest,
      publishedAt,
      publishedByAdminId,
      changeNotes,
      updatedAt: now,
    },
  });

  const modules = await prisma.module.findMany({
    where: { courseId, isArchived: false },
    orderBy: { createdAt: 'asc' },
    include: {
      chapters: {
        where: { isArchived: false },
        orderBy: { createdAt: 'asc' },
        include: {
          sections: {
            where: { isArchived: false },
            orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
          },
          quizzes: {
            where: { isArchived: false },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });

  const moduleRows: Prisma.CourseVersionModuleCreateManyInput[] = [];
  const chapterRows: Prisma.CourseVersionChapterCreateManyInput[] = [];
  const sectionRows: Prisma.CourseVersionSectionCreateManyInput[] = [];
  const quizRows: Prisma.CourseVersionQuizCreateManyInput[] = [];

  let chapterCount = 0;
  let sectionCount = 0;
  let quizCount = 0;

  for (let modIdx = 0; modIdx < modules.length; modIdx++) {
    const mod = modules[modIdx];
    const versionModuleId = randomUUID();

    moduleRows.push({
      id: versionModuleId,
      versionId,
      sourceModuleId: mod.id,
      title: mod.title,
      description: mod.description,
      orderIndex: modIdx,
      updatedAt: now,
    });

    for (let chIdx = 0; chIdx < mod.chapters.length; chIdx++) {
      const ch = mod.chapters[chIdx];
      const versionChapterId = randomUUID();
      chapterCount++;

      chapterRows.push({
        id: versionChapterId,
        versionId,
        versionModuleId,
        sourceChapterId: ch.id,
        title: ch.title,
        description: ch.description,
        pdfFile: ch.pdfFile,
        orderIndex: chIdx,
        hasQuiz: ch.quizzes.length > 0,
        updatedAt: now,
      });

      for (const sec of ch.sections) {
        if (excludedSectionIds.has(sec.id)) {
          continue;
        }
        sectionCount++;
        sectionRows.push({
          id: randomUUID(),
          versionId,
          versionChapterId,
          sourceSectionId: sec.id,
          title: sec.title,
          description: sec.description,
          shortDescription: sec.shortDescription,
          type: sec.type,
          orderIndex: sec.orderIndex,
          itemLabel: sec.itemLabel,
          categoryLabel: sec.categoryLabel,
          categories: sec.categories,
          maxPerCategory: sec.maxPerCategory,
          isActive: sec.isActive,
          questionText: sec.questionText,
          imageUrl: sec.imageUrl,
          allowMultipleSelection: sec.allowMultipleSelection,
          items: sec.items ?? Prisma.JsonNull,
          options: sec.options ?? Prisma.JsonNull,
          config: sec.config ?? Prisma.JsonNull,
          updatedAt: now,
        });
      }

      for (const quiz of ch.quizzes) {
        quizCount++;
        quizRows.push({
          id: randomUUID(),
          versionId,
          versionChapterId,
          sourceQuizId: quiz.id,
          question: quiz.question,
          answer: quiz.answer,
          options: quiz.options,
          updatedAt: now,
        });
      }
    }
  }

  if (moduleRows.length > 0) {
    await prisma.courseVersionModule.createMany({ data: moduleRows });
  }
  if (chapterRows.length > 0) {
    await prisma.courseVersionChapter.createMany({ data: chapterRows });
  }
  if (sectionRows.length > 0) {
    await prisma.courseVersionSection.createMany({ data: sectionRows });
  }
  if (quizRows.length > 0) {
    await prisma.courseVersionQuiz.createMany({ data: quizRows });
  }

  return {
    versionId,
    versionNumber,
    moduleCount: modules.length,
    chapterCount,
    sectionCount,
    quizCount,
  };
}

/**
 * Returns active section source IDs for a pinned version (denominator set).
 */
export async function getVersionActiveSectionSourceIds(
  prisma: Tx,
  versionId: string,
): Promise<string[]> {
  const rows = await prisma.courseVersionSection.findMany({
    where: { versionId, isActive: true, sourceSectionId: { not: null } },
    select: { sourceSectionId: true },
  });
  return rows.map((r) => r.sourceSectionId as string);
}

/**
 * Count active sections in a version for a course (denominator).
 */
export async function countVersionActiveSections(
  prisma: Tx,
  versionId: string,
): Promise<number> {
  return prisma.courseVersionSection.count({
    where: { versionId, isActive: true },
  });
}

/**
 * Sort helper matching live section ordering.
 */
export function sortVersionSections<T extends { orderIndex: number | null }>(
  sections: T[],
): T[] {
  return [...sections].sort((a, b) => {
    if (a.orderIndex === null && b.orderIndex === null) return 0;
    if (a.orderIndex === null) return 1;
    if (b.orderIndex === null) return -1;
    return a.orderIndex - b.orderIndex;
  });
}

/**
 * Map a version section row to a live-shaped section object for the FE.
 * Uses sourceSectionId as id so progress URLs and UCP rows stay aligned.
 */
export function mapVersionSectionToLiveShape(section: {
  id: string;
  sourceSectionId: string | null;
  title: string;
  description: string;
  shortDescription: string | null;
  type: string;
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
  createdAt: Date;
  updatedAt: Date;
  versionChapterId: string;
}) {
  return {
    id: section.sourceSectionId ?? section.id,
    title: section.title,
    description: section.description,
    chapterId: section.versionChapterId,
    moduleId: null as string | null,
    createdAt: section.createdAt,
    updatedAt: section.updatedAt,
    shortDescription: section.shortDescription,
    type: section.type,
    orderIndex: section.orderIndex,
    itemLabel: section.itemLabel,
    categoryLabel: section.categoryLabel,
    categories: section.categories,
    maxPerCategory: section.maxPerCategory,
    isActive: section.isActive,
    questionText: section.questionText,
    imageUrl: section.imageUrl,
    allowMultipleSelection: section.allowMultipleSelection,
    items: section.items,
    options: section.options,
    config: section.config,
  };
}

/**
 * Map version quiz to live-shaped quiz for FE (sourceQuizId as id).
 */
export function mapVersionQuizToLiveShape(quiz: {
  id: string;
  sourceQuizId: string | null;
  question: string;
  answer: string;
  options: string[];
}) {
  return {
    id: quiz.sourceQuizId ?? quiz.id,
    question: quiz.question,
    options: quiz.options,
    answer: quiz.answer,
  };
}
