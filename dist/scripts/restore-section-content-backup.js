"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const client_1 = require("@prisma/client");
dotenv.config();
const DEFAULT_BACKUP = path.join(process.cwd(), 'backups/section-content', '420216c7-aa99-4d5b-a9c2-2e73abe5ba06_why-health-and-safety-matters_2026-10-03.json');
const rawUrl = process.env.DATABASE_URL ?? '';
const datasourceUrl = rawUrl.includes('pgbouncer=true')
    ? rawUrl
    : rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'pgbouncer=true&connect_timeout=30';
const prisma = new client_1.PrismaClient({ datasources: { db: { url: datasourceUrl } } });
function loadBackup(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (data.backupVersion !== 1 || !data.sectionId || !data.section) {
        throw new Error(`Invalid backup format: ${filePath}`);
    }
    return data;
}
async function main() {
    const backupFile = process.env.SECTION_BACKUP_FILE ?? DEFAULT_BACKUP;
    if (!fs.existsSync(backupFile)) {
        throw new Error(`Backup file not found: ${backupFile}`);
    }
    const isRestore = process.argv.includes('--restore');
    const isDryRun = process.argv.includes('--dry-run') || !isRestore;
    const backup = loadBackup(backupFile);
    const { sectionId, section: sectionFields, context, exportedAt } = backup;
    const existing = await prisma.section.findUnique({
        where: { id: sectionId },
        select: { id: true, title: true, updatedAt: true },
    });
    if (!existing) {
        throw new Error(`Section ${sectionId} not found in database — cannot restore.`);
    }
    console.log('Backup file   :', backupFile);
    console.log('Exported at   :', exportedAt);
    if (context?.course) {
        console.log('Course        :', context.course.title, `(${context.course.id})`);
    }
    if (context?.chapter) {
        console.log('Chapter       :', context.chapter.title, `(${context.chapter.id})`);
    }
    console.log('Section id    :', sectionId);
    console.log('Backup title  :', sectionFields.title);
    console.log('DB title now  :', existing.title);
    console.log('DB updatedAt  :', existing.updatedAt.toISOString());
    console.log('Description   :', typeof sectionFields.description === 'string'
        ? `${sectionFields.description.length} chars`
        : 'missing');
    const updateData = {
        title: sectionFields.title,
        description: sectionFields.description,
        shortDescription: sectionFields.shortDescription,
        type: sectionFields.type,
        orderIndex: sectionFields.orderIndex,
        itemLabel: sectionFields.itemLabel,
        categoryLabel: sectionFields.categoryLabel,
        categories: sectionFields.categories,
        maxPerCategory: sectionFields.maxPerCategory,
        isActive: sectionFields.isActive,
        isArchived: sectionFields.isArchived,
        archivedAt: sectionFields.archivedAt
            ? new Date(sectionFields.archivedAt)
            : null,
        questionText: sectionFields.questionText,
        imageUrl: sectionFields.imageUrl,
        allowMultipleSelection: sectionFields.allowMultipleSelection,
        items: sectionFields.items,
        options: sectionFields.options,
        config: sectionFields.config,
    };
    if (isDryRun) {
        console.log('\nDry run only — no changes written. Pass --restore to apply.');
        return;
    }
    await prisma.section.update({
        where: { id: sectionId },
        data: updateData,
    });
    console.log('\nRestored section content from backup.');
}
main()
    .catch((err) => {
    console.error(err);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=restore-section-content-backup.js.map