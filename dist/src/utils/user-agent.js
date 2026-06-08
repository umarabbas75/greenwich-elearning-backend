"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseUserAgent = void 0;
function detectBrowser(ua) {
    if (/\bEdg(e|A|iOS)?\//i.test(ua))
        return 'Edge';
    if (/\bOPR\/|\bOpera\b/i.test(ua))
        return 'Opera';
    if (/\bSamsungBrowser\//i.test(ua))
        return 'Samsung Internet';
    if (/\bChrome\/|\bCriOS\//i.test(ua))
        return 'Chrome';
    if (/\bFirefox\/|\bFxiOS\//i.test(ua))
        return 'Firefox';
    if (/\bSafari\//i.test(ua))
        return 'Safari';
    return 'Unknown';
}
function detectOs(ua) {
    if (/\bWindows NT\b/i.test(ua))
        return 'Windows';
    if (/\biPhone\b|\biPad\b|\biPod\b/i.test(ua))
        return 'iOS';
    if (/\bAndroid\b/i.test(ua))
        return 'Android';
    if (/\bMac OS X\b|\bMacintosh\b/i.test(ua))
        return 'macOS';
    if (/\bLinux\b/i.test(ua))
        return 'Linux';
    return 'Unknown';
}
function detectDeviceType(ua) {
    if (/\biPad\b/i.test(ua) ||
        (/\bAndroid\b/i.test(ua) && !/\bMobile\b/i.test(ua)))
        return 'tablet';
    if (/\bMobi|\biPhone\b|\biPod\b|\bAndroid\b/i.test(ua))
        return 'mobile';
    return 'desktop';
}
function parseUserAgent(ua) {
    if (!ua || ua.trim().length === 0)
        return null;
    const browser = detectBrowser(ua);
    const os = detectOs(ua);
    const deviceType = detectDeviceType(ua);
    const label = browser === 'Unknown' && os === 'Unknown'
        ? 'Unknown device'
        : `${browser === 'Unknown' ? 'Browser' : browser} on ${os === 'Unknown' ? 'unknown OS' : os}`;
    return { browser, os, deviceType, label };
}
exports.parseUserAgent = parseUserAgent;
//# sourceMappingURL=user-agent.js.map