"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractRuntime = void 0;
function extractRuntime(payload) {
    if (!isRecord(payload))
        return null;
    const root = payload.activityDetails;
    if (!isRecord(root))
        return null;
    let runtime = null;
    let runtimeDepth = -1;
    const scalars = {
        attempts: { value: null, depth: -1 },
        suspended: { value: null, depth: -1 },
        completionAmount: { value: null, depth: -1 },
    };
    const take = (slot, candidate, depth) => {
        if (candidate !== null && depth > slot.depth) {
            slot.value = candidate;
            slot.depth = depth;
        }
    };
    const visit = (node, depth) => {
        if (isRecord(node.runtime) && depth > runtimeDepth) {
            runtime = node.runtime;
            runtimeDepth = depth;
        }
        take(scalars.attempts, toFiniteNumber(node.attempts), depth);
        take(scalars.suspended, typeof node.suspended === 'boolean' ? node.suspended : null, depth);
        take(scalars.completionAmount, toCompletionAmount(node.completionAmount), depth);
        const children = node.children;
        if (!Array.isArray(children))
            return;
        for (const child of children) {
            if (isRecord(child))
                visit(child, depth + 1);
        }
    };
    visit(root, 0);
    return {
        runtime,
        attempts: scalars.attempts.value,
        suspended: scalars.suspended.value,
        completionAmount: scalars.completionAmount.value,
    };
}
exports.extractRuntime = extractRuntime;
function toCompletionAmount(value) {
    if (isRecord(value))
        return toFiniteNumber(value.scaled);
    return toFiniteNumber(value);
}
function toFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=scorm-runtime-extract.js.map