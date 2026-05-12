"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withDbRetry = exports.extractPrismaErrorCode = void 0;
const library_1 = require("@prisma/client/runtime/library");
const TRANSIENT_CONNECT = new Set(['P1001', 'P1002', 'P2024']);
const TRANSIENT_READ_EXTRA = new Set(['P1008', 'P1017']);
function extractPrismaErrorCode(err) {
    if (err instanceof library_1.PrismaClientKnownRequestError)
        return err.code;
    if (err instanceof library_1.PrismaClientInitializationError)
        return err.errorCode;
    return undefined;
}
exports.extractPrismaErrorCode = extractPrismaErrorCode;
function isTransientForMode(err, mode) {
    const code = extractPrismaErrorCode(err);
    if (code) {
        if (TRANSIENT_CONNECT.has(code))
            return true;
        if (mode === 'read' && TRANSIENT_READ_EXTRA.has(code))
            return true;
        return false;
    }
    const msg = err instanceof Error ? err.message : String(err);
    return (msg.includes("Can't reach database server") ||
        msg.includes('Timed out fetching a new connection from the connection pool'));
}
async function withDbRetry(fn, options) {
    const retries = options?.retries ?? 2;
    const baseDelayMs = options?.baseDelayMs ?? 800;
    const maxWallTimeMs = options?.maxWallTimeMs ?? 8000;
    const mode = options?.mode ?? 'read';
    const onRetry = options?.onRetry;
    const startedAt = Date.now();
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err;
            if (!isTransientForMode(err, mode) || attempt === retries) {
                throw err;
            }
            const delayMs = baseDelayMs * (attempt + 1);
            if (Date.now() - startedAt + delayMs > maxWallTimeMs) {
                throw err;
            }
            onRetry?.({
                attempt: attempt + 1,
                maxAttempts: retries + 1,
                err,
                code: extractPrismaErrorCode(err),
            });
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
    throw lastError;
}
exports.withDbRetry = withDbRetry;
//# sourceMappingURL=with-db-retry.js.map