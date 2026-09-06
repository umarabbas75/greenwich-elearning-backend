const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUserId(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Pull mentioned user ids out of stored HTML/markdown.
 * Supported shapes (FE can use either):
 *   <span data-mention-user-id="uuid">@Name</span>
 *   @[Display Name](uuid)
 */
export function parseMentionedUserIds(content: string | null | undefined): string[] {
  if (!content) return [];
  const ids = new Set<string>();

  const attrRe = /data-mention-user-id=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(content))) {
    if (isUserId(match[1])) ids.add(match[1].toLowerCase());
  }

  const mdRe = /@\[[^\]]+\]\(([^)]+)\)/g;
  while ((match = mdRe.exec(content))) {
    const inner = match[1].trim();
    if (isUserId(inner)) ids.add(inner.toLowerCase());
  }

  return [...ids];
}
