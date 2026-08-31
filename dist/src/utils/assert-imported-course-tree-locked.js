"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertImportedCourseTreeLocked = exports.IMPORTED_SCORM_TREE_LOCKED_MESSAGE = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
exports.IMPORTED_SCORM_TREE_LOCKED_MESSAGE = 'Imported SCORM courses have a locked curriculum. Replace the package instead of editing the tree.';
async function assertImportedCourseTreeLocked(prisma, ref) {
    const courseId = await resolveCourseId(prisma, ref);
    if (!courseId)
        return;
    const course = await prisma.course.findUnique({
        where: { id: courseId },
        select: { deliveryMode: true },
    });
    if (course?.deliveryMode === client_1.CourseDeliveryMode.IMPORTED_SCORM) {
        throw new common_1.ForbiddenException(exports.IMPORTED_SCORM_TREE_LOCKED_MESSAGE);
    }
}
exports.assertImportedCourseTreeLocked = assertImportedCourseTreeLocked;
async function resolveCourseId(prisma, ref) {
    if (ref.courseId)
        return ref.courseId;
    if (ref.moduleId) {
        const mod = await prisma.module.findUnique({
            where: { id: ref.moduleId },
            select: { courseId: true },
        });
        return mod?.courseId ?? null;
    }
    if (ref.chapterId) {
        const chapter = await prisma.chapter.findUnique({
            where: { id: ref.chapterId },
            select: { module: { select: { courseId: true } } },
        });
        return chapter?.module?.courseId ?? null;
    }
    if (ref.sectionId) {
        const section = await prisma.section.findUnique({
            where: { id: ref.sectionId },
            select: {
                chapter: { select: { module: { select: { courseId: true } } } },
            },
        });
        return section?.chapter?.module?.courseId ?? null;
    }
    return null;
}
//# sourceMappingURL=assert-imported-course-tree-locked.js.map