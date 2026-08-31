"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unescapeRiseTitle = exports.unwrapRiseRuntimeJson = exports.parseRiseRuntimeData = void 0;
const JSONP_RE = /__jsonp\(\s*"([^"]*)"\s*,\s*"([^"]+)"\s*\)/;
function parseRiseRuntimeData(source) {
    const json = unwrapRiseRuntimeJson(source);
    const course = json && typeof json === 'object' && !Array.isArray(json)
        ? json.course
        : null;
    const courseObj = course && typeof course === 'object' && !Array.isArray(course)
        ? course
        : {};
    const root = json && typeof json === 'object' && !Array.isArray(json)
        ? json
        : {};
    const settings = root.settings && typeof root.settings === 'object'
        ? root.settings
        : {};
    const exportSettings = courseObj.exportSettings && typeof courseObj.exportSettings === 'object'
        ? courseObj.exportSettings
        : {};
    const reporting = firstString(settings.reporting, exportSettings.reporting);
    const lessons = Array.isArray(courseObj.lessons) ? courseObj.lessons : [];
    let quizItemCount = 0;
    let passingScore = null;
    for (const lesson of lessons) {
        if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) {
            continue;
        }
        const row = lesson;
        if (row.type !== 'quiz')
            continue;
        const items = Array.isArray(row.items) ? row.items : [];
        quizItemCount += items.length;
        if (passingScore == null) {
            const quizSettings = row.settings && typeof row.settings === 'object'
                ? row.settings
                : {};
            if (typeof quizSettings.passingScore === 'number') {
                passingScore = quizSettings.passingScore;
            }
        }
    }
    const rawTitle = firstString(courseObj.title, settings.title);
    return {
        title: rawTitle,
        reporting,
        quizItemCount,
        passingScore,
    };
}
exports.parseRiseRuntimeData = parseRiseRuntimeData;
function unwrapRiseRuntimeJson(source) {
    const trimmed = source.trim();
    const jsonp = JSONP_RE.exec(trimmed);
    if (jsonp) {
        const decoded = Buffer.from(jsonp[2], 'base64').toString('utf8');
        return JSON.parse(decoded);
    }
    return JSON.parse(trimmed);
}
exports.unwrapRiseRuntimeJson = unwrapRiseRuntimeJson;
function unescapeRiseTitle(title) {
    return unescapeHtmlEntities(unescapeHtmlEntities(title));
}
exports.unescapeRiseTitle = unescapeRiseTitle;
function unescapeHtmlEntities(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
}
function firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.length > 0)
            return value;
    }
    return null;
}
//# sourceMappingURL=rise-probe.js.map