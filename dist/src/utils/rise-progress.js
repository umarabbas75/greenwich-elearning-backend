"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveRiseLesson = exports.parseRiseSuspendData = void 0;
const SUPPORTED_SUSPEND_VERSION = 3;
const LZW_DICT_SIZE = 256;
function parseRiseSuspendData(raw) {
    if (typeof raw !== 'string' || raw.trim().length === 0)
        return null;
    let envelope;
    try {
        envelope = JSON.parse(raw);
    }
    catch {
        return null;
    }
    if (!isRecord(envelope))
        return null;
    if (envelope.v !== SUPPORTED_SUSPEND_VERSION)
        return null;
    if (!Array.isArray(envelope.d) || envelope.d.length === 0)
        return null;
    const decoded = lzwDecode(envelope.d);
    if (decoded === null)
        return null;
    let payload;
    try {
        payload = JSON.parse(decoded);
    }
    catch {
        return null;
    }
    if (!isRecord(payload))
        return null;
    const progress = isRecord(payload.progress) ? payload.progress : null;
    if (!progress)
        return null;
    if (!isRecord(progress.lessons))
        return null;
    const completed = new Set();
    for (const [key, value] of Object.entries(progress.lessons)) {
        const index = toLessonIndex(key);
        if (index === null)
            continue;
        if (isRecord(value) && (value.c === 1 || value.c === true)) {
            completed.add(index);
        }
    }
    return {
        completedIndices: Array.from(completed).sort((a, b) => a - b),
        cpv: typeof payload.cpv === 'string' && payload.cpv ? payload.cpv : null,
    };
}
exports.parseRiseSuspendData = parseRiseSuspendData;
const RISE_LOCATION_RE = /#\/lessons\/([^/?#]+)/;
function resolveRiseLesson(locationRaw, lessons) {
    if (typeof locationRaw !== 'string' || locationRaw.length === 0)
        return null;
    if (!Array.isArray(lessons) || lessons.length === 0)
        return null;
    const match = RISE_LOCATION_RE.exec(locationRaw);
    if (!match)
        return null;
    let lessonId;
    try {
        lessonId = decodeURIComponent(match[1]);
    }
    catch {
        lessonId = match[1];
    }
    const lesson = lessons.find((l) => l.id === lessonId);
    if (!lesson)
        return null;
    return {
        lessonId: lesson.id,
        lessonIndex: lesson.index,
        lessonTitle: lesson.title,
    };
}
exports.resolveRiseLesson = resolveRiseLesson;
function lzwDecode(codes) {
    const dictionary = new Array(LZW_DICT_SIZE);
    for (let i = 0; i < LZW_DICT_SIZE; i += 1) {
        dictionary[i] = String.fromCharCode(i);
    }
    const first = codes[0];
    if (!isCode(first) || first >= LZW_DICT_SIZE)
        return null;
    let previous = dictionary[first];
    const out = [previous];
    let nextCode = LZW_DICT_SIZE;
    for (let i = 1; i < codes.length; i += 1) {
        const code = codes[i];
        if (!isCode(code))
            return null;
        let current;
        if (code < dictionary.length && dictionary[code] !== undefined) {
            current = dictionary[code];
        }
        else if (code === nextCode) {
            current = previous + previous[0];
        }
        else {
            return null;
        }
        out.push(current);
        dictionary[nextCode] = previous + current[0];
        nextCode += 1;
        previous = current;
    }
    return out.join('');
}
function isCode(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
function toLessonIndex(key) {
    if (!/^(0|[1-9]\d*)$/.test(key))
        return null;
    const index = Number(key);
    return Number.isSafeInteger(index) ? index : null;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=rise-progress.js.map