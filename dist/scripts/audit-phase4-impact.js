"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
const course_version_manifest_1 = require("../src/course-version/course-version.manifest");
const started_set_1 = require("./lib/started-set");
dotenv.config();
const datasourceUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
if (!datasourceUrl) {
    console.error('DIRECT_DATABASE_URL (or DATABASE_URL) is required');
    process.exit(1);
}
const prisma = new client_1.PrismaClient({
    datasources: { db: { url: datasourceUrl } },
});
async function main() {
    console.log('\n=== PHASE 4 IMPACT AUDIT (READ-ONLY) ===\n');
    const courses = await prisma.course.findMany({
        select: { id: true, title: true },
        orderBy: { title: 'asc' },
    });
    let withPublished = 0;
    const driftCourses = [];
    const driftCourseIds = new Set();
    for (const course of courses) {
        const latest = await prisma.courseVersion.findFirst({
            where: { courseId: course.id, isLatest: true },
            select: { versionNumber: true, manifest: true },
        });
        if (!latest)
            continue;
        withPublished++;
        const latestManifest = (0, course_version_manifest_1.parseManifest)(latest.manifest);
        if (!latestManifest)
            continue;
        const built = await (0, course_version_manifest_1.buildManifestFromLiveTree)(prisma, course.id);
        const drift = (0, course_version_manifest_1.computeStructuralFingerprint)(latestManifest) !==
            (0, course_version_manifest_1.computeStructuralFingerprint)(built.manifest);
        if (!drift)
            continue;
        driftCourseIds.add(course.id);
        const [enrollTotal, enrollLive] = await Promise.all([
            prisma.userCourse.count({ where: { courseId: course.id } }),
            prisma.userCourse.count({
                where: { courseId: course.id, enrolledVersionId: null },
            }),
        ]);
        const latestSections = latestManifest.modules.reduce((s, m) => s + m.chapters.reduce((c, ch) => c + ch.sectionIds.length, 0), 0);
        driftCourses.push({
            id: course.id,
            title: course.title,
            latestVersion: latest.versionNumber,
            liveSections: built.sectionCount,
            latestSections,
            enrollTotal,
            enrollPinned: enrollTotal - enrollLive,
            enrollLive,
        });
    }
    console.log('── A. Version drift (reconcile target) ──');
    console.log(`  Courses total:                 ${courses.length}`);
    console.log(`  Courses with a published ver:  ${withPublished}`);
    console.log(`  Courses DRIFTED (live≠latest): ${driftCourses.length}`);
    for (const d of driftCourses) {
        console.log(`    • "${d.title}"  latest=v${d.latestVersion}  sections live=${d.liveSections}/latest=${d.latestSections}  enrollments: ${d.enrollTotal} (pinned ${d.enrollPinned}, live ${d.enrollLive})`);
    }
    const [enrollTotal, enrollNull] = await Promise.all([
        prisma.userCourse.count(),
        prisma.userCourse.count({ where: { enrolledVersionId: null } }),
    ]);
    const nullEnrollments = await prisma.userCourse.findMany({
        where: { enrolledVersionId: null },
        select: { userId: true, courseId: true, isActive: true },
    });
    const started = await (0, started_set_1.buildStartedSet)(prisma);
    const publishedCourseIds = new Set();
    for (const c of courses) {
        const has = await prisma.courseVersion.count({
            where: { courseId: c.id, isLatest: true },
        });
        if (has > 0)
            publishedCourseIds.add(c.id);
    }
    const activeNull = nullEnrollments.filter((e) => e.isActive);
    const inactiveNull = nullEnrollments.filter((e) => !e.isActive);
    const targets = activeNull.filter((e) => publishedCourseIds.has(e.courseId));
    const targetsNoVersion = activeNull.filter((e) => !publishedCourseIds.has(e.courseId));
    const targetsStarted = targets.filter((e) => started.has((0, started_set_1.startedKey)(e.userId, e.courseId)));
    const targetsOnDrift = targets.filter((e) => driftCourseIds.has(e.courseId));
    const targetsOnDriftStarted = targetsOnDrift.filter((e) => started.has((0, started_set_1.startedKey)(e.userId, e.courseId)));
    console.log('\n── B. Enrollment pinning ──');
    console.log(`  Enrollments total:                 ${enrollTotal}`);
    console.log(`    Pinned (enrolledVersionId set):  ${enrollTotal - enrollNull}`);
    console.log(`    Unpinned (NULL → served live):   ${enrollNull}`);
    console.log(`      active   (backfill/pin target): ${activeNull.length}`);
    console.log(`      inactive (stay NULL, pin at activation): ${inactiveNull.length}`);
    console.log(`  Backfill/pin targets (active + course has a published version): ${targets.length}`);
    console.log(`      of which started (visual-impact overlay): ${targetsStarted.length}`);
    console.log(`      of which on a DRIFTED course: ${targetsOnDrift.length} (started: ${targetsOnDriftStarted.length})`);
    console.log(`      active but course has NO published version (stay NULL): ${targetsNoVersion.length}`);
    console.log('\n── Impact summary ──');
    console.log(`  • Reconcile touches ${driftCourses.length} course(s): publishes a catch-up version AND pins that course's active-unpinned enrollments to it (visually a no-op — the published version equals the live tree they already see).`);
    console.log(`  • Backfill pins ${targets.length} active-unpinned enrollment(s) (matching the app's freeze-at-activation rule). ${targetsNoVersion.length} active-unpinned on unpublished courses stay NULL; ${inactiveNull.length} inactive-unpinned stay NULL.`);
    console.log(`  • ORDER-SENSITIVE set: ${targetsOnDriftStarted.length} started enrollment(s) sit on a still-drifted course — run reconcile BEFORE backfill so they pin to live, not a stale latest.`);
    console.log(`  • ${enrollTotal - enrollNull} already-pinned learners are untouched by both jobs.\n`);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=audit-phase4-impact.js.map