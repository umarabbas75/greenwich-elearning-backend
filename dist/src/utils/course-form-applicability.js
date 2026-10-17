"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formAppliesToEnrollment = void 0;
function formAppliesToEnrollment(formCreatedAt, enrolledAt) {
    if (!enrolledAt) {
        return true;
    }
    return enrolledAt.getTime() >= formCreatedAt.getTime();
}
exports.formAppliesToEnrollment = formAppliesToEnrollment;
//# sourceMappingURL=course-form-applicability.js.map