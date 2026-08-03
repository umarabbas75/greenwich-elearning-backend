"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME ?? 'dp9urvlsz';
const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET ?? 'my_uploads';
const UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
const DATA_URI_RE = /data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)/g;
const prisma = new client_1.PrismaClient();
function extFromMime(mime) {
    const ext = mime.split('/')[1]?.toLowerCase() ?? 'png';
    return ext === 'jpeg' ? 'jpg' : ext.replace(/[^a-z0-9]/g, '');
}
function human(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(0)} kB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
const uploadCache = new Map();
async function uploadToCloudinary(buf, mime, hash) {
    const cached = uploadCache.get(hash);
    if (cached)
        return cached;
    const publicId = `section-img-${hash.slice(0, 32)}`;
    const form = new FormData();
    form.append('file', new Blob([buf], { type: mime }), `${publicId}.${extFromMime(mime)}`);
    form.append('upload_preset', UPLOAD_PRESET);
    form.append('public_id', publicId);
    const res = await fetch(UPLOAD_URL, { method: 'POST', body: form });
    const json = await res.json();
    if (!res.ok || !json?.secure_url) {
        throw new Error(`Cloudinary upload failed (${res.status}): ${json?.error?.message ?? JSON.stringify(json).slice(0, 200)}`);
    }
    uploadCache.set(hash, json.secure_url);
    return json.secure_url;
}
async function rollback(file) {
    const entries = JSON.parse((0, fs_1.readFileSync)(file, 'utf8'));
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
        if (!file)
            throw new Error('--rollback requires a path to the rollback JSON');
        await rollback(file);
        return;
    }
    const apply = args.includes('--apply');
    console.log(apply
        ? '=== APPLY: uploading images and rewriting descriptions ===\n'
        : '=== DRY RUN: no uploads, no writes (pass --apply to execute) ===\n');
    const sections = await prisma.section.findMany({
        where: { description: { contains: 'data:image' } },
        select: { id: true, chapterId: true, description: true },
    });
    console.log(`Found ${sections.length} section(s) with embedded images\n`);
    const rollbackData = [];
    let totalBefore = 0;
    let totalAfter = 0;
    let totalImages = 0;
    let failures = 0;
    for (const section of sections) {
        const original = section.description ?? '';
        const before = Buffer.byteLength(original, 'utf8');
        totalBefore += before;
        const matches = [...original.matchAll(DATA_URI_RE)];
        if (matches.length === 0)
            continue;
        let rewritten = original;
        let replaced = 0;
        let sectionFailed = false;
        for (const match of matches) {
            const [full, mime, b64] = match;
            const buf = Buffer.from(b64.replace(/\s/g, ''), 'base64');
            const hash = (0, crypto_1.createHash)('sha256').update(buf).digest('hex');
            if (!apply) {
                totalImages++;
                rewritten = rewritten.replace(full, `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/v0000000000/${UPLOAD_PRESET}/section-img-${hash.slice(0, 32)}.${extFromMime(mime)}`);
                replaced++;
                continue;
            }
            try {
                const url = await uploadToCloudinary(buf, mime, hash);
                rewritten = rewritten.replace(full, url);
                replaced++;
            }
            catch (err) {
                failures++;
                sectionFailed = true;
                console.error(`  ! ${section.id}: upload failed for ${human(buf.length)} ${mime} — ${err.message}`);
                break;
            }
        }
        if (apply && sectionFailed) {
            totalAfter += before;
            console.log(`  ${section.id}  SKIPPED (upload failure) — row left unchanged, re-run to retry`);
            continue;
        }
        if (apply)
            totalImages += replaced;
        const after = Buffer.byteLength(rewritten, 'utf8');
        totalAfter += after;
        console.log(`  ${section.id}  imgs:${replaced}  ${human(before)} -> ${human(after)}  (-${(((before - after) / before) * 100).toFixed(1)}%)`);
        if (apply && rewritten !== original) {
            rollbackData.push({ id: section.id, description: original });
            await prisma.section.update({
                where: { id: section.id },
                data: { description: rewritten },
            });
        }
    }
    console.log(`\n${sections.length} section(s), ${totalImages} image(s)` +
        `\ntotal: ${human(totalBefore)} -> ${human(totalAfter)}` +
        (totalBefore > 0
            ? `  (-${(((totalBefore - totalAfter) / totalBefore) * 100).toFixed(1)}%)`
            : ''));
    if (failures > 0)
        console.log(`FAILURES: ${failures} image(s) not migrated`);
    if (apply && rollbackData.length > 0) {
        const dir = (0, path_1.join)(process.cwd(), 'backups', 'image-migration');
        (0, fs_1.mkdirSync)(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = (0, path_1.join)(dir, `rollback-${stamp}.json`);
        (0, fs_1.writeFileSync)(file, JSON.stringify(rollbackData, null, 2));
        console.log(`\nRollback file: ${file}`);
        console.log(`Restore with: yarn script:extract-images:rollback ${file}`);
    }
    if (!apply)
        console.log('\nNo changes made. Re-run with --apply to execute.');
}
main()
    .catch((err) => {
    console.error(err);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=extract-base64-images.js.map