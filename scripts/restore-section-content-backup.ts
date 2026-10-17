/**
 * Restore a section row from a JSON backup created under backups/section-content/.
 *
 * Usage:
 *   yarn script:section-restore -- --dry-run
 *   yarn script:section-restore -- --restore
 *
 * Optional env:
 *   SECTION_BACKUP_FILE=path/to/backup.json
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';

dotenv.config();

const DEFAULT_BACKUP = path.join(
  process.cwd(),
  'backups/section-content',
  '420216c7-aa99-4d5b-a9c2-2e73abe5ba06_why-health-and-safety-matters_2026-10-03.json',
);

type SectionBackup = {
  backupVersion: number;
  exportedAt: string;
  sectionId: string;
  context?: {
    course?: { id: string; title: string };
    module?: { id: string; title: string };
    chapter?: { id: string; title: string };
  };
  section: Record<string, unknown>;
};

const rawUrl = process.env.DATABASE_URL ?? '';
const datasourceUrl = rawUrl.includes('pgbouncer=true')
  ? rawUrl
  : rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'pgbouncer=true&connect_timeout=30';

const prisma = new PrismaClient({ datasources: { db: { url: datasourceUrl } } });

function loadBackup(filePath: string): SectionBackup {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw) as SectionBackup;
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
  console.log(
    'Description   :',
    typeof sectionFields.description === 'string'
      ? `${(sectionFields.description as string).length} chars`
      : 'missing',
  );

  const updateData: Prisma.SectionUpdateInput = {
    title: sectionFields.title as string,
    description: sectionFields.description as string,
    shortDescription: sectionFields.shortDescription as string | null,
    type: sectionFields.type as Prisma.SectionUpdateInput['type'],
    orderIndex: sectionFields.orderIndex as number | null,
    itemLabel: sectionFields.itemLabel as string | null,
    categoryLabel: sectionFields.categoryLabel as string | null,
    categories: sectionFields.categories as string[],
    maxPerCategory: sectionFields.maxPerCategory as number,
    isActive: sectionFields.isActive as boolean,
    isArchived: sectionFields.isArchived as boolean,
    archivedAt: sectionFields.archivedAt
      ? new Date(sectionFields.archivedAt as string)
      : null,
    questionText: sectionFields.questionText as string | null,
    imageUrl: sectionFields.imageUrl as string | null,
    allowMultipleSelection: sectionFields.allowMultipleSelection as boolean,
    items: sectionFields.items as Prisma.InputJsonValue,
    options: sectionFields.options as Prisma.InputJsonValue,
    config: sectionFields.config as Prisma.InputJsonValue,
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
