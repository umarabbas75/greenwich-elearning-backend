/**
 * One-off: sweep notifications that reference an assignment or submission
 * that no longer exists. Safe — only deletes rows that point at deleted ids.
 *
 * Defaults to dry run; pass --delete to actually remove them.
 */

import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const rawUrl = process.env.DATABASE_URL ?? '';
const datasourceUrl = rawUrl.includes('pgbouncer=true')
  ? rawUrl
  : rawUrl +
    (rawUrl.includes('?') ? '&' : '?') +
    'pgbouncer=true&connect_timeout=30';

const prisma = new PrismaClient({
  datasources: { db: { url: datasourceUrl } },
});

const shouldDelete = process.argv.includes('--delete');

async function main() {
  console.log(
    `\n🧹 Sweep orphan assignment notifications — ${shouldDelete ? 'DELETE' : 'DRY RUN'}\n`,
  );

  const [assignments, submissions] = await Promise.all([
    prisma.assignment.findMany({ select: { id: true } }),
    prisma.assignmentSubmission.findMany({ select: { id: true } }),
  ]);
  const liveAssignmentIds = new Set(assignments.map((a) => a.id));
  const liveSubmissionIds = new Set(submissions.map((s) => s.id));

  const groupKeyRows = await prisma.notification.findMany({
    where: {
      OR: [
        { groupKey: { startsWith: 'assignment-created:' } },
        { groupKey: { startsWith: 'assignment-submitted:' } },
      ],
    },
    select: { id: true, groupKey: true, type: true },
  });
  const orphanGroupKey = groupKeyRows.filter((n) => {
    if (!n.groupKey) return false;
    const id = n.groupKey.split(':')[1];
    return id && !liveAssignmentIds.has(id);
  });

  const gradedRows = await prisma.notification.findMany({
    where: { type: 'ASSIGNMENT_GRADED' },
    select: { id: true, referenceId: true },
  });
  const orphanGraded = gradedRows.filter(
    (n) => n.referenceId && !liveSubmissionIds.has(n.referenceId),
  );

  const orphanIds = [
    ...orphanGroupKey.map((n) => n.id),
    ...orphanGraded.map((n) => n.id),
  ];

  console.log(
    `Lifecycle orphans (created/submitted by groupKey): ${orphanGroupKey.length}`,
  );
  console.log(
    `Graded orphans (referenceId → missing submission): ${orphanGraded.length}`,
  );
  console.log(`Total orphans to remove: ${orphanIds.length}\n`);

  if (orphanIds.length === 0) {
    console.log('✅ Already clean. Nothing to do.\n');
    return;
  }

  if (!shouldDelete) {
    console.log('ℹ️  Dry run. Pass --delete to actually remove these.\n');
    return;
  }

  const result = await prisma.notification.deleteMany({
    where: { id: { in: orphanIds } },
  });
  console.log(`🗑️  Deleted ${result.count} orphan notification(s).\n`);
}

main()
  .catch((err) => {
    console.error('\n❌ Error:', err.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
