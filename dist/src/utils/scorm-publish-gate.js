"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateScormPublishGate = exports.scormGateCandidateSectionsWhere = exports.scormPackageSectionIds = void 0;
const client_1 = require("@prisma/client");
function scormPackageSectionIds(pkg) {
    const lessonSectionIds = Array.isArray(pkg?.lessons)
        ? pkg.lessons
            .map((l) => l?.sectionId)
            .filter((id) => typeof id === 'string' && !!id)
        : [];
    return new Set(lessonSectionIds.length > 0
        ? lessonSectionIds
        : pkg?.sectionId
            ? [pkg.sectionId]
            : []);
}
exports.scormPackageSectionIds = scormPackageSectionIds;
function scormGateCandidateSectionsWhere(courseId) {
    return {
        type: client_1.SectionType.SCORM,
        isArchived: false,
        chapter: {
            isArchived: false,
            module: { courseId, isArchived: false },
        },
    };
}
exports.scormGateCandidateSectionsWhere = scormGateCandidateSectionsWhere;
function evaluateScormPublishGate(expected, candidates) {
    const liveIds = new Set(candidates.filter((s) => s.isActive).map((s) => s.id));
    const deactivatedIds = new Set(candidates.filter((s) => !s.isActive).map((s) => s.id));
    const missing = [...expected].filter((id) => !liveIds.has(id));
    const extra = [...liveIds].filter((id) => !expected.has(id));
    const deactivated = missing.filter((id) => deactivatedIds.has(id));
    const gone = missing.length - deactivated.length;
    const problems = [];
    if (gone > 0) {
        problems.push(`${gone} of the ${expected.size} section(s) its READY package produced are archived or missing — the import is incomplete; re-import the package`);
    }
    if (deactivated.length > 0) {
        problems.push(`${deactivated.length} section(s) of this package are deactivated — reactivate them`);
    }
    if (extra.length > 0) {
        problems.push(`${extra.length} leftover SCORM section(s) not from this package are live — archive them`);
    }
    return { missing, deactivated, gone, extra, problems };
}
exports.evaluateScormPublishGate = evaluateScormPublishGate;
//# sourceMappingURL=scorm-publish-gate.js.map