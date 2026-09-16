"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailEqualsWhere = exports.normalizeEmail = void 0;
function normalizeEmail(email) {
    return email.trim().toLowerCase();
}
exports.normalizeEmail = normalizeEmail;
function emailEqualsWhere(email) {
    return {
        email: { equals: normalizeEmail(email), mode: 'insensitive' },
    };
}
exports.emailEqualsWhere = emailEqualsWhere;
//# sourceMappingURL=email.js.map