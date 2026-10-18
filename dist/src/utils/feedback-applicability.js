"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.feedbackAppliesToCompletion = void 0;
const course_form_applicability_1 = require("./course-form-applicability");
function feedbackAppliesToCompletion(requiredSince, courseCompletedAt) {
    return (0, course_form_applicability_1.formAppliesToEnrollment)(requiredSince, courseCompletedAt);
}
exports.feedbackAppliesToCompletion = feedbackAppliesToCompletion;
//# sourceMappingURL=feedback-applicability.js.map