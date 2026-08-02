"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
dotenv.config();
const dryRun = process.argv.includes('--dry-run');
const keepLatestOnly = process.argv.includes('--keep-latest-only');
const courseIdArg = process.argv.find((a) => a.startsWith('--course-id='));
const courseIdFilter = courseIdArg?.split('=')[1]?.trim();
const datasourceUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
if (!datasourceUrl) {
    console.error('DATABASE_URL (or DIRECT_DATABASE_URL) is required');
    process.exit(1);
}
const prisma = new client_1.PrismaClient({
    datasources: { db: { url: datasourceUrl } },
});
function formatBytes(bytes) {
    if (bytes >= 1024 * 1024 * 1024) {
        return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    }
    if (bytes >= 1024 * 1024) {
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
    if (bytes >= 1024) {
        return `${(bytes / 1024).toFixed(0)} kB`;
    }
    return `${bytes} B`;
}
async function loadVersionRow(id) {
    const [meta, enrollments] = await Promise.all([
        prisma.courseVersion.findUniqueOrThrow({
            where: { id },
            select: {
                id: true,
                versionNumber: true,
                isLatest: true,
                changeNotes: true,
                sectionCount: true,
            },
        }),
        prisma.userCourse.count({ where: { enrolledVersionId: id } }),
    ]);
    return {
        id: meta.id,
        versionNumber: meta.versionNumber,
        isLatest: meta.isLatest,
        changeNotes: meta.changeNotes,
        enrollments,
        sectionRows: meta.sectionCount ?? 0,
        approxBytes: (meta.sectionCount ?? 0) * 64,
    };
}
async function buildPlan() {
    const courses = await prisma.course.findMany({
        where: courseIdFilter ? { id: courseIdFilter } : undefined,
        select: { id: true, title: true },
        orderBy: { title: 'asc' },
    });
    const plans = [];
    for (const course of courses) {
        const versionIds = await prisma.courseVersion.findMany({
            where: { courseId: course.id },
            select: { id: true },
            orderBy: { versionNumber: 'asc' },
        });
        if (versionIds.length === 0) {
            continue;
        }
        const versions = await Promise.all(versionIds.map((v) => loadVersionRow(v.id)));
        versions.sort((a, b) => a.versionNumber - b.versionNumber);
        const keep = [];
        const drop = [];
        for (const v of versions) {
            const hasEnrollments = v.enrollments > 0;
            const isCurrentLatest = v.isLatest;
            if (hasEnrollments) {
                keep.push(v);
                continue;
            }
            if (isCurrentLatest && !keepLatestOnly) {
                keep.push(v);
                continue;
            }
            drop.push(v);
        }
        if (drop.length === 0) {
            plans.push({
                courseId: course.id,
                courseTitle: course.title,
                keep,
                drop,
            });
            continue;
        }
        let promoteLatestTo;
        const droppedLatest = drop.some((v) => v.isLatest);
        const keptHasLatest = keep.some((v) => v.isLatest);
        if (droppedLatest && !keptHasLatest && keep.length > 0) {
            promoteLatestTo = keep[keep.length - 1];
        }
        plans.push({
            courseId: course.id,
            courseTitle: course.title,
            keep,
            drop,
            promoteLatestTo,
        });
    }
    return plans;
}
function describeVersion(v) {
    const flags = [];
    if (v.isLatest)
        flags.push('latest');
    if (v.enrollments > 0)
        flags.push(`${v.enrollments} enrolled`);
    const flagStr = flags.length ? ` [${flags.join(', ')}]` : '';
    const notes = v.changeNotes ? ` — ${v.changeNotes}` : '';
    return `v${v.versionNumber}${flagStr} · ${v.sectionRows} sections · ${formatBytes(v.approxBytes)}${notes}`;
}
async function printPlan(plans) {
    let totalDropVersions = 0;
    let totalDropSections = 0;
    let totalDropBytes = 0;
    for (const plan of plans) {
        if (plan.keep.length === 0 && plan.drop.length === 0) {
            continue;
        }
        console.log(`\n── ${plan.courseTitle} (${plan.courseId}) ──`);
        if (plan.keep.length) {
            console.log(`  Keep (${plan.keep.length}):`);
            for (const v of plan.keep) {
                console.log(`    ✓ ${describeVersion(v)}`);
            }
        }
        if (plan.drop.length) {
            console.log(`  Drop (${plan.drop.length}):`);
            for (const v of plan.drop) {
                console.log(`    ✗ ${describeVersion(v)}`);
                totalDropVersions += 1;
                totalDropSections += v.sectionRows;
                totalDropBytes += v.approxBytes;
            }
        }
        if (plan.promoteLatestTo) {
            console.log(`  → Promote v${plan.promoteLatestTo.versionNumber} to isLatest = true`);
        }
    }
    console.log('\n── Totals ──');
    console.log(`  Versions to delete:  ${totalDropVersions}`);
    console.log(`  Snapshot sections:   ${totalDropSections}`);
    console.log(`  Est. content payload freed: ${formatBytes(totalDropBytes)} (content only, excluding indexes/TOAST overhead)`);
}
async function applyPlan(plans) {
    for (const plan of plans) {
        if (plan.drop.length === 0 && !plan.promoteLatestTo) {
            continue;
        }
        console.log(`\nApplying: ${plan.courseTitle}`);
        await prisma.$transaction(async (tx) => {
            const [{ locked }] = await tx.$queryRaw(client_1.Prisma.sql `SELECT pg_try_advisory_xact_lock(hashtextextended(${plan.courseId}, 0)) AS locked`);
            if (!locked) {
                throw new Error(`Course ${plan.courseId} is locked by a concurrent publish/prune; re-run.`);
            }
            if (plan.promoteLatestTo) {
                await tx.courseVersion.updateMany({
                    where: { courseId: plan.courseId, isLatest: true },
                    data: { isLatest: false },
                });
                await tx.courseVersion.update({
                    where: { id: plan.promoteLatestTo.id },
                    data: { isLatest: true },
                });
                console.log(`  Promoted v${plan.promoteLatestTo.versionNumber} → isLatest`);
            }
            for (const v of plan.drop) {
                await tx.courseVersion.delete({ where: { id: v.id } });
                console.log(`  Deleted v${v.versionNumber}`);
            }
        }, { maxWait: 15000, timeout: 120000 });
    }
}
async function main() {
    console.log(`\n🧹 Prune orphan course versions${dryRun ? ' (DRY RUN)' : ''}\n`);
    console.log(`Using ${process.env.DIRECT_DATABASE_URL ? 'DIRECT_DATABASE_URL' : 'DATABASE_URL'}`);
    if (courseIdFilter)
        console.log(`Course filter: ${courseIdFilter}`);
    if (keepLatestOnly)
        console.log('Mode: --keep-latest-only (drops current latest if orphan)');
    const dbSize = await prisma.$queryRaw `
    SELECT pg_size_pretty(pg_database_size(current_database())) AS size
  `;
    console.log(`Database size before: ${dbSize[0]?.size}\n`);
    const plans = await buildPlan();
    if (plans.every((p) => p.drop.length === 0 && !p.promoteLatestTo)) {
        console.log('Nothing to do — no orphan versions found.\n');
        return;
    }
    await printPlan(plans);
    if (dryRun) {
        console.log('\n(dry run — no writes)\n');
        return;
    }
    await applyPlan(plans);
    const dbSizeAfter = await prisma.$queryRaw `
    SELECT pg_size_pretty(pg_database_size(current_database())) AS size
  `;
    console.log(`\nDatabase size after: ${dbSizeAfter[0]?.size}`);
    console.log('\nTip: run  VACUUM (FULL, ANALYZE);  in the Neon SQL editor after dropping snapshot tables.\n');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=prune-orphan-course-versions.js.map