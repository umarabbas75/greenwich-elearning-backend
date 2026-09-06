"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nestForumComments = void 0;
function createdAtMs(value) {
    if (!value)
        return 0;
    const ms = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
}
function sortRoots(comments, sort) {
    const copy = [...comments];
    copy.sort((a, b) => {
        const accepted = Number(!!b.isAccepted) - Number(!!a.isAccepted);
        if (accepted)
            return accepted;
        if (sort !== 'latest') {
            const score = (b.voteScore ?? 0) - (a.voteScore ?? 0);
            if (score)
                return score;
        }
        return createdAtMs(b.createdAt) - createdAtMs(a.createdAt);
    });
    return copy;
}
function nestForumComments(comments, sort) {
    const repliesByParent = new Map();
    const roots = [];
    for (const comment of comments) {
        if (!comment.parentId) {
            roots.push(comment);
            continue;
        }
        const list = repliesByParent.get(comment.parentId) ?? [];
        list.push(comment);
        repliesByParent.set(comment.parentId, list);
    }
    for (const list of repliesByParent.values()) {
        list.sort((a, b) => createdAtMs(a.createdAt) - createdAtMs(b.createdAt));
    }
    const rootIds = new Set(roots.map((row) => row.id));
    for (const [parentId, list] of repliesByParent) {
        if (!rootIds.has(parentId))
            roots.push(...list);
    }
    return sortRoots(roots, sort).map((root) => ({
        ...root,
        replies: repliesByParent.get(root.id) ?? [],
    }));
}
exports.nestForumComments = nestForumComments;
//# sourceMappingURL=forum-comment-tree.js.map