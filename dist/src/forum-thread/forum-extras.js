"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAG_SELECT = exports.resolveTagIds = exports.parseAttachmentList = exports.threadExcerpt = exports.flattenThreadTags = exports.THREAD_LIST_TAKE = exports.THREAD_EXCERPT_MAX = exports.MAX_THREAD_ATTACHMENTS = exports.MAX_THREAD_TAGS = void 0;
const client_1 = require("@prisma/client");
const forum_policy_1 = require("./forum-policy");
exports.MAX_THREAD_TAGS = 8;
exports.MAX_THREAD_ATTACHMENTS = 3;
exports.THREAD_EXCERPT_MAX = 280;
exports.THREAD_LIST_TAKE = 100;
const ALLOWED_ATTACHMENT_MIME = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const TAG_SELECT = {
    id: true,
    name: true,
    slug: true,
};
exports.TAG_SELECT = TAG_SELECT;
function flattenThreadTags(threadTags) {
    return threadTags.map((row) => row.tag);
}
exports.flattenThreadTags = flattenThreadTags;
function threadExcerpt(html, maxLen = exports.THREAD_EXCERPT_MAX) {
    const plain = html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (plain.length <= maxLen)
        return plain;
    return plain.slice(0, maxLen).trim();
}
exports.threadExcerpt = threadExcerpt;
function parseAttachmentList(raw) {
    if (raw == null)
        return [];
    if (!Array.isArray(raw))
        throw new Error('attachments must be an array');
    if (raw.length > exports.MAX_THREAD_ATTACHMENTS) {
        throw new Error(`At most ${exports.MAX_THREAD_ATTACHMENTS} attachments are allowed`);
    }
    return raw.map((item, index) => {
        const row = item;
        const url = String(row?.url ?? '').trim();
        const fileName = String(row?.fileName ?? '').trim();
        const mimeType = String(row?.mimeType ?? '').trim().toLowerCase();
        if (!url || !fileName || !mimeType) {
            throw new Error(`Attachment ${index + 1} needs url, fileName, and mimeType`);
        }
        if (!ALLOWED_ATTACHMENT_MIME.has(mimeType) && !/\.(pdf|docx)$/i.test(fileName)) {
            throw new Error('Attachments must be PDF or DOCX');
        }
        const bytes = typeof row.bytes === 'number' && Number.isFinite(row.bytes)
            ? Math.max(0, Math.round(row.bytes))
            : null;
        return {
            url,
            publicId: row.publicId ? String(row.publicId) : null,
            fileName,
            mimeType: ALLOWED_ATTACHMENT_MIME.has(mimeType)
                ? mimeType
                : fileName.toLowerCase().endsWith('.pdf')
                    ? 'application/pdf'
                    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            bytes,
        };
    });
}
exports.parseAttachmentList = parseAttachmentList;
async function resolveTagIds(prisma, user, tagPolicy, body) {
    const policy = tagPolicy ?? client_1.ForumTagPolicy.FREEFORM;
    const requestedIds = Array.isArray(body.tagIds)
        ? [...new Set(body.tagIds.map((id) => String(id)))]
        : [];
    const names = Array.isArray(body.tags)
        ? body.tags.map((name) => String(name ?? '').trim()).filter(Boolean)
        : [];
    if (policy === client_1.ForumTagPolicy.DISABLED) {
        if (requestedIds.length || names.length) {
            throw new Error('Tags are not enabled for this category');
        }
        return [];
    }
    if (!requestedIds.length && !names.length)
        return [];
    const slugs = [
        ...new Set(names.map((name) => (0, forum_policy_1.slugifyCategoryName)(name)).filter(Boolean)),
    ];
    const existing = await prisma.forumTag.findMany({
        where: {
            OR: [
                ...(requestedIds.length ? [{ id: { in: requestedIds } }] : []),
                ...(slugs.length ? [{ slug: { in: slugs } }] : []),
            ],
        },
        select: { id: true, slug: true },
    });
    const ids = new Set(existing.map((row) => row.id));
    const haveSlug = new Set(existing.map((row) => row.slug));
    const missingBySlug = new Map();
    for (const name of names) {
        const slug = (0, forum_policy_1.slugifyCategoryName)(name);
        if (slug && !haveSlug.has(slug))
            missingBySlug.set(slug, name);
    }
    if (missingBySlug.size) {
        if (policy === client_1.ForumTagPolicy.ADMIN_ONLY && !(0, forum_policy_1.isAdminRole)(user.role)) {
            throw new Error('Only admins can create tags on this board');
        }
        await prisma.forumTag.createMany({
            data: [...missingBySlug.entries()].map(([slug, name]) => ({
                name,
                slug,
                createdByAdminId: (0, forum_policy_1.isAdminRole)(user.role) ? user.id : null,
            })),
            skipDuplicates: true,
        });
        const created = await prisma.forumTag.findMany({
            where: { slug: { in: [...missingBySlug.keys()] } },
            select: { id: true },
        });
        for (const row of created)
            ids.add(row.id);
    }
    const list = [...ids];
    if (list.length > exports.MAX_THREAD_TAGS) {
        throw new Error(`At most ${exports.MAX_THREAD_TAGS} tags are allowed`);
    }
    return list;
}
exports.resolveTagIds = resolveTagIds;
//# sourceMappingURL=forum-extras.js.map