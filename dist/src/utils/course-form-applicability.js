"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.courseFormAppliesToEnrollment = exports.courseFormAttachedForEnrollment = exports.formAppliesToEnrollment = void 0;
function formAppliesToEnrollment(formCreatedAt, enrolledAt) {
    if (!enrolledAt) {
        return true;
    }
    return enrolledAt.getTime() >= formCreatedAt.getTime();
}
exports.formAppliesToEnrollment = formAppliesToEnrollment;
function enrolledWhileDetached(windows, enrolledAt) {
    if (!Array.isArray(windows)) {
        return false;
    }
    const enrolled = enrolledAt.getTime();
    return windows.some((window) => {
        const from = Date.parse(window?.from);
        const until = Date.parse(window?.until);
        return (Number.isFinite(from) &&
            Number.isFinite(until) &&
            enrolled >= from &&
            enrolled < until);
    });
}
function courseFormAttachedForEnrollment(form, enrolledAt) {
    if (!formAppliesToEnrollment(form.createdAt, enrolledAt)) {
        return false;
    }
    return !(enrolledAt && enrolledWhileDetached(form.detachedWindows, enrolledAt));
}
exports.courseFormAttachedForEnrollment = courseFormAttachedForEnrollment;
function courseFormAppliesToEnrollment(form, enrolledAt) {
    return (courseFormAttachedForEnrollment(form, enrolledAt) &&
        formAppliesToEnrollment(form.requiredSince, enrolledAt));
}
exports.courseFormAppliesToEnrollment = courseFormAppliesToEnrollment;
//# sourceMappingURL=course-form-applicability.js.map