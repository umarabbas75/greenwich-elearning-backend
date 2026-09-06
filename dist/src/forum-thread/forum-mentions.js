"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMentionedUserIds = void 0;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUserId(value) {
    return UUID_RE.test(value);
}
function parseMentionedUserIds(content) {
    if (!content)
        return [];
    const ids = new Set();
    const attrRe = /data-mention-user-id=["']([^"']+)["']/gi;
    let match;
    while ((match = attrRe.exec(content))) {
        if (isUserId(match[1]))
            ids.add(match[1].toLowerCase());
    }
    const mdRe = /@\[[^\]]+\]\(([^)]+)\)/g;
    while ((match = mdRe.exec(content))) {
        const inner = match[1].trim();
        if (isUserId(inner))
            ids.add(inner.toLowerCase());
    }
    return [...ids];
}
exports.parseMentionedUserIds = parseMentionedUserIds;
//# sourceMappingURL=forum-mentions.js.map