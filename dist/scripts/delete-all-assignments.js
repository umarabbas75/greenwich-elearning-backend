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
const hasConfirm = process.argv.includes('--confirm');
function parseArg(name) {
    const prefix = `--${name}=`;
    const hit = process.argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
}
async function resolveScope() {
    const courseId = parseArg('course');
    if (!courseId)
        return { scope: 'all' };
    const course = await prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true, title: true },
    });
    if (!course) {
        throw new Error(`No course found with id=${courseId}`);
    }
    return { scope: 'course', course };
}
async function main() {
    const mode = shouldDelete ? 'DELETE' : 'DRY RUN';
    console.log(`\n🧨 Delete-all assignments script — ${mode}\n`);
    const resolved = await resolveScope();
    const assignmentWhere = resolved.scope === 'course'
        ? { courseId: resolved.course.id }
        : undefined;
    const assignmentIds = (await prisma.assignment.findMany({
        where: assignmentWhere,
        select: { id: true },
    })).map((row) => row.id);
    const [assignmentCount, submissionCount, userCount, courseCount] = await Promise.all([
        prisma.assignment.count({ where: assignmentWhere }),
        assignmentIds.length
            ? prisma.assignmentSubmission.count({
                where: { assignmentId: { in: assignmentIds } },
            })
            : Promise.resolve(0),
        prisma.user.count(),
        prisma.course.count(),
    ]);
    if (resolved.scope === 'course') {
        console.log(`Scope: single course "${resolved.course.title}" (${resolved.course.id})`);
    }
    else {
        console.log('Scope: ALL courses');
    }
    console.log(`  assignments to delete       : ${assignmentCount}`);
    console.log(`  submissions to delete       : ${submissionCount}`);
    console.log(`  cascading attachment rows   : auto-removed by FK cascades`);
    console.log(`  related notifications       : will also be cleared`);
    console.log();
    console.log('Will NOT delete:');
    console.log(`  users   (currently ${userCount})`);
    console.log(`  courses (currently ${courseCount})`);
    console.log(`  email logs, course progress`);
    console.log();
    if (assignmentCount === 0) {
        console.log('Nothing to delete. Bye.\n');
        return;
    }
    if (!shouldDelete) {
        console.log('ℹ️  Dry run. Pass --delete (and --confirm when wiping ALL courses) to actually remove these rows.\n');
        return;
    }
    if (resolved.scope === 'all' && !hasConfirm) {
        console.log('✋ Refusing to wipe assignments across ALL courses without --confirm.');
        console.log('   Re-run with both --delete and --confirm if that is what you want.\n');
        return;
    }
    console.log('Deleting…');
    const submissionIdRows = assignmentIds.length
        ? await prisma.assignmentSubmission.findMany({
            where: { assignmentId: { in: assignmentIds } },
            select: { id: true },
        })
        : [];
    const submissionIdsForNotifications = submissionIdRows.map((s) => s.id);
    const groupKeyConditions = assignmentIds.flatMap((id) => [
        { groupKey: `assignment-created:${id}` },
        { groupKey: `assignment-submitted:${id}` },
    ]);
    const deleted = await prisma.$transaction(async (tx) => {
        const notifications = assignmentIds.length
            ? await tx.notification.deleteMany({
                where: {
                    OR: [
                        ...groupKeyConditions,
                        ...(submissionIdsForNotifications.length
                            ? [
                                {
                                    type: 'ASSIGNMENT_GRADED',
                                    referenceId: { in: submissionIdsForNotifications },
                                },
                            ]
                            : []),
                    ],
                },
            })
            : { count: 0 };
        const submissions = assignmentIds.length
            ? await tx.assignmentSubmission.deleteMany({
                where: { assignmentId: { in: assignmentIds } },
            })
            : { count: 0 };
        const assignments = await tx.assignment.deleteMany({
            where: assignmentWhere,
        });
        return {
            submissions: submissions.count,
            assignments: assignments.count,
            notifications: notifications.count,
        };
    });
    const [usersAfter, coursesAfter, assignmentsAfter, submissionsAfter] = await Promise.all([
        prisma.user.count(),
        prisma.course.count(),
        prisma.assignment.count({ where: assignmentWhere }),
        assignmentIds.length
            ? prisma.assignmentSubmission.count({
                where: { assignmentId: { in: assignmentIds } },
            })
            : Promise.resolve(0),
    ]);
    console.log('🗑️  Deleted:');
    console.log(`  ✓ ${deleted.notifications} notifications (bell entries)`);
    console.log(`  ✓ ${deleted.submissions} assignment_submissions`);
    console.log(`  ✓ ${deleted.assignments} assignments`);
    console.log();
    console.log('Safety check:');
    console.log(`  users unchanged     : ${usersAfter === userCount ? 'yes' : 'NO'}`);
    console.log(`  courses unchanged   : ${coursesAfter === courseCount ? 'yes' : 'NO'}`);
    console.log(`  assignments left    : ${assignmentsAfter}`);
    console.log(`  submissions left    : ${submissionsAfter}`);
    console.log('\n✅ Done.\n');
}
main()
    .catch((err) => {
    console.error('\n❌ Error:', err.message ?? err);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=delete-all-assignments.js.map