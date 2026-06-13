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
async function main() {
    console.log('\n🔎 Assignment cleanup verification\n');
    const assignments = await prisma.assignment.findMany({
        select: {
            id: true,
            title: true,
            courseId: true,
            createdAt: true,
            _count: { select: { submissions: true } },
        },
        orderBy: { createdAt: 'asc' },
    });
    const liveIds = new Set(assignments.map((a) => a.id));
    console.log(`Live assignments: ${assignments.length}`);
    for (const a of assignments) {
        console.log(`  - ${a.id}  · "${a.title}"  · submissions=${a._count.submissions}  · createdAt=${a.createdAt.toISOString()}`);
    }
    console.log();
    const allSubmissions = await prisma.assignmentSubmission.findMany({
        select: { id: true, assignmentId: true },
    });
    const orphanSubs = allSubmissions.filter((s) => !liveIds.has(s.assignmentId));
    console.log(`Submissions total: ${allSubmissions.length}  · orphans: ${orphanSubs.length}`);
    if (orphanSubs.length) {
        for (const s of orphanSubs.slice(0, 10)) {
            console.log(`  ! orphan submission ${s.id} → assignment ${s.assignmentId}`);
        }
        if (orphanSubs.length > 10)
            console.log(`  …and ${orphanSubs.length - 10} more`);
    }
    console.log();
    const groupKeyNotifications = await prisma.notification.findMany({
        where: {
            OR: [
                { groupKey: { startsWith: 'assignment-created:' } },
                { groupKey: { startsWith: 'assignment-submitted:' } },
            ],
        },
        select: {
            id: true,
            type: true,
            groupKey: true,
            userId: true,
            createdAt: true,
        },
    });
    const orphanGroupKey = groupKeyNotifications.filter((n) => {
        if (!n.groupKey)
            return false;
        const id = n.groupKey.split(':')[1];
        return id && !liveIds.has(id);
    });
    console.log(`Lifecycle notifications (created/submitted): ${groupKeyNotifications.length}  · orphans: ${orphanGroupKey.length}`);
    if (orphanGroupKey.length) {
        for (const n of orphanGroupKey.slice(0, 10)) {
            console.log(`  ! orphan ${n.type}  groupKey=${n.groupKey}  user=${n.userId}  at ${n.createdAt.toISOString()}`);
        }
        if (orphanGroupKey.length > 10)
            console.log(`  …and ${orphanGroupKey.length - 10} more`);
    }
    console.log();
    const liveSubIds = new Set(allSubmissions.map((s) => s.id));
    const gradedNotifications = await prisma.notification.findMany({
        where: { type: 'ASSIGNMENT_GRADED' },
        select: { id: true, referenceId: true, userId: true, createdAt: true },
    });
    const orphanGraded = gradedNotifications.filter((n) => n.referenceId && !liveSubIds.has(n.referenceId));
    console.log(`ASSIGNMENT_GRADED notifications: ${gradedNotifications.length}  · orphans: ${orphanGraded.length}`);
    if (orphanGraded.length) {
        for (const n of orphanGraded.slice(0, 10)) {
            console.log(`  ! orphan graded  refSubmissionId=${n.referenceId}  user=${n.userId}  at ${n.createdAt.toISOString()}`);
        }
        if (orphanGraded.length > 10)
            console.log(`  …and ${orphanGraded.length - 10} more`);
    }
    console.log();
    const allGood = orphanSubs.length === 0 &&
        orphanGroupKey.length === 0 &&
        orphanGraded.length === 0;
    console.log(allGood ? '✅ Clean — no orphans found.\n' : '⚠️  Orphans detected — see above.\n');
}
main()
    .catch((err) => {
    console.error('\n❌ Error:', err.message ?? err);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=_verify-assignment-cleanup.js.map