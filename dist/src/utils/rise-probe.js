"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unescapeRiseTitle = exports.unwrapRiseRuntimeJson = exports.parseRiseRuntimeData = void 0;
const RISE_DIVIDER_TYPE = 'section';
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
    const riseIndexSpaceRisk = describeRiseIndexSpaceRisk(lessons);
    let quizItemCount = 0;
    let passingScore = null;
    for (const lesson of lessons) {
        if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) {
            continue;
        }
        const row = lesson;
        if (row.deleted === true)
            continue;
        if (typeof row.id !== 'string' || row.id.length === 0)
            continue;
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
        lessons: extractRiseLessons(lessons),
        riseIndexSpaceRisk,
    };
}
exports.parseRiseRuntimeData = parseRiseRuntimeData;
function describeRiseIndexSpaceRisk(rawLessons) {
    let deleted = 0;
    let unusable = 0;
    let dividers = 0;
    let outOfOrder = false;
    let previousPosition = -Infinity;
    rawLessons.forEach((lesson, i) => {
        if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) {
            unusable += 1;
            return;
        }
        const row = lesson;
        if (row.deleted === true) {
            deleted += 1;
            return;
        }
        if (typeof row.id !== 'string' || row.id.length === 0) {
            unusable += 1;
            return;
        }
        if (row.type === RISE_DIVIDER_TYPE) {
            dividers += 1;
            return;
        }
        const position = typeof row.position === 'number' && Number.isFinite(row.position)
            ? row.position
            : i;
        if (position < previousPosition)
            outOfOrder = true;
        previousPosition = position;
    });
    if (deleted === 0 && unusable === 0 && dividers === 0 && !outOfOrder) {
        return null;
    }
    const parts = [];
    if (deleted > 0)
        parts.push(`${deleted} soft-deleted lesson(s)`);
    if (unusable > 0)
        parts.push(`${unusable} lesson(s) dropped for a missing id`);
    if (dividers > 0)
        parts.push(`${dividers} section divider(s)`);
    if (outOfOrder)
        parts.push('position order differs from array order');
    return parts.join('; ');
}
function extractRiseLessons(rawLessons) {
    const rows = [];
    for (let i = 0; i < rawLessons.length; i += 1) {
        const lesson = rawLessons[i];
        if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson))
            continue;
        const row = lesson;
        if (row.deleted === true)
            continue;
        if (typeof row.id !== 'string' || row.id.length === 0)
            continue;
        if (row.type === RISE_DIVIDER_TYPE)
            continue;
        const position = typeof row.position === 'number' && Number.isFinite(row.position)
            ? row.position
            : i;
        rows.push({
            position,
            id: row.id,
            title: typeof row.title === 'string' && row.title.length > 0
                ? unescapeRiseTitle(row.title)
                : null,
            type: typeof row.type === 'string' ? row.type : 'blocks',
        });
    }
    rows.sort((a, b) => a.position - b.position);
    return rows.map((row, index) => ({
        index,
        id: row.id,
        title: row.title ?? `Lesson ${index + 1}`,
        type: row.type,
    }));
}
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