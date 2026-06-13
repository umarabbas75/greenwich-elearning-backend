/**
 * dedupe-assignments.ts
 *
 * Find groups of assignments that look identical (same courseId + same
 * normalized title) and keep ONE per group, deleting the rest with the same
 * full cleanup the admin delete API performs:
 *   - all student submissions and their attachments (FK cascade)
 *   - the assignment's admin attachment rows (FK cascade)
 *   - every in-app notification raised over the assignment's lifecycle
 *
 * Defaults to a dry run that prints each group and which row would be kept
 * vs deleted. Pass --delete to actually do it.
 *
 * Keep policy:
 *   --keep=oldest             (default) keep the earliest createdAt — preserves
 *                             whichever copy students may have submitted to
 *   --keep=most-submissions   keep whichever copy has the most submissions,
 *                             ties broken by oldest createdAt
 *
 * Scope flags (combine as needed):
 *   --course=<courseId>       only consider assignments in this course
 *   --title="<exact title>"   only consider assignments with this title
 *                             (after the same normalization the grouper uses)
 *
 * Usage:
 *   yarn script:dedupe-assignments:dry
 *   yarn script:dedupe-assignments:dry --course=<id>
 *   yarn script:dedupe-assignments --keep=most-submissions
 *
 * Safety: title comparison is case-insensitive and trims/collapses
 * whitespace; description / attachments / dueAt etc. are NOT compared, since
 * the client confirmed the duplicates were genuine accidental retries. If you
 * want a stricter content comparison, restrict the run with --title or
 * --course before passing --delete.
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

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

type KeepPolicy = 'oldest' | 'most-submissions';

const keepPolicy = (parseArg('keep') ?? 'oldest') as KeepPolicy;
if (keepPolicy !== 'oldest' && keepPolicy !== 'most-submissions') {
  throw new Error(
    `Unknown --keep value: "${keepPolicy}". Use --keep=oldest or --keep=most-submissions.`,
  );
}

const courseFilter = parseArg('course');
const titleFilter = parseArg('title');

function normalizeTitle(t: string | null | undefined): string {
  return (t ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

type AssignmentRow = {
  id: string;
  title: string | null;
  courseId: string;
  createdAt: Date;
  course: { title: string } | null;
  _count: { submissions: number };
};

async function main() {
  const mode = shouldDelete ? 'DELETE' : 'DRY RUN';
  console.log(`\n🧬 Dedupe assignments script — ${mode}`);
  console.log(`   keep policy: ${keepPolicy}`);
  if (courseFilter) console.log(`   course scope: ${courseFilter}`);
  if (titleFilter) console.log(`   title scope:  "${titleFilter}"`);
  console.log();

  const all: AssignmentRow[] = await prisma.assignment.findMany({
    where: courseFilter ? { courseId: courseFilter } : undefined,
    select: {
      id: true,
      title: true,
      courseId: true,
      createdAt: true,
      course: { select: { title: true } },
      _count: { select: { submissions: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const titleNeedle = titleFilter ? normalizeTitle(titleFilter) : null;

  const groups = new Map<string, AssignmentRow[]>();
  for (const row of all) {
    const norm = normalizeTitle(row.title);
    if (titleNeedle && norm !== titleNeedle) continue;
    const key = `${row.courseId}::${norm}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const dupes = Array.from(groups.values()).filter((g) => g.length > 1);

  if (dupes.length === 0) {
    console.log('No duplicate groups found. Nothing to do.\n');
    return;
  }

  // Decide which row to keep per group.
  const plans = dupes.map((group) => {
    const sorted = [...group].sort((a, b) => {
      if (keepPolicy === 'most-submissions') {
        if (a._count.submissions !== b._count.submissions) {
          return b._count.submissions - a._count.submissions;
        }
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const keep = sorted[0];
    const drop = sorted.slice(1);
    return { keep, drop };
  });

  const totalDrop = plans.reduce((n, p) => n + p.drop.length, 0);
  const totalGroups = plans.length;

  console.log(
    `Found ${totalGroups} duplicate group(s) covering ${totalDrop} row(s) to delete.\n`,
  );

  for (const plan of plans) {
    const { keep, drop } = plan;
    const courseLabel =
      keep.course?.title?.trim() || `course=${keep.courseId}`;
    console.log(`▸ ${courseLabel} — "${keep.title ?? '(no title)'}"`);
    console.log(
      `    keep   ${keep.id}  · createdAt=${keep.createdAt.toISOString()}  · submissions=${keep._count.submissions}`,
    );
    for (const row of drop) {
      console.log(
        `    drop   ${row.id}  · createdAt=${row.createdAt.toISOString()}  · submissions=${row._count.submissions}`,
      );
    }
    console.log();
  }

  if (!shouldDelete) {
    console.log(
      'ℹ️  Dry run. Pass --delete to remove the rows marked "drop" above.\n',
    );
    return;
  }

  // Sanity guard: refuse to delete a copy that has submissions while a
  // submission-less copy is being kept — that would lose student work.
  for (const { keep, drop } of plans) {
    const droppingWithWork = drop.filter((d) => d._count.submissions > 0);
    if (droppingWithWork.length > 0 && keep._count.submissions === 0) {
      console.error(
        `✋ Refusing to run: in group "${keep.title}" we'd delete a copy with student submissions while keeping a copy with none.`,
      );
      console.error(
        `   Re-run with --keep=most-submissions to keep the populated copy instead.\n`,
      );
      process.exit(2);
    }
  }

  console.log('Deleting…\n');

  const dropIds = plans.flatMap((p) => p.drop.map((d) => d.id));

  const submissionIdRows = await prisma.assignmentSubmission.findMany({
    where: { assignmentId: { in: dropIds } },
    select: { id: true },
  });
  const submissionIds = submissionIdRows.map((s) => s.id);

  const groupKeyConditions = dropIds.flatMap((id) => [
    { groupKey: `assignment-created:${id}` },
    { groupKey: `assignment-submitted:${id}` },
  ]);

  const result = await prisma.$transaction(async (tx) => {
    const notifications = await tx.notification.deleteMany({
      where: {
        OR: [
          ...groupKeyConditions,
          ...(submissionIds.length
            ? [
                {
                  type: 'ASSIGNMENT_GRADED' as const,
                  referenceId: { in: submissionIds },
                },
              ]
            : []),
        ],
      },
    });
    const submissions = await tx.assignmentSubmission.deleteMany({
      where: { assignmentId: { in: dropIds } },
    });
    const assignments = await tx.assignment.deleteMany({
      where: { id: { in: dropIds } },
    });
    return {
      notifications: notifications.count,
      submissions: submissions.count,
      assignments: assignments.count,
    };
  });

  console.log('🗑️  Deleted:');
  console.log(`  ✓ ${result.notifications} notifications (bell entries)`);
  console.log(`  ✓ ${result.submissions} assignment_submissions`);
  console.log(`  ✓ ${result.assignments} assignments`);
  console.log('\n✅ Done.\n');
}

main()
  .catch((err) => {
    console.error('\n❌ Error:', err.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
