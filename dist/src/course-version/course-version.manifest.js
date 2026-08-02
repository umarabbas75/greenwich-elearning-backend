"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapPinnedQuizzesForLearner = exports.mapPinnedSectionsForLearner = exports.loadPinnedCurriculumForReport = exports.loadPinnedChapterQuizzes = exports.loadManifestForVersion = exports.resetManifestCache = exports.loadPinnedCurriculum = exports.publishManifestVersion = exports.buildManifestFromLegacySnapshot = exports.buildManifestFromLiveTree = exports.diffManifests = exports.isIdReferencedInManifest = exports.computeStructuralFingerprint = exports.getQuizIdsFromManifest = exports.getChapterIdsFromManifest = exports.getSectionIdsFromManifest = exports.countSectionsInManifest = exports.parseManifest = void 0;
const client_1 = require("@prisma/client");
const crypto_1 = require("crypto");
function parseManifest(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }
    const obj = raw;
    if (!Array.isArray(obj.modules)) {
        return null;
    }
    return obj;
}
exports.parseManifest = parseManifest;
function countSectionsInManifest(manifest) {
    return manifest.modules.reduce((sum, mod) => sum +
        mod.chapters.reduce((chSum, ch) => chSum + ch.sectionIds.length, 0), 0);
}
exports.countSectionsInManifest = countSectionsInManifest;
function getSectionIdsFromManifest(manifest) {
    return manifest.modules.flatMap((mod) => mod.chapters.flatMap((ch) => ch.sectionIds));
}
exports.getSectionIdsFromManifest = getSectionIdsFromManifest;
function getChapterIdsFromManifest(manifest) {
    return manifest.modules.flatMap((mod) => mod.chapters.map((ch) => ch.sourceId));
}
exports.getChapterIdsFromManifest = getChapterIdsFromManifest;
function getQuizIdsFromManifest(manifest) {
    return manifest.modules.flatMap((mod) => mod.chapters.flatMap((ch) => ch.quizIds));
}
exports.getQuizIdsFromManifest = getQuizIdsFromManifest;
function computeStructuralFingerprint(manifest) {
    const shape = manifest.modules.map((mod) => ({
        m: mod.sourceId,
        c: mod.chapters.map((ch) => ({
            c: ch.sourceId,
            s: ch.sectionIds,
            q: ch.quizIds,
        })),
    }));
    return (0, crypto_1.createHash)('sha256').update(JSON.stringify(shape)).digest('hex');
}
exports.computeStructuralFingerprint = computeStructuralFingerprint;
function isIdReferencedInManifest(manifest, table, sourceId) {
    switch (table) {
        case 'module':
            return manifest.modules.some((m) => m.sourceId === sourceId);
        case 'chapter':
            return manifest.modules.some((m) => m.chapters.some((ch) => ch.sourceId === sourceId));
        case 'section':
            return manifest.modules.some((m) => m.chapters.some((ch) => ch.sectionIds.includes(sourceId)));
        case 'quiz':
            return manifest.modules.some((m) => m.chapters.some((ch) => ch.quizIds.includes(sourceId)));
    }
}
exports.isIdReferencedInManifest = isIdReferencedInManifest;
function diffManifests(pinned, latest) {
    const pinnedSectionIds = new Set(getSectionIdsFromManifest(pinned));
    const pinnedChapterIds = new Set(getChapterIdsFromManifest(pinned));
    const latestSectionIds = getSectionIdsFromManifest(latest);
    const newSectionIds = latestSectionIds.filter((id) => !pinnedSectionIds.has(id));
    const newChapterSourceIds = new Set();
    for (const mod of latest.modules) {
        for (const ch of mod.chapters) {
            if (ch.sectionIds.some((sid) => newSectionIds.includes(sid)) &&
                !pinnedChapterIds.has(ch.sourceId)) {
                newChapterSourceIds.add(ch.sourceId);
            }
        }
    }
    return {
        newSections: newSectionIds.length,
        newChapters: newChapterSourceIds.size,
    };
}
exports.diffManifests = diffManifests;
function sortSectionsByOrderIndex(sections) {
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
async function buildManifestFromLiveTree(prisma, courseId, options = {}) {
    const excluded = new Set(options.excludeSourceSectionIds ?? []);
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
                        orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
                        select: { id: true },
                    },
                    quizzes: {
                        where: { isArchived: false },
                        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                        select: { id: true },
                    },
                },
            },
        },
    });
    const manifest = { modules: [] };
    let chapterCount = 0;
    let quizCount = 0;
    for (let modIdx = 0; modIdx < modules.length; modIdx++) {
        const mod = modules[modIdx];
        const chapters = [];
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
exports.buildManifestFromLiveTree = buildManifestFromLiveTree;
async function buildManifestFromLegacySnapshot(prisma, versionId) {
    const moduleRows = await prisma.$queryRaw(client_1.Prisma.sql `
    SELECT "id", "sourceModuleId", "orderIndex"
    FROM "course_version_modules"
    WHERE "versionId" = ${versionId}
    ORDER BY "orderIndex" ASC
  `);
    if (moduleRows.length === 0) {
        return null;
    }
    const chapterRows = await prisma.$queryRaw(client_1.Prisma.sql `
    SELECT "id", "versionModuleId", "sourceChapterId", "orderIndex"
    FROM "course_version_chapters"
    WHERE "versionId" = ${versionId}
    ORDER BY "orderIndex" ASC
  `);
    const sectionRows = await prisma.$queryRaw(client_1.Prisma.sql `
    SELECT "versionChapterId", "sourceSectionId"
    FROM "course_version_sections"
    WHERE "versionId" = ${versionId}
      AND "isActive" = true
      AND "sourceSectionId" IS NOT NULL
    ORDER BY "orderIndex" ASC, "createdAt" ASC
  `);
    const quizRows = await prisma.$queryRaw(client_1.Prisma.sql `
    SELECT "versionChapterId", "sourceQuizId"
    FROM "course_version_quizzes"
    WHERE "versionId" = ${versionId}
    ORDER BY "createdAt" ASC
  `);
    const sectionsByChapter = new Map();
    for (const s of sectionRows) {
        if (!s.sourceSectionId)
            continue;
        const list = sectionsByChapter.get(s.versionChapterId) ?? [];
        list.push(s.sourceSectionId);
        sectionsByChapter.set(s.versionChapterId, list);
    }
    const quizzesByChapter = new Map();
    for (const q of quizRows) {
        if (!q.sourceQuizId)
            continue;
        const list = quizzesByChapter.get(q.versionChapterId) ?? [];
        list.push(q.sourceQuizId);
        quizzesByChapter.set(q.versionChapterId, list);
    }
    const chaptersByModule = new Map();
    for (const ch of chapterRows) {
        const list = chaptersByModule.get(ch.versionModuleId) ?? [];
        list.push(ch);
        chaptersByModule.set(ch.versionModuleId, list);
    }
    const manifest = {
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
    const chapterCount = manifest.modules.reduce((sum, m) => sum + m.chapters.length, 0);
    const quizCount = getQuizIdsFromManifest(manifest).length;
    return {
        manifest,
        sectionCount,
        moduleCount: manifest.modules.length,
        chapterCount,
        quizCount,
    };
}
exports.buildManifestFromLegacySnapshot = buildManifestFromLegacySnapshot;
async function publishManifestVersion(prisma, courseId, options) {
    const built = options.prebuiltManifest ??
        (await buildManifestFromLiveTree(prisma, courseId, {
            excludeSourceSectionIds: options.excludeSourceSectionIds,
        }));
    const versionId = (0, crypto_1.randomUUID)();
    const now = new Date();
    await prisma.courseVersion.create({
        data: {
            id: versionId,
            courseId,
            versionNumber: options.versionNumber,
            status: options.status ?? 'PUBLISHED',
            isLatest: options.isLatest ?? false,
            publishedAt: options.publishedAt ??
                (options.status === 'PUBLISHED' ? now : null),
            publishedByAdminId: options.publishedByAdminId ?? null,
            changeNotes: options.changeNotes ?? null,
            manifest: built.manifest,
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
exports.publishManifestVersion = publishManifestVersion;
async function loadPinnedCurriculum(prisma, versionId) {
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
    const [liveSections, liveQuizzes, liveModules, liveChapters] = await Promise.all([
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
    const modules = manifest.modules.map((mod) => {
        const liveMod = moduleById.get(mod.sourceId);
        const chapters = mod.chapters.map((ch) => {
            const liveCh = chapterById.get(ch.sourceId);
            const sections = ch.sectionIds
                .map((sid) => sectionById.get(sid))
                .filter((s) => Boolean(s))
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
            const quizzes = ch.quizIds
                .map((qid) => quizById.get(qid))
                .filter((q) => Boolean(q))
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
exports.loadPinnedCurriculum = loadPinnedCurriculum;
const MANIFEST_CACHE_MAX = 64;
const manifestCache = new Map();
function getCachedManifest(versionId) {
    const cached = manifestCache.get(versionId);
    if (cached) {
        manifestCache.delete(versionId);
        manifestCache.set(versionId, cached);
    }
    return cached;
}
function setCachedManifest(versionId, manifest) {
    manifestCache.delete(versionId);
    manifestCache.set(versionId, manifest);
    if (manifestCache.size > MANIFEST_CACHE_MAX) {
        const oldest = manifestCache.keys().next().value;
        if (oldest !== undefined)
            manifestCache.delete(oldest);
    }
}
function resetManifestCache() {
    manifestCache.clear();
}
exports.resetManifestCache = resetManifestCache;
async function loadManifestForVersion(prisma, versionId) {
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
        }
        catch {
            manifest = null;
        }
    }
    if (manifest) {
        setCachedManifest(versionId, manifest);
    }
    return manifest;
}
exports.loadManifestForVersion = loadManifestForVersion;
function findManifestChapter(manifest, sourceChapterId) {
    for (const mod of manifest.modules) {
        const ch = mod.chapters.find((c) => c.sourceId === sourceChapterId);
        if (ch)
            return ch;
    }
    return null;
}
async function loadPinnedChapterQuizzes(prisma, versionId, sourceChapterId, includeAnswers) {
    const manifest = await loadManifestForVersion(prisma, versionId);
    if (!manifest)
        return [];
    const chapter = findManifestChapter(manifest, sourceChapterId);
    if (!chapter || chapter.quizIds.length === 0)
        return [];
    const rows = await prisma.quiz.findMany({
        where: { id: { in: chapter.quizIds } },
        select: { id: true, question: true, options: true, answer: true },
    });
    const byId = new Map(rows.map((q) => [q.id, q]));
    const ordered = chapter.quizIds
        .map((qid) => byId.get(qid))
        .filter((q) => Boolean(q))
        .map((q) => ({
        id: q.id,
        question: q.question,
        options: q.options,
        answer: q.answer,
    }));
    return mapPinnedQuizzesForLearner(ordered, includeAnswers);
}
exports.loadPinnedChapterQuizzes = loadPinnedChapterQuizzes;
async function loadPinnedCurriculumForReport(prisma, versionId) {
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
    const [liveSections, liveQuizzes, liveModules, liveChapters] = await Promise.all([
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
    const modules = manifest.modules.map((mod) => {
        const liveMod = moduleById.get(mod.sourceId);
        const chapters = mod.chapters.map((ch) => {
            const liveCh = chapterById.get(ch.sourceId);
            const sections = sortSectionsByOrderIndex(ch.sectionIds
                .map((sid) => sectionById.get(sid))
                .filter((s) => Boolean(s))
                .map((s) => ({
                id: s.id,
                title: s.title,
                orderIndex: s.orderIndex,
                type: s.type,
            })));
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
exports.loadPinnedCurriculumForReport = loadPinnedCurriculumForReport;
function mapPinnedSectionsForLearner(sections) {
    return sortSectionsByOrderIndex(sections);
}
exports.mapPinnedSectionsForLearner = mapPinnedSectionsForLearner;
function mapPinnedQuizzesForLearner(quizzes, includeAnswers) {
    return quizzes.map((q) => {
        if (!includeAnswers) {
            const { answer: _a, ...rest } = q;
            return rest;
        }
        return q;
    });
}
exports.mapPinnedQuizzesForLearner = mapPinnedQuizzesForLearner;
//# sourceMappingURL=course-version.manifest.js.map