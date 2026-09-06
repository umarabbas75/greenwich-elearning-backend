"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.categoryAllows = exports.shouldBroadcastNewThread = exports.resolveNewThreadStatus = exports.assertStudentMayCreate = exports.assertCourseScope = exports.slugifyCategoryName = exports.isAdminRole = void 0;
const client_1 = require("@prisma/client");
function isAdminRole(role) {
    return role === client_1.Role.admin || role === 'admin';
}
exports.isAdminRole = isAdminRole;
function slugifyCategoryName(name) {
    const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return slug || 'category';
}
exports.slugifyCategoryName = slugifyCategoryName;
function assertCourseScope(category, courseId) {
    const hasCourse = Boolean(courseId);
    if (category.courseScope === client_1.ForumCourseScope.REQUIRED && !hasCourse) {
        throw new Error('courseId is required for this category');
    }
    if (category.courseScope === client_1.ForumCourseScope.FORBIDDEN && hasCourse) {
        throw new Error('This category does not allow a course on the thread');
    }
}
exports.assertCourseScope = assertCourseScope;
function assertStudentMayCreate(category, role) {
    if (isAdminRole(role))
        return;
    if (!category.isActive) {
        throw new Error('This category is not accepting new threads');
    }
    if (category.studentCreatePolicy === client_1.ForumStudentCreatePolicy.DISABLED) {
        throw new Error('Students cannot create threads in this category');
    }
}
exports.assertStudentMayCreate = assertStudentMayCreate;
function resolveNewThreadStatus(args) {
    if (isAdminRole(args.role)) {
        if (args.requestedStatus === 'inActive' || args.requestedStatus === 'active') {
            return args.requestedStatus;
        }
        return 'active';
    }
    if (args.category.studentCreatePolicy === client_1.ForumStudentCreatePolicy.MODERATED) {
        return 'inActive';
    }
    return 'active';
}
exports.resolveNewThreadStatus = resolveNewThreadStatus;
function shouldBroadcastNewThread(args) {
    if (args.status !== 'active')
        return false;
    if (args.category.notifyOnCreate === client_1.ForumNotifyOnCreate.NONE)
        return false;
    if (args.category.notifyOnCreate === client_1.ForumNotifyOnCreate.ALL)
        return true;
    return isAdminRole(args.role);
}
exports.shouldBroadcastNewThread = shouldBroadcastNewThread;
function categoryAllows(category, flag) {
    if (!category)
        return true;
    return category[flag] !== false;
}
exports.categoryAllows = categoryAllows;
//# sourceMappingURL=forum-policy.js.map