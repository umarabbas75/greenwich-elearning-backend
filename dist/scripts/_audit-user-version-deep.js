"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
dotenv.config();
const email = process.argv[2] ?? 'khurramabbasfpcl@gmail.com';
const DEFAULT_COURSE_ID = '2ef7ce1b-7e3c-4168-8ef1-39af383174b1';
const courseId = process.argv[3] ?? DEFAULT_COURSE_ID;
const CASE_STUDY_CUTOFF = new Date('2026-06-20T00:00:00.000Z');
const datasourceUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const prisma = new client_1.PrismaClient({
    datasources: { db: { url: datasourceUrl } },
});
function pct(n, d) {
    if (!d)
        return 'n/a';
    return ((n * 100) / d).toFixed(2) + '%';
}
async function main() {
    console.log('\n══════════════════════════════════════════════════════════');
    console.log(' DEEP USER VERSION AUDIT (read-only)');
    console.log('══════════════════════════════════════════════════════════');
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        console.log(`User not found: ${email}`);
        return;
    }
    const course = await prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true, title: true },
    });
    if (!course) {
        console.log(`Course not found: ${courseId}`);
        return;
    }
    console.log(`\nUser:   ${user.email}  (${user.id})`);
    console.log(`Course: "${course.title}"  (${course.id})`);
    const uc = await prisma.userCourse.findUnique({
        where: { userId_courseId: { userId: user.id, courseId } },
        include: {
            enrolledVersion: {
                select: { id: true, versionNumber: true, isLatest: true, status: true },
            },
        },
    });
    const completion = await prisma.courseCompletion.findUnique({
        where: { userId_courseId: { userId: user.id, courseId } },
        select: { courseCompletedAt: true },
    });
    console.log('\n── Enrollment ──');
    if (!uc) {
        console.log('  NOT ENROLLED');
    }
    else {
        console.log({
            userCourseId: uc.id,
            isActive: uc.isActive,
            isPaid: uc.isPaid,
            activatedAt: uc.activatedAt,
            enrolledVersionId: uc.enrolledVersionId,
            pinnedVersionNumber: uc.enrolledVersion?.versionNumber ?? null,
            pinnedVersionIsLatest: uc.enrolledVersion?.isLatest ?? null,
            pinnedVersionStatus: uc.enrolledVersion?.status ?? null,
            isCompleter: !!completion?.courseCompletedAt,
            completedAt: completion?.courseCompletedAt ?? null,
        });
    }
    const versions = await prisma.courseVersion.findMany({
        where: { courseId },
        orderBy: { versionNumber: 'asc' },
        include: { _count: { select: { enrollments: true } } },
    });
    console.log('\n── Published versions ──');
    const versionDenoms = new Map();
    for (const v of versions) {
        const [allSections, activeSections] = await Promise.all([
            prisma.courseVersionSection.count({ where: { versionId: v.id } }),
            prisma.courseVersionSection.count({
                where: { versionId: v.id, isActive: true },
            }),
        ]);
        versionDenoms.set(v.id, activeSections);
        console.log({
            versionNumber: v.versionNumber,
            isLatest: v.isLatest,
            status: v.status,
            allSectionRows: allSections,
            activeSectionRows: activeSections,
            pinnedEnrollments: v._count.enrollments,
            publishedAt: v.publishedAt,
            changeNotes: v.changeNotes,
        });
    }
    const liveSections = await prisma.section.count({
        where: {
            isArchived: false,
            chapter: { isArchived: false, module: { courseId, isArchived: false } },
        },
    });
    const liveActiveSections = await prisma.section.count({
        where: {
            isArchived: false,
            isActive: true,
            chapter: { isArchived: false, module: { courseId, isArchived: false } },
        },
    });
    console.log('\n── Live tree ──');
    console.log({ liveSections, liveActiveSections });
    const progress = await prisma.userCourseProgress.findMany({
        where: { userId: user.id, courseId },
        select: { sectionId: true, createdAt: true },
    });
    const distinctSectionIds = new Set(progress.map((p) => p.sectionId));
    const beforeCutoff = progress.filter((p) => p.createdAt < CASE_STUDY_CUTOFF).length;
    const afterCutoff = progress.length - beforeCutoff;
    console.log('\n── User progress (UserCourseProgress) ──');
    console.log({
        totalProgressRows: progress.length,
        distinctSections: distinctSectionIds.size,
        rowsBeforeCaseStudyCutoff: beforeCutoff,
        rowsAfterCaseStudyCutoff: afterCutoff,
    });
    const caseStudies = await prisma.section.findMany({
        where: {
            title: { contains: 'Case Study', mode: 'insensitive' },
            isArchived: false,
            chapter: { isArchived: false, module: { courseId, isArchived: false } },
        },
        select: { id: true, title: true, createdAt: true },
    });
    const caseStudyIds = new Set(caseStudies.map((c) => c.id));
    const userCaseStudyProgress = [...distinctSectionIds].filter((id) => caseStudyIds.has(id)).length;
    console.log('\n── Case Study sections ──');
    console.log({
        liveCaseStudySections: caseStudies.length,
        userProgressOnCaseStudies: userCaseStudyProgress,
    });
    console.log('\n── % progress under each denominator ──');
    console.log(`  live tree (${liveActiveSections}):  ${pct(distinctSectionIds.size, liveActiveSections)}`);
    for (const v of versions) {
        const d = versionDenoms.get(v.id) ?? 0;
        console.log(`  v${v.versionNumber} (${d}):  ${pct(distinctSectionIds.size, d)}${v.isLatest ? '  [latest]' : ''}${uc?.enrolledVersionId === v.id ? '  <-- PINNED HERE' : ''}`);
    }
    if (uc?.enrolledVersionId) {
        const pinnedSourceIds = new Set((await prisma.courseVersionSection.findMany({
            where: { versionId: uc.enrolledVersionId, isActive: true },
            select: { sourceSectionId: true },
        }))
            .map((r) => r.sourceSectionId)
            .filter(Boolean));
        const orphaned = [...distinctSectionIds].filter((id) => !pinnedSourceIds.has(id));
        console.log('\n── Progress vs pinned version ──');
        console.log({
            pinnedVersionActiveSections: pinnedSourceIds.size,
            userCompletedSections: distinctSectionIds.size,
            completedSectionsNotInPinnedVersion: orphaned.length,
        });
        if (orphaned.length > 0) {
            console.log('  ⚠ User has progress on sections that are NOT in their pinned version snapshot:');
            console.log('   ', orphaned.slice(0, 10));
        }
    }
    const latest = versions.find((v) => v.isLatest);
    console.log('\n── Content-sync reachability ──');
    if (uc?.enrolledVersionId && latest && uc.enrolledVersionId !== latest.id) {
        console.log(`  ⚠ User is pinned to v${uc.enrolledVersion?.versionNumber} but latest is v${latest.versionNumber}.`);
        console.log('    syncSectionToLatestVersion / syncQuizToLatestVersion etc. only update the LATEST version,');
        console.log('    so any admin CONTENT edits will NOT reach this learner. This is "profile not synced".');
    }
    else if (uc?.enrolledVersionId && latest && uc.enrolledVersionId === latest.id) {
        console.log('  ✓ User is pinned to the latest version; content syncs reach them.');
    }
    else {
        console.log('  (no pin or no latest version)');
    }
    console.log('\n══════════════════════════════════════════════════════════\n');
}
main()
    .catch((e) => {
    console.error('\n❌ Error:', e?.message ?? e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=_audit-user-version-deep.js.map