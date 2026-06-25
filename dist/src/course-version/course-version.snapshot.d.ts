import { Prisma, PrismaClient } from '@prisma/client';
type Tx = Prisma.TransactionClient | PrismaClient;
export declare const SNAPSHOT_TRANSACTION_OPTIONS: {
    readonly maxWait: 15000;
    readonly timeout: 120000;
};
export type SnapshotLiveTreeOptions = {
    versionNumber: number;
    status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    isLatest?: boolean;
    publishedAt?: Date | null;
    publishedByAdminId?: string | null;
    changeNotes?: string | null;
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
export declare function snapshotLiveTree(prisma: Tx, courseId: string, options: SnapshotLiveTreeOptions): Promise<SnapshotLiveTreeResult>;
export declare function getVersionActiveSectionSourceIds(prisma: Tx, versionId: string): Promise<string[]>;
export declare function countVersionActiveSections(prisma: Tx, versionId: string): Promise<number>;
export declare function sortVersionSections<T extends {
    orderIndex: number | null;
}>(sections: T[]): T[];
export declare function mapVersionSectionToLiveShape(section: {
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
}): {
    id: string;
    title: string;
    description: string;
    chapterId: string;
    moduleId: string;
    createdAt: Date;
    updatedAt: Date;
    shortDescription: string;
    type: string;
    orderIndex: number;
    itemLabel: string;
    categoryLabel: string;
    categories: string[];
    maxPerCategory: number;
    isActive: boolean;
    questionText: string;
    imageUrl: string;
    allowMultipleSelection: boolean;
    items: unknown;
    options: unknown;
    config: unknown;
};
export declare function mapVersionQuizToLiveShape(quiz: {
    id: string;
    sourceQuizId: string | null;
    question: string;
    answer: string;
    options: string[];
}): {
    id: string;
    question: string;
    options: string[];
    answer: string;
};
export {};
