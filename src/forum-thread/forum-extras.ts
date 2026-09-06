import { ForumTagPolicy, Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isAdminRole, slugifyCategoryName } from './forum-policy';

export const MAX_THREAD_TAGS = 8;
export const MAX_THREAD_ATTACHMENTS = 3;
export const THREAD_EXCERPT_MAX = 280;
export const THREAD_LIST_TAKE = 100;

const ALLOWED_ATTACHMENT_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export type ForumAttachmentInput = {
  url: string;
  publicId?: string | null;
  fileName: string;
  mimeType: string;
  bytes?: number | null;
};

const TAG_SELECT = {
  id: true,
  name: true,
  slug: true,
} satisfies Prisma.ForumTagSelect;

export function flattenThreadTags(
  threadTags: { tag: { id: string; name: string; slug: string } }[],
) {
  return threadTags.map((row) => row.tag);
}

export function threadExcerpt(html: string, maxLen = THREAD_EXCERPT_MAX): string {
  const plain = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= maxLen) return plain;
  return plain.slice(0, maxLen).trim();
}

export function parseAttachmentList(raw: unknown): ForumAttachmentInput[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error('attachments must be an array');
  if (raw.length > MAX_THREAD_ATTACHMENTS) {
    throw new Error(`At most ${MAX_THREAD_ATTACHMENTS} attachments are allowed`);
  }
  return raw.map((item, index) => {
    const row = item as Record<string, unknown>;
    const url = String(row?.url ?? '').trim();
    const fileName = String(row?.fileName ?? '').trim();
    const mimeType = String(row?.mimeType ?? '').trim().toLowerCase();
    if (!url || !fileName || !mimeType) {
      throw new Error(`Attachment ${index + 1} needs url, fileName, and mimeType`);
    }
    if (!ALLOWED_ATTACHMENT_MIME.has(mimeType) && !/\.(pdf|docx)$/i.test(fileName)) {
      throw new Error('Attachments must be PDF or DOCX');
    }
    const bytes =
      typeof row.bytes === 'number' && Number.isFinite(row.bytes)
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

export async function resolveTagIds(
  prisma: PrismaService,
  user: User,
  tagPolicy: ForumTagPolicy | undefined,
  body: { tagIds?: unknown; tags?: unknown },
): Promise<string[]> {
  const policy = tagPolicy ?? ForumTagPolicy.FREEFORM;
  const requestedIds = Array.isArray(body.tagIds)
    ? [...new Set(body.tagIds.map((id) => String(id)))]
    : [];
  const names = Array.isArray(body.tags)
    ? body.tags.map((name) => String(name ?? '').trim()).filter(Boolean)
    : [];

  if (policy === ForumTagPolicy.DISABLED) {
    if (requestedIds.length || names.length) {
      throw new Error('Tags are not enabled for this category');
    }
    return [];
  }
  if (!requestedIds.length && !names.length) return [];

  const slugs = [
    ...new Set(names.map((name) => slugifyCategoryName(name)).filter(Boolean)),
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

  const missingBySlug = new Map<string, string>();
  for (const name of names) {
    const slug = slugifyCategoryName(name);
    if (slug && !haveSlug.has(slug)) missingBySlug.set(slug, name);
  }

  if (missingBySlug.size) {
    if (policy === ForumTagPolicy.ADMIN_ONLY && !isAdminRole(user.role)) {
      throw new Error('Only admins can create tags on this board');
    }
    await prisma.forumTag.createMany({
      data: [...missingBySlug.entries()].map(([slug, name]) => ({
        name,
        slug,
        createdByAdminId: isAdminRole(user.role) ? user.id : null,
      })),
      skipDuplicates: true,
    });
    const created = await prisma.forumTag.findMany({
      where: { slug: { in: [...missingBySlug.keys()] } },
      select: { id: true },
    });
    for (const row of created) ids.add(row.id);
  }

  const list = [...ids];
  if (list.length > MAX_THREAD_TAGS) {
    throw new Error(`At most ${MAX_THREAD_TAGS} tags are allowed`);
  }
  return list;
}

export { TAG_SELECT };
