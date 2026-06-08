"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserAgent = exports.getClientIp = void 0;
function getClientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) {
        const first = fwd.split(',')[0]?.trim();
        if (first)
            return first;
    }
    if (Array.isArray(fwd) && fwd.length > 0) {
        const first = fwd[0]?.split(',')[0]?.trim();
        if (first)
            return first;
    }
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && real.length > 0)
        return real;
    return req.ip ?? req.socket?.remoteAddress ?? null;
}
exports.getClientIp = getClientIp;
const NON_BROWSER_UA = /^(node|node-fetch|undici|axios|got|python-requests|curl|wget|okhttp|go-http-client|java|PostmanRuntime)\b/i;
function getUserAgent(req) {
    const ua = req.headers['user-agent'];
    if (typeof ua !== 'string' || ua.length === 0)
        return null;
    if (NON_BROWSER_UA.test(ua.trim()))
        return null;
    return ua.slice(0, 512);
}
exports.getUserAgent = getUserAgent;
//# sourceMappingURL=client-request.js.map