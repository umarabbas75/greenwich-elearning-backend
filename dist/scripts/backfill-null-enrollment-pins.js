"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
const started_set_1 = require("./lib/started-set");
dotenv.config();
const apply = process.argv.includes('--apply');
const datasourceUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
if (!datasourceUrl) {
    console.error('DIRECT_DATABASE_URL (or DATABASE_URL) is required');
    process.exit(1);
}
const prisma = new client_1.PrismaClient({ datasources: { db: { url: datasourceUrl } } });
async function main() {
    console.log(`\n🔧 Null-enrollment pin backfill — ${apply ? 'APPLY' : 'DRY-RUN'}\n`);
    const [activeNull, started] = await Promise.all([
        prisma.userCourse.findMany({
            where: { enrolledVersionId: null, isActive: true },
            select: { id: true, userId: true, courseId: true },
        }),
        (0, started_set_1.buildStartedSet)(prisma),
    ]);
    const courseIds = [...new Set(activeNull.map((e) => e.courseId))];
    const latestByCourse = new Map();
    for (const courseId of courseIds) {
        const latest = await prisma.courseVersion.findFirst({
            where: { courseId, isLatest: true },
            select: { id: true, versionNumber: true },
        });
        if (latest)
            latestByCourse.set(courseId, latest);
    }
    const targets = activeNull.filter((e) => latestByCourse.has(e.courseId));
    const noVersion = activeNull.filter((e) => !latestByCourse.has(e.courseId));
    const targetsStarted = targets.filter((e) => started.has((0, started_set_1.startedKey)(e.userId, e.courseId)));
    console.log(`  Active unpinned (NULL) enrollments:            ${activeNull.length}`);
    console.log(`  …course has a published latest (TARGETS):      ${targets.length}`);
    console.log(`      of which started (visual-impact overlay):  ${targetsStarted.length}`);
    console.log(`      of which never started (pinned anyway):    ${targets.length - targetsStarted.length}`);
    console.log(`  …course has NO published version (leave NULL): ${noVersion.length}\n`);
    if (targets.length === 0) {
        console.log('  ✓ Nothing to backfill.\n');
        return;
    }
    for (const t of targets) {
        const latest = latestByCourse.get(t.courseId);
        console.log(`    • user ${t.userId} / course ${t.courseId} → pin to v${latest.versionNumber}`);
    }
    console.log();
    if (!apply) {
        console.log('  DRY-RUN: no changes made. Re-run with --apply to pin.\n');
        return;
    }
    let pinned = 0;
    for (const t of targets) {
        const latest = latestByCourse.get(t.courseId);
        const res = await prisma.userCourse.updateMany({
            where: { id: t.id, enrolledVersionId: null },
            data: { enrolledVersionId: latest.id },
        });
        pinned += res.count;
    }
    console.log(`  ✓ Pinned ${pinned} enrollment(s).\n`);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=backfill-null-enrollment-pins.js.map