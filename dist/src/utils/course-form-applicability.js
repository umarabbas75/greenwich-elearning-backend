"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.courseFormAppliesToEnrollment = exports.policyItemAppliesToEnrollment = exports.policyAppliesToEnrollment = exports.reattachData = exports.courseFormAttachedForEnrollment = exports.formAppliesToEnrollment = void 0;
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
function reattachData(current, now) {
    return {
        detachedAt: null,
        detachedWindows: [
            ...(Array.isArray(current.detachedWindows)
                ? current.detachedWindows
                : []),
            { from: current.detachedAt.toISOString(), until: now.toISOString() },
        ],
    };
}
exports.reattachData = reattachData;
function policyAppliesToEnrollment(policy, enrolledAt) {
    return courseFormAttachedForEnrollment({ createdAt: policy.createdAt, detachedWindows: policy.detachedWindows }, enrolledAt);
}
exports.policyAppliesToEnrollment = policyAppliesToEnrollment;
function policyItemAppliesToEnrollment(item, enrolledAt) {
    if (!formAppliesToEnrollment(item.requiredSince, enrolledAt)) {
        return false;
    }
    return !(enrolledAt && enrolledWhileDetached(item.detachedWindows, enrolledAt));
}
exports.policyItemAppliesToEnrollment = policyItemAppliesToEnrollment;
function courseFormAppliesToEnrollment(form, enrolledAt) {
    return (courseFormAttachedForEnrollment(form, enrolledAt) &&
        formAppliesToEnrollment(form.requiredSince, enrolledAt));
}
exports.courseFormAppliesToEnrollment = courseFormAppliesToEnrollment;
//# sourceMappingURL=course-form-applicability.js.map