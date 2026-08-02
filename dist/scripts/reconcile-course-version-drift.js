"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
const course_version_service_1 = require("../src/course-version/course-version.service");
const course_version_manifest_1 = require("../src/course-version/course-version.manifest");
dotenv.config();
const apply = process.argv.includes('--apply');
const datasourceUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
if (!datasourceUrl) {
    console.error('DIRECT_DATABASE_URL (or DATABASE_URL) is required');
    process.exit(1);
}
const prisma = new client_1.PrismaClient({ datasources: { db: { url: datasourceUrl } } });
const service = new course_version_service_1.CourseVersionService(prisma);
async function main() {
    console.log(`\n🔧 Course version drift reconcile — ${apply ? 'APPLY' : 'DRY-RUN'}\n`);
    const courses = await prisma.course.findMany({
        select: { id: true, title: true },
        orderBy: { title: 'asc' },
    });
    const drifted = [];
    for (const course of courses) {
        const latest = await prisma.courseVersion.findFirst({
            where: { courseId: course.id, isLatest: true },
            select: { versionNumber: true, manifest: true },
        });
        if (!latest)
            continue;
        const latestManifest = (0, course_version_manifest_1.parseManifest)(latest.manifest);
        if (!latestManifest)
            continue;
        const built = await (0, course_version_manifest_1.buildManifestFromLiveTree)(prisma, course.id);
        const drift = (0, course_version_manifest_1.computeStructuralFingerprint)(latestManifest) !==
            (0, course_version_manifest_1.computeStructuralFingerprint)(built.manifest);
        if (drift) {
            const activeUnpinned = await prisma.userCourse.count({
                where: { courseId: course.id, isActive: true, enrolledVersionId: null },
            });
            drifted.push({
                id: course.id,
                title: course.title,
                latestVersion: latest.versionNumber,
                activeUnpinned,
            });
        }
    }
    if (drifted.length === 0) {
        console.log('  ✓ No drift — every course\'s latest matches its live tree.\n');
        return;
    }
    const totalPinBlast = drifted.reduce((s, d) => s + d.activeUnpinned, 0);
    console.log(`  Found ${drifted.length} drifted course(s):`);
    for (const d of drifted) {
        console.log(`    • "${d.title}" (latest = v${d.latestVersion}) → would publish a new` +
            ` catch-up version and pin ${d.activeUnpinned} active-unpinned enrollment(s)`);
    }
    console.log(`\n  Learner-facing blast radius: ${totalPinBlast} enrollment(s) would be pinned` +
        ` (visually a no-op — the published version equals the live tree they already see).`);
    console.log();
    if (!apply) {
        console.log('  DRY-RUN: no changes made. Each course above would get ONE new catch-up\n' +
            '  version (number derived from MAX(versionNumber)+1) AND its\n' +
            '  active-unpinned enrollments pinned to it. Already-pinned learners are\n' +
            '  unaffected. Re-run with --apply.\n');
        return;
    }
    for (const d of drifted) {
        const result = await service.publishNewVersion(null, d.id, 'Reconcile: sync latest published version to live tree');
        const data = result.data;
        if (data?.skipped) {
            console.log(`    • "${d.title}": no change on re-check (skipped)`);
        }
        else {
            console.log(`    • "${d.title}": published v${data?.versionNumber}`);
        }
    }
    console.log('\n  ✓ Reconcile complete.\n');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=reconcile-course-version-drift.js.map