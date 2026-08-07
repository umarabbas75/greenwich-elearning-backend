import { BadRequestException } from '@nestjs/common';

/**
 * Inline `data:image/...;base64,...` payloads in section HTML are what pushed
 * the sections TOAST table to ~24MB — a single chapter shipped ~12MB per
 * request even though the query itself executed in under a millisecond.
 *
 * Images must be uploaded to Cloudinary (as chapter PDFs already are) and
 * referenced by URL, so this guard rejects rich-text content that still
 * carries them rather than letting the table regrow after the one-off
 * extract-base64-images migration.
 */
const DATA_URI = /data:image\/[a-zA-Z0-9.+-]+;base64,/;

/** Anything above this is almost certainly an embedded asset, not markup. */
const MAX_HTML_BYTES = 512 * 1024;

export function assertNoInlineBase64(
  value: string | null | undefined,
  field = 'description',
): void {
  if (!value) return;

  if (DATA_URI.test(value)) {
    throw new BadRequestException(
      `${field} contains an inline base64 image. Upload the image and reference it by URL instead — ` +
        `embedding it inflates every response for this section.`,
    );
  }

  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > MAX_HTML_BYTES) {
    throw new BadRequestException(
      `${field} is ${(bytes / 1024).toFixed(0)}kB, above the ${
        MAX_HTML_BYTES / 1024
      }kB limit. ` + `Move large embedded assets to file uploads.`,
    );
  }
}
