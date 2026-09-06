export type NestableComment = {
  id: string;
  parentId?: string | null;
  createdAt?: Date | string;
  isAccepted?: boolean;
  voteScore?: number;
};

function createdAtMs(value: Date | string | undefined) {
  if (!value) return 0;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function sortRoots<T extends NestableComment>(comments: T[], sort?: string) {
  const copy = [...comments];
  copy.sort((a, b) => {
    const accepted = Number(!!b.isAccepted) - Number(!!a.isAccepted);
    if (accepted) return accepted;
    if (sort !== 'latest') {
      const score = (b.voteScore ?? 0) - (a.voteScore ?? 0);
      if (score) return score;
    }
    return createdAtMs(b.createdAt) - createdAtMs(a.createdAt);
  });
  return copy;
}

/** One query’s flat rows → roots with `replies` (conversation order). */
export function nestForumComments<T extends NestableComment>(
  comments: T[],
  sort?: string,
): (T & { replies: T[] })[] {
  const repliesByParent = new Map<string, T[]>();
  const roots: T[] = [];

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
    if (!rootIds.has(parentId)) roots.push(...list);
  }

  return sortRoots(roots, sort).map((root) => ({
    ...root,
    replies: repliesByParent.get(root.id) ?? [],
  }));
}
