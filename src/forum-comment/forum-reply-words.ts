export const FORUM_REPLY_MAX_WORDS = 300;

/** Visible text only — tags, entities, and images do not count as words. */
export function forumReplyPlainText(html: string): string {
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

export function countForumReplyWords(html: string | null | undefined): number {
  const text = forumReplyPlainText(String(html ?? ''));
  if (!text) return 0;
  return text.split(' ').filter(Boolean).length;
}

export function assertForumReplyWordLimit(html: string) {
  const words = countForumReplyWords(html);
  if (words === 0) {
    throw new Error('content is required');
  }
  if (words > FORUM_REPLY_MAX_WORDS) {
    throw new Error(
      `Replies can be at most ${FORUM_REPLY_MAX_WORDS} words`,
    );
  }
}
