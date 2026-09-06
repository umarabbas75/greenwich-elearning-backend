import { ForumTagPolicy, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
export declare const MAX_THREAD_TAGS = 8;
export declare const MAX_THREAD_ATTACHMENTS = 3;
export declare const THREAD_EXCERPT_MAX = 280;
export declare const THREAD_LIST_TAKE = 100;
export type ForumAttachmentInput = {
    url: string;
    publicId?: string | null;
    fileName: string;
    mimeType: string;
    bytes?: number | null;
};
declare const TAG_SELECT: {
    id: true;
    name: true;
    slug: true;
};
export declare function flattenThreadTags(threadTags: {
    tag: {
        id: string;
        name: string;
        slug: string;
    };
}[]): {
    id: string;
    name: string;
    slug: string;
}[];
export declare function threadExcerpt(html: string, maxLen?: number): string;
export declare function parseAttachmentList(raw: unknown): ForumAttachmentInput[];
export declare function resolveTagIds(prisma: PrismaService, user: User, tagPolicy: ForumTagPolicy | undefined, body: {
    tagIds?: unknown;
    tags?: unknown;
}): Promise<string[]>;
export { TAG_SELECT };
