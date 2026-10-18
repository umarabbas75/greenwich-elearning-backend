"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.courseAccessExpiresAt = exports.DEFAULT_VALIDITY_DAYS = void 0;
exports.DEFAULT_VALIDITY_DAYS = 365;
function courseAccessExpiresAt(completedAt, validityDaysAtCompletion, currentValidityDays) {
    const current = currentValidityDays ?? exports.DEFAULT_VALIDITY_DAYS;
    const days = Math.max(validityDaysAtCompletion ?? current, current);
    const expiresAt = new Date(completedAt);
    expiresAt.setDate(expiresAt.getDate() + days);
    return expiresAt;
}
exports.courseAccessExpiresAt = courseAccessExpiresAt;
//# sourceMappingURL=course-access-expiry.js.map