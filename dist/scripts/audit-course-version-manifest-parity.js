"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
const course_version_manifest_1 = require("../src/course-version/course-version.manifest");
dotenv.config();
const datasourceUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
if (!datasourceUrl) {
    console.error('DATABASE_URL (or DIRECT_DATABASE_URL) is required');
    process.exit(1);
}
const prisma = new client_1.PrismaClient({
    datasources: { db: { url: datasourceUrl } },
});
async function legacySectionIds(versionId) {
    try {
        const rows = await prisma.$queryRaw(client_1.Prisma.sql `
      SELECT "sourceSectionId", "isActive"
      FROM "course_version_sections"
      WHERE "versionId" = ${versionId}
        AND "sourceSectionId" IS NOT NULL
    `);
        const activeIds = rows
            .filter((r) => r.isActive)
            .map((r) => r.sourceSectionId)
            .filter((id) => Boolean(id))
            .sort();
        const inactiveExtra = rows.filter((r) => !r.isActive).length;
        return { activeIds, inactiveExtra, available: true };
    }
    catch {
        return { activeIds: [], inactiveExtra: 0, available: false };
    }
}
function setsEqual(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}
async function main() {
    console.log('\n🔍 Course version manifest parity audit\n');
    const versions = await prisma.courseVersion.findMany({
        orderBy: [{ courseId: 'asc' }, { versionNumber: 'asc' }],
        select: {
            id: true,
            versionNumber: true,
            sectionCount: true,
            manifest: true,
            course: { select: { title: true } },
        },
    });
    let ok = 0;
    let mismatches = 0;
    let missingManifest = 0;
    for (const v of versions) {
        const manifest = (0, course_version_manifest_1.parseManifest)(v.manifest);
        if (!manifest) {
            console.log(`  ✗ v${v.versionNumber} "${v.course.title}": manifest missing`);
            missingManifest++;
            continue;
        }
        const manifestIds = (0, course_version_manifest_1.getSectionIdsFromManifest)(manifest).sort();
        const { activeIds: legacyIds, inactiveExtra, available } = await legacySectionIds(v.id);
        if (!available) {
            if (v.sectionCount === manifestIds.length) {
                ok++;
            }
            else {
                console.log(`  ✗ v${v.versionNumber} "${v.course.title}": sectionCount ${v.sectionCount} != manifest ${manifestIds.length}`);
                mismatches++;
            }
            continue;
        }
        if (inactiveExtra > 0) {
            console.log(`  ⓘ v${v.versionNumber} "${v.course.title}": snapshot had ${inactiveExtra} inactive section(s) excluded (matches old active-only denominator)`);
        }
        if (setsEqual(manifestIds, legacyIds)) {
            ok++;
        }
        else {
            const onlyManifest = manifestIds.filter((id) => !legacyIds.includes(id));
            const onlyLegacy = legacyIds.filter((id) => !manifestIds.includes(id));
            console.log(`  ✗ v${v.versionNumber} "${v.course.title}": section set mismatch`);
            console.log(`      manifest-only: ${onlyManifest.join(', ') || '(none)'}`);
            console.log(`      legacy-only:   ${onlyLegacy.join(', ') || '(none)'}`);
            mismatches++;
        }
    }
    console.log('\n── Summary ──');
    console.log(`  Versions checked:   ${versions.length}`);
    console.log(`  OK:                 ${ok}`);
    console.log(`  Mismatches:         ${mismatches}`);
    console.log(`  Missing manifest:   ${missingManifest}`);
    if (mismatches > 0 || missingManifest > 0) {
        process.exit(1);
    }
    console.log('\nAll versions pass parity check.\n');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=audit-course-version-manifest-parity.js.map