import { Prisma, PrismaClient, SectionType } from '@prisma/client';
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
export declare function parseManifest(raw: unknown): CourseVersionManifest | null;
export declare function countSectionsInManifest(manifest: CourseVersionManifest): number;
export declare function getSectionIdsFromManifest(manifest: CourseVersionManifest): string[];
export declare function getChapterIdsFromManifest(manifest: CourseVersionManifest): string[];
export declare function getQuizIdsFromManifest(manifest: CourseVersionManifest): string[];
export declare function computeStructuralFingerprint(manifest: CourseVersionManifest): string;
export declare function isIdReferencedInManifest(manifest: CourseVersionManifest, table: 'section' | 'chapter' | 'module' | 'quiz', sourceId: string): boolean;
export declare function diffManifests(pinned: CourseVersionManifest, latest: CourseVersionManifest): {
    newSections: number;
    newChapters: number;
};
export declare function buildManifestFromLiveTree(prisma: Db, courseId: string, options?: BuildManifestOptions): Promise<BuildManifestResult>;
export declare function buildManifestFromLegacySnapshot(prisma: Db, versionId: string): Promise<BuildManifestResult | null>;
export type PublishManifestVersionOptions = {
    versionNumber: number;
    status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    isLatest?: boolean;
    publishedAt?: Date | null;
    publishedByAdminId?: string | null;
    changeNotes?: string | null;
    excludeSourceSectionIds?: string[];
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
export declare function publishManifestVersion(prisma: Db, courseId: string, options: PublishManifestVersionOptions): Promise<PublishManifestVersionResult>;
export declare function loadPinnedCurriculum(prisma: Db, versionId: string): Promise<PinnedCurriculumTree | null>;
export declare function resetManifestCache(): void;
export declare function loadManifestForVersion(prisma: Db, versionId: string): Promise<CourseVersionManifest | null>;
export declare function compareQuizDisplayOrder(a: {
    orderIndex: number | null;
    createdAt: Date;
    id: string;
}, b: {
    orderIndex: number | null;
    createdAt: Date;
    id: string;
}): number;
export declare function sortQuizIdsByLiveOrder(prisma: Db, quizIds: string[]): Promise<string[]>;
export declare function loadPinnedChapterQuizzes(prisma: Db, versionId: string, sourceChapterId: string, includeAnswers: boolean): Promise<Array<Omit<PinnedCurriculumQuiz, 'answer'> & {
    answer?: string;
}>>;
export declare function loadPinnedCurriculumForReport(prisma: Db, versionId: string): Promise<ReportCurriculumTree | null>;
export declare function mapPinnedSectionsForLearner(sections: PinnedCurriculumSection[]): PinnedCurriculumSection[];
export declare function mapPinnedQuizzesForLearner(quizzes: PinnedCurriculumQuiz[], includeAnswers: boolean): Array<Omit<PinnedCurriculumQuiz, 'answer'> & {
    answer?: string;
}>;
export {};
