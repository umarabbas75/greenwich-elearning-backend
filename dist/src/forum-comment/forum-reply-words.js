"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertForumReplyWordLimit = exports.countForumReplyWords = exports.forumReplyPlainText = exports.FORUM_REPLY_MAX_WORDS = void 0;
exports.FORUM_REPLY_MAX_WORDS = 300;
function forumReplyPlainText(html) {
    return html
        .replace(/<img\b[^>]*>/gi, ' ')
        .replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
exports.forumReplyPlainText = forumReplyPlainText;
function countForumReplyWords(html) {
    const text = forumReplyPlainText(String(html ?? ''));
    if (!text)
        return 0;
    return text.split(' ').filter(Boolean).length;
}
exports.countForumReplyWords = countForumReplyWords;
function assertForumReplyWordLimit(html) {
    const words = countForumReplyWords(html);
    if (words === 0) {
        throw new Error('content is required');
    }
    if (words > exports.FORUM_REPLY_MAX_WORDS) {
        throw new Error(`Replies can be at most ${exports.FORUM_REPLY_MAX_WORDS} words`);
    }
}
exports.assertForumReplyWordLimit = assertForumReplyWordLimit;
//# sourceMappingURL=forum-reply-words.js.map