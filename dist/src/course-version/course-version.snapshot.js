"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapVersionQuizToLiveShape = exports.mapVersionSectionToLiveShape = exports.sortVersionSections = exports.countVersionActiveSections = exports.getVersionActiveSectionSourceIds = exports.snapshotLiveTree = exports.SNAPSHOT_TRANSACTION_OPTIONS = void 0;
const client_1 = require("@prisma/client");
const crypto_1 = require("crypto");
exports.SNAPSHOT_TRANSACTION_OPTIONS = {
    maxWait: 15000,
    timeout: 120000,
};
async function snapshotLiveTree(prisma, courseId, options) {
    const { versionNumber, status = 'PUBLISHED', isLatest = false, publishedAt = status === 'PUBLISHED' ? new Date() : null, publishedByAdminId = null, changeNotes = null, excludeSourceSectionIds = [], } = options;
    const excludedSectionIds = new Set(excludeSourceSectionIds);
    const versionId = (0, crypto_1.randomUUID)();
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
    const moduleRows = [];
    const chapterRows = [];
    const sectionRows = [];
    const quizRows = [];
    let chapterCount = 0;
    let sectionCount = 0;
    let quizCount = 0;
    for (let modIdx = 0; modIdx < modules.length; modIdx++) {
        const mod = modules[modIdx];
        const versionModuleId = (0, crypto_1.randomUUID)();
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
            const versionChapterId = (0, crypto_1.randomUUID)();
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
                    id: (0, crypto_1.randomUUID)(),
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
                    items: sec.items ?? client_1.Prisma.JsonNull,
                    options: sec.options ?? client_1.Prisma.JsonNull,
                    config: sec.config ?? client_1.Prisma.JsonNull,
                    updatedAt: now,
                });
            }
            for (const quiz of ch.quizzes) {
                quizCount++;
                quizRows.push({
                    id: (0, crypto_1.randomUUID)(),
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
exports.snapshotLiveTree = snapshotLiveTree;
async function getVersionActiveSectionSourceIds(prisma, versionId) {
    const rows = await prisma.courseVersionSection.findMany({
        where: { versionId, isActive: true, sourceSectionId: { not: null } },
        select: { sourceSectionId: true },
    });
    return rows.map((r) => r.sourceSectionId);
}
exports.getVersionActiveSectionSourceIds = getVersionActiveSectionSourceIds;
async function countVersionActiveSections(prisma, versionId) {
    return prisma.courseVersionSection.count({
        where: { versionId, isActive: true },
    });
}
exports.countVersionActiveSections = countVersionActiveSections;
function sortVersionSections(sections) {
    return [...sections].sort((a, b) => {
        if (a.orderIndex === null && b.orderIndex === null)
            return 0;
        if (a.orderIndex === null)
            return 1;
        if (b.orderIndex === null)
            return -1;
        return a.orderIndex - b.orderIndex;
    });
}
exports.sortVersionSections = sortVersionSections;
function mapVersionSectionToLiveShape(section) {
    return {
        id: section.sourceSectionId ?? section.id,
        title: section.title,
        description: section.description,
        chapterId: section.versionChapterId,
        moduleId: null,
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
exports.mapVersionSectionToLiveShape = mapVersionSectionToLiveShape;
function mapVersionQuizToLiveShape(quiz) {
    return {
        id: quiz.sourceQuizId ?? quiz.id,
        question: quiz.question,
        options: quiz.options,
        answer: quiz.answer,
    };
}
exports.mapVersionQuizToLiveShape = mapVersionQuizToLiveShape;
//# sourceMappingURL=course-version.snapshot.js.map