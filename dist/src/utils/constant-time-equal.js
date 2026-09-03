"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.constantTimeEqual = void 0;
const crypto_1 = require("crypto");
function constantTimeEqual(provided, expected) {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && (0, crypto_1.timingSafeEqual)(a, b);
}
exports.constantTimeEqual = constantTimeEqual;
//# sourceMappingURL=constant-time-equal.js.map