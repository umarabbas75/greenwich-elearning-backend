"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
dotenv.config();
const rawUrl = process.env.DATABASE_URL ?? '';
const datasourceUrl = rawUrl.includes('pgbouncer=true')
    ? rawUrl
    : rawUrl +
        (rawUrl.includes('?') ? '&' : '?') +
        'pgbouncer=true&connect_timeout=30';
const prisma = new client_1.PrismaClient({
    datasources: { db: { url: datasourceUrl } },
});
const shouldDelete = process.argv.includes('--delete');
function parseArg(name) {
    const prefix = `--${name}=`;
    const hit = process.argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
}
const keepPolicy = (parseArg('keep') ?? 'oldest');
if (keepPolicy !== 'oldest' && keepPolicy !== 'most-submissions') {
    throw new Error(`Unknown --keep value: "${keepPolicy}". Use --keep=oldest or --keep=most-submissions.`);
}
const courseFilter = parseArg('course');
const titleFilter = parseArg('title');
function normalizeTitle(t) {
    return (t ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}
async function main() {
    const mode = shouldDelete ? 'DELETE' : 'DRY RUN';
    console.log(`\n🧬 Dedupe assignments script — ${mode}`);
    console.log(`   keep policy: ${keepPolicy}`);
    if (courseFilter)
        console.log(`   course scope: ${courseFilter}`);
    if (titleFilter)
        console.log(`   title scope:  "${titleFilter}"`);
    console.log();
    const all = await prisma.assignment.findMany({
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
    const groups = new Map();
    for (const row of all) {
        const norm = normalizeTitle(row.title);
        if (titleNeedle && norm !== titleNeedle)
            continue;
        const key = `${row.courseId}::${norm}`;
        const bucket = groups.get(key);
        if (bucket)
            bucket.push(row);
        else
            groups.set(key, [row]);
    }
    const dupes = Array.from(groups.values()).filter((g) => g.length > 1);
    if (dupes.length === 0) {
        console.log('No duplicate groups found. Nothing to do.\n');
        return;
    }
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
    console.log(`Found ${totalGroups} duplicate group(s) covering ${totalDrop} row(s) to delete.\n`);
    for (const plan of plans) {
        const { keep, drop } = plan;
        const courseLabel = keep.course?.title?.trim() || `course=${keep.courseId}`;
        console.log(`▸ ${courseLabel} — "${keep.title ?? '(no title)'}"`);
        console.log(`    keep   ${keep.id}  · createdAt=${keep.createdAt.toISOString()}  · submissions=${keep._count.submissions}`);
        for (const row of drop) {
            console.log(`    drop   ${row.id}  · createdAt=${row.createdAt.toISOString()}  · submissions=${row._count.submissions}`);
        }
        console.log();
    }
    if (!shouldDelete) {
        console.log('ℹ️  Dry run. Pass --delete to remove the rows marked "drop" above.\n');
        return;
    }
    for (const { keep, drop } of plans) {
        const droppingWithWork = drop.filter((d) => d._count.submissions > 0);
        if (droppingWithWork.length > 0 && keep._count.submissions === 0) {
            console.error(`✋ Refusing to run: in group "${keep.title}" we'd delete a copy with student submissions while keeping a copy with none.`);
            console.error(`   Re-run with --keep=most-submissions to keep the populated copy instead.\n`);
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
                                type: 'ASSIGNMENT_GRADED',
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
//# sourceMappingURL=dedupe-assignments.js.map