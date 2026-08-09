"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeLearnerPercentage = exports.computeLearnerPercentages = exports.percentageKey = void 0;
const client_1 = require("@prisma/client");
const course_version_manifest_1 = require("./course-version.manifest");
const percentageKey = (userId, courseId) => `${userId}::${courseId}`;
exports.percentageKey = percentageKey;
async function computeLearnerPercentages(prisma, pairs) {
    const result = new Map();
    if (pairs.length === 0)
        return result;
    const unique = new Map();
    for (const p of pairs)
        unique.set((0, exports.percentageKey)(p.userId, p.courseId), p);
    const keys = Array.from(unique.values());
    const courseIds = Array.from(new Set(keys.map((k) => k.courseId)));
    const pinByKey = new Map();
    const needsPinLookup = [];
    for (const k of keys) {
        if (k.enrolledVersionId === undefined) {
            needsPinLookup.push(k);
        }
        else {
            pinByKey.set((0, exports.percentageKey)(k.userId, k.courseId), k.enrolledVersionId);
        }
    }
    const [enrollments, completions] = await Promise.all([
        needsPinLookup.length
            ? prisma.userCourse.findMany({
                where: {
                    OR: needsPinLookup.map((k) => ({
                        userId: k.userId,
                        courseId: k.courseId,
                    })),
                },
                select: { userId: true, courseId: true, enrolledVersionId: true },
            })
            : Promise.resolve([]),
        prisma.courseCompletion.findMany({
            where: {
                OR: keys.map((k) => ({ userId: k.userId, courseId: k.courseId })),
                courseCompletedAt: { not: null },
            },
            select: { userId: true, courseId: true },
        }),
    ]);
    for (const e of enrollments) {
        pinByKey.set((0, exports.percentageKey)(e.userId, e.courseId), e.enrolledVersionId);
    }
    const completedKeys = new Set(completions.map((c) => (0, exports.percentageKey)(c.userId, c.courseId)));
    const versionIds = Array.from(new Set(Array.from(pinByKey.values()).filter((v) => v !== null)));
    const sectionIdsByVersion = new Map();
    await Promise.all(versionIds.map(async (versionId) => {
        const manifest = await (0, course_version_manifest_1.loadManifestForVersion)(prisma, versionId);
        if (manifest) {
            sectionIdsByVersion.set(versionId, (0, course_version_manifest_1.getSectionIdsFromManifest)(manifest));
        }
    }));
    const needsLive = keys.some((k) => {
        const pin = pinByKey.get((0, exports.percentageKey)(k.userId, k.courseId)) ?? null;
        return pin === null || !sectionIdsByVersion.has(pin);
    });
    const liveSectionIdsByCourse = new Map();
    if (needsLive) {
        const liveSections = await prisma.$queryRaw `
      SELECT s."id", m."courseId"
        FROM "sections" s
        JOIN "chapters" c ON c."id" = s."chapterId"
        JOIN "modules"  m ON m."id" = c."moduleId"
       WHERE s."isActive" = true
         AND s."isArchived" = false
         AND c."isArchived" = false
         AND m."isArchived" = false
         AND m."courseId" IN (${client_1.Prisma.join(courseIds)})
    `;
        for (const s of liveSections) {
            const bucket = liveSectionIdsByCourse.get(s.courseId) ?? [];
            bucket.push(s.id);
            liveSectionIdsByCourse.set(s.courseId, bucket);
        }
    }
    const sectionIdsByKey = new Map();
    const allSectionIds = new Set();
    for (const k of keys) {
        const key = (0, exports.percentageKey)(k.userId, k.courseId);
        const pin = pinByKey.get(key) ?? null;
        const pinned = pin ? sectionIdsByVersion.get(pin) : undefined;
        const ids = pinned ?? liveSectionIdsByCourse.get(k.courseId) ?? [];
        sectionIdsByKey.set(key, {
            ids,
            source: pinned ? 'manifest' : 'live',
        });
        for (const id of ids)
            allSectionIds.add(id);
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
    const progressByKey = new Map();
    for (const row of progressRows) {
        const key = (0, exports.percentageKey)(row.userId, row.courseId);
        const set = progressByKey.get(key) ?? new Set();
        set.add(row.sectionId);
        progressByKey.set(key, set);
    }
    for (const k of keys) {
        const key = (0, exports.percentageKey)(k.userId, k.courseId);
        const { ids, source } = sectionIdsByKey.get(key);
        const done = progressByKey.get(key);
        const isCompleted = completedKeys.has(key);
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
exports.computeLearnerPercentages = computeLearnerPercentages;
async function computeLearnerPercentage(prisma, userId, courseId) {
    const map = await computeLearnerPercentages(prisma, [{ userId, courseId }]);
    return map.get((0, exports.percentageKey)(userId, courseId));
}
exports.computeLearnerPercentage = computeLearnerPercentage;
function toPercentage(numerator, denominator, isCompleted) {
    if (isCompleted)
        return 100;
    if (denominator <= 0)
        return 0;
    const raw = (numerator * 100) / denominator;
    if (numerator >= denominator)
        return 100;
    if (numerator > 0 && raw < 1)
        return 1;
    return Math.min(99, Math.round(raw));
}
//# sourceMappingURL=learner-percentage.js.map