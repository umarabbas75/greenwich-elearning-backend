"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPolicyComplete = void 0;
function isPolicyComplete(acknowledged, requiredItems) {
    if (acknowledged) {
        return true;
    }
    const applicable = requiredItems.filter((item) => item.applies);
    const counted = applicable.length > 0 ? applicable : requiredItems;
    return counted.every((item) => item.isComplete);
}
exports.isPolicyComplete = isPolicyComplete;
//# sourceMappingURL=policy-completion.js.map