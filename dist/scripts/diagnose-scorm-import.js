"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
const scorm_publish_gate_1 = require("../src/utils/scorm-publish-gate");
dotenv.config();
const rawDatasourceUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
if (!rawDatasourceUrl) {
    console.error('DIRECT_DATABASE_URL (or DATABASE_URL) is required');
    process.exit(1);
}
function withConnectTimeout(url, seconds = 30) {
    if (/[?&]connect_timeout=/.test(url))
        return url;
    return `${url}${url.includes('?') ? '&' : '?'}connect_timeout=${seconds}`;
}
const prisma = new client_1.PrismaClient({
    datasources: { db: { url: withConnectTimeout(rawDatasourceUrl) } },
});
const iso = (d) => d ? d.toISOString().slice(0, 16).replace('T', ' ') : '—';
const titleFilter = process.argv.slice(2).find((a) => !a.startsWith('-'));
async function main() {
    console.log('\n🔎 Imported SCORM courses — import/activation diagnosis (READ-ONLY)\n');
    const courses = await prisma.course.findMany({
        where: {
            deliveryMode: 'IMPORTED_SCORM',
            ...(titleFilter
                ? { title: { contains: titleFilter, mode: 'insensitive' } }
                : {}),
        },
        select: { id: true, title: true, isActive: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
    });
    if (courses.length === 0) {
        console.log('  No IMPORTED_SCORM courses matched.\n');
        return;
    }
    for (const course of courses) {
        const [packages, candidateSections, modules, latestVersion, enrollments, registrations,] = await Promise.all([
            prisma.scormPackage.findMany({
                where: { courseId: course.id },
                orderBy: { versionNumber: 'desc' },
            }),
            prisma.section.findMany({
                where: (0, scorm_publish_gate_1.scormGateCandidateSectionsWhere)(course.id),
                select: { id: true, isActive: true },
            }),
            prisma.module.count({
                where: { courseId: course.id, isArchived: false },
            }),
            prisma.courseVersion.findFirst({
                where: { courseId: course.id, status: 'PUBLISHED', isLatest: true },
                select: { versionNumber: true, publishedAt: true },
            }),
            prisma.userCourse.count({ where: { courseId: course.id } }),
            prisma.scormRegistration.count({ where: { courseId: course.id } }),
        ]);
        const newestReady = packages.find((p) => p.status === client_1.ScormPackageStatus.READY);
        const expected = (0, scorm_publish_gate_1.scormPackageSectionIds)(newestReady);
        const gate = expected.size > 0
            ? (0, scorm_publish_gate_1.evaluateScormPublishGate)(expected, candidateSections)
            : null;
        const canActivate = !!gate && gate.problems.length === 0;
        const liveCount = candidateSections.filter((s) => s.isActive).length;
        console.log(`━━ ${course.title}`);
        console.log(`   id=${course.id}  created=${iso(course.createdAt)}  isActive=${course.isActive}`);
        console.log(`   liveModules=${modules}  liveScormSections=${liveCount}` +
            (expected.size > 0 ? `/${expected.size} expected` : '') +
            `  ` +
            `version=${latestVersion
                ? `v${latestVersion.versionNumber} (${iso(latestVersion.publishedAt)})`
                : 'NONE (shows "Unpublished")'}`);
        console.log(`   enrollments=${enrollments}  scormRegistrations=${registrations}`);
        if (packages.length === 0) {
            console.log('   packages: NONE — the course row was created but no package was ever submitted');
        }
        for (const p of packages) {
            console.log(`   pkg v${p.versionNumber} ${p.status}` +
                `  section=${p.sectionId ?? 'null'}  cloudJob=${p.cloudImportJobId ?? 'null'}  created=${iso(p.createdAt)}`);
            if (p.failureReason)
                console.log(`        failureReason: ${p.failureReason}`);
            if (p.importWarning)
                console.log(`        importWarning:  ${p.importWarning}`);
        }
        console.log(`   ➜ activatable: ${canActivate ? 'YES' : 'NO'}`);
        if (!canActivate) {
            const blocking = packages.find((p) => p.status === client_1.ScormPackageStatus.PROCESSING);
            if (gate) {
                for (const problem of gate.problems)
                    console.log(`     ${problem}`);
                if (gate.deactivated.length > 0) {
                    console.log(`       deactivated: ${gate.deactivated.join(', ')}`);
                }
                if (gate.gone > 0) {
                    const gone = gate.missing.filter((id) => !gate.deactivated.includes(id));
                    console.log(`       archived/missing: ${gone.join(', ')}`);
                }
                if (gate.extra.length > 0) {
                    console.log(`       leftover: ${gate.extra.join(', ')}`);
                }
            }
            else if (newestReady) {
                console.log(`     Newest READY package (v${newestReady.versionNumber}) has no sectionId ` +
                    `and no lesson manifest — re-import.`);
            }
            if (blocking && blocking.cloudImportJobId) {
                console.log(`     ${newestReady ? 'A newer import' : 'Import'} never completed. Drive it forward:\n` +
                    `       GET /scorm/packages/${blocking.id}/import-status   (admin jwt)\n` +
                    `     or POST /api/v1/internal/cron/scorm-import-jobs (cron secret).\n` +
                    `     Otherwise it waits for the 09:00 UTC daily cron. Still PROCESSING\n` +
                    `     24h after creation (Cloud kept timing out), the next poll/cron marks\n` +
                    `     it FAILED and a re-import is allowed. Any PROCESSING row 72h after\n` +
                    `     creation (whatever Cloud says, tree built or not) is marked FAILED by\n` +
                    `     the next poll, cron, or re-import attempt.`);
            }
            else if (blocking) {
                console.log(`     Package is PROCESSING with no cloudImportJobId — the Cloud job never\n` +
                    `     started (the import request died before recording it). Once it is\n` +
                    `     10 minutes old, re-importing the course marks it FAILED and proceeds\n` +
                    `     (so do the import-status poll and the import-job cron).`);
            }
            else if (!newestReady &&
                packages.some((p) => p.status === client_1.ScormPackageStatus.FAILED)) {
                console.log(`     Import FAILED — see failureReason above. Re-import after fixing it.`);
            }
            else if (!newestReady) {
                console.log(`     No READY package — import the package first.`);
            }
        }
        console.log('');
    }
    console.log('  No changes made (this script never writes).\n');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=diagnose-scorm-import.js.map