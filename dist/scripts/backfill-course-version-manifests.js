"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
const course_version_manifest_1 = require("../src/course-version/course-version.manifest");
dotenv.config();
const dryRun = process.argv.includes('--dry-run');
const datasourceUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
if (!datasourceUrl) {
    console.error('DATABASE_URL (or DIRECT_DATABASE_URL) is required');
    process.exit(1);
}
const prisma = new client_1.PrismaClient({
    datasources: { db: { url: datasourceUrl } },
});
async function main() {
    console.log(`\n📦 Backfill course version manifests${dryRun ? ' (DRY RUN)' : ''}\n`);
    const versions = await prisma.courseVersion.findMany({
        orderBy: [{ courseId: 'asc' }, { versionNumber: 'asc' }],
        select: {
            id: true,
            courseId: true,
            versionNumber: true,
            manifest: true,
            sectionCount: true,
            course: { select: { title: true } },
        },
    });
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    for (const v of versions) {
        if (v.manifest != null && v.sectionCount != null) {
            skipped++;
            continue;
        }
        const built = await (0, course_version_manifest_1.buildManifestFromLegacySnapshot)(prisma, v.id);
        if (!built) {
            console.log(`  ✗ v${v.versionNumber} (${v.course.title}): no legacy snapshot rows`);
            failed++;
            continue;
        }
        const fingerprint = (0, course_version_manifest_1.computeStructuralFingerprint)(built.manifest);
        console.log(`  + v${v.versionNumber} "${v.course.title}": ${built.sectionCount} sections · fp=${fingerprint.slice(0, 48)}…`);
        if (!dryRun) {
            await prisma.courseVersion.update({
                where: { id: v.id },
                data: {
                    manifest: built.manifest,
                    sectionCount: built.sectionCount,
                },
            });
        }
        updated++;
    }
    console.log('\n── Summary ──');
    console.log(`  Total versions:  ${versions.length}`);
    console.log(`  Updated:         ${updated}`);
    console.log(`  Already filled:  ${skipped}`);
    console.log(`  Failed:          ${failed}`);
    console.log(dryRun ? '\n(dry run — no writes)\n' : '\nDone.\n');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=backfill-course-version-manifests.js.map