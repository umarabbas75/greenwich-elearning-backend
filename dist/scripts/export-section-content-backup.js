"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const client_1 = require("@prisma/client");
dotenv.config();
const SECTION_ID = process.env.SECTION_ID ?? '420216c7-aa99-4d5b-a9c2-2e73abe5ba06';
const rawUrl = process.env.DATABASE_URL ?? '';
const datasourceUrl = rawUrl.includes('pgbouncer=true')
    ? rawUrl
    : rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'pgbouncer=true&connect_timeout=30';
const prisma = new client_1.PrismaClient({ datasources: { db: { url: datasourceUrl } } });
function slugify(title) {
    return title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);
}
async function main() {
    const section = await prisma.section.findUnique({
        where: { id: SECTION_ID },
        include: {
            chapter: {
                include: {
                    module: { include: { course: { select: { id: true, title: true } } } },
                },
            },
        },
    });
    if (!section) {
        throw new Error(`Section not found: ${SECTION_ID}`);
    }
    const { chapter, createdAt, updatedAt, id, ...restorable } = section;
    const date = new Date().toISOString().slice(0, 10);
    const slug = slugify(section.title);
    const dir = path.join(process.cwd(), 'backups/section-content');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}_${slug}_${date}.json`);
    const payload = {
        backupVersion: 1,
        exportedAt: new Date().toISOString(),
        sectionId: id,
        context: {
            course: { id: chapter.module.course.id, title: chapter.module.course.title },
            module: { id: chapter.module.id, title: chapter.module.title },
            chapter: { id: chapter.id, title: chapter.title },
        },
        section: {
            ...restorable,
            createdAt: createdAt.toISOString(),
            updatedAt: updatedAt.toISOString(),
        },
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    console.log('Wrote', file);
}
main()
    .catch((err) => {
    console.error(err);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=export-section-content-backup.js.map