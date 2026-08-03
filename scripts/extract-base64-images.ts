/**
 * Extracts base64 `data:image/*` URIs embedded in `sections.description`,
 * uploads each distinct image to Cloudinary, and rewrites the HTML to point at
 * the CDN URL instead.
 *
 * Why: descriptions carrying inline base64 push the sections TOAST table to
 * ~24MB. One chapter alone ships ~12MB per request even though the query itself
 * executes in well under a millisecond — the wire transfer is the latency.
 *
 * Idempotent + deduplicating: the Cloudinary public_id is derived from the
 * SHA-256 of the decoded bytes, so the same image uploads once no matter how
 * many sections embed it, and re-running the script is a no-op for rows that
 * were already migrated.
 *
 * Usage:
 *   yarn script:extract-images:dry     # report only, uploads nothing, writes nothing
 *   yarn script:extract-images         # upload + rewrite, writes a rollback file
 *   yarn script:extract-images:rollback <rollback-file.json>
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Fallbacks match the values the frontend already uploads with; set the env
// vars explicitly for production runs rather than relying on them.
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME ?? 'dp9urvlsz';
const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET ?? 'my_uploads';
const UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

/** Matches the whole data URI so it can be swapped for a plain URL. */
const DATA_URI_RE = /data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)/g;

const prisma = new PrismaClient();

type Rollback = { id: string; description: string }[];

function extFromMime(mime: string): string {
  const ext = mime.split('/')[1]?.toLowerCase() ?? 'png';
  return ext === 'jpeg' ? 'jpg' : ext.replace(/[^a-z0-9]/g, '');
}

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Upload once per distinct image; cached by content hash for the whole run. */
const uploadCache = new Map<string, string>();

async function uploadToCloudinary(
  buf: Buffer,
  mime: string,
  hash: string,
): Promise<string> {
  const cached = uploadCache.get(hash);
  if (cached) return cached;

  const publicId = `section-img-${hash.slice(0, 32)}`;
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), `${publicId}.${extFromMime(mime)}`);
  form.append('upload_preset', UPLOAD_PRESET);
  form.append('public_id', publicId);
  // NOTE: `overwrite` is rejected by Cloudinary on unsigned uploads. It isn't
  // needed anyway — public_id is the content hash, so re-uploading the same
  // bytes to the same id is naturally idempotent.

  const res = await fetch(UPLOAD_URL, { method: 'POST', body: form });
  const json: any = await res.json();
  if (!res.ok || !json?.secure_url) {
    throw new Error(
      `Cloudinary upload failed (${res.status}): ${json?.error?.message ?? JSON.stringify(json).slice(0, 200)}`,
    );
  }

  uploadCache.set(hash, json.secure_url);
  return json.secure_url;
}

async function rollback(file: string): Promise<void> {
  const entries: Rollback = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`Restoring ${entries.length} section description(s) from ${file}\n`);
  for (const { id, description } of entries) {
    await prisma.section.update({ where: { id }, data: { description } });
    console.log(`  restored ${id}`);
  }
  console.log('\nRollback complete.');
}

async function main() {
  const args = process.argv.slice(2);
  const rollbackIdx = args.indexOf('--rollback');
  if (rollbackIdx !== -1) {
    const file = args[rollbackIdx + 1];
    if (!file) throw new Error('--rollback requires a path to the rollback JSON');
    await rollback(file);
    return;
  }

  const apply = args.includes('--apply');
  console.log(
    apply
      ? '=== APPLY: uploading images and rewriting descriptions ===\n'
      : '=== DRY RUN: no uploads, no writes (pass --apply to execute) ===\n',
  );

  const sections = await prisma.section.findMany({
    where: { description: { contains: 'data:image' } },
    select: { id: true, chapterId: true, description: true },
  });

  console.log(`Found ${sections.length} section(s) with embedded images\n`);

  const rollbackData: Rollback = [];
  let totalBefore = 0;
  let totalAfter = 0;
  let totalImages = 0;
  let failures = 0;

  for (const section of sections) {
    const original = section.description ?? '';
    const before = Buffer.byteLength(original, 'utf8');
    totalBefore += before;

    // Collect matches first so uploads can be awaited outside the regex loop.
    const matches = [...original.matchAll(DATA_URI_RE)];
    if (matches.length === 0) continue;

    let rewritten = original;
    let replaced = 0;
    // All-or-nothing per section: a half-rewritten description (some CDN URLs,
    // some base64 left behind) is worse than leaving the row untouched, because
    // a re-run can no longer tell migrated content from unmigrated content.
    let sectionFailed = false;

    for (const match of matches) {
      const [full, mime, b64] = match;
      const buf = Buffer.from(b64.replace(/\s/g, ''), 'base64');
      const hash = createHash('sha256').update(buf).digest('hex');

      if (!apply) {
        totalImages++;
        // Approximate the post-migration size with a representative URL length.
        rewritten = rewritten.replace(
          full,
          `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/v0000000000/${UPLOAD_PRESET}/section-img-${hash.slice(0, 32)}.${extFromMime(mime)}`,
        );
        replaced++;
        continue;
      }

      try {
        const url = await uploadToCloudinary(buf, mime, hash);
        rewritten = rewritten.replace(full, url);
        replaced++;
      } catch (err) {
        failures++;
        sectionFailed = true;
        console.error(
          `  ! ${section.id}: upload failed for ${human(buf.length)} ${mime} — ${(err as Error).message}`,
        );
        break;
      }
    }

    if (apply && sectionFailed) {
      // Leave the row exactly as it was; re-running retries it cleanly.
      totalAfter += before;
      console.log(
        `  ${section.id}  SKIPPED (upload failure) — row left unchanged, re-run to retry`,
      );
      continue;
    }

    if (apply) totalImages += replaced;

    const after = Buffer.byteLength(rewritten, 'utf8');
    totalAfter += after;

    console.log(
      `  ${section.id}  imgs:${replaced}  ${human(before)} -> ${human(after)}  (-${(((before - after) / before) * 100).toFixed(1)}%)`,
    );

    if (apply && rewritten !== original) {
      rollbackData.push({ id: section.id, description: original });
      await prisma.section.update({
        where: { id: section.id },
        data: { description: rewritten },
      });
    }
  }

  console.log(
    `\n${sections.length} section(s), ${totalImages} image(s)` +
      `\ntotal: ${human(totalBefore)} -> ${human(totalAfter)}` +
      (totalBefore > 0
        ? `  (-${(((totalBefore - totalAfter) / totalBefore) * 100).toFixed(1)}%)`
        : ''),
  );
  if (failures > 0) console.log(`FAILURES: ${failures} image(s) not migrated`);

  if (apply && rollbackData.length > 0) {
    const dir = join(process.cwd(), 'backups', 'image-migration');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(dir, `rollback-${stamp}.json`);
    writeFileSync(file, JSON.stringify(rollbackData, null, 2));
    console.log(`\nRollback file: ${file}`);
    console.log(`Restore with: yarn script:extract-images:rollback ${file}`);
  }

  if (!apply) console.log('\nNo changes made. Re-run with --apply to execute.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
