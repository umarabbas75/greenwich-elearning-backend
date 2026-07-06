/**
 * audit-course-version-manifest-parity.ts
 *
 * Asserts each CourseVersion manifest resolves to the same section ID set
 * as its legacy course_version_sections snapshot (pre-migration parity).
 *
 *   yarn ts-node -r tsconfig-paths/register scripts/audit-course-version-manifest-parity.ts
 */

import * as dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  getSectionIdsFromManifest,
  parseManifest,
} from '../src/course-version/course-version.manifest';

dotenv.config();

const datasourceUrl =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';

if (!datasourceUrl) {
  console.error('DATABASE_URL (or DIRECT_DATABASE_URL) is required');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: { db: { url: datasourceUrl } },
});

/**
 * Returns the active legacy source-section ids (the OLD read-time denominator
 * used `isActive: true`), plus how many additional inactive rows the snapshot
 * held. `inactiveExtra > 0` marks the only versions where the isActive filter
 * choice affects the frozen denominator — those are the ones worth eyeballing.
 *
 * The legacy typed delegates were removed from the Prisma schema, so read the
 * still-present snapshot tables via raw SQL. Once migration 2 drops the tables
 * this query throws and we fall back to a sectionCount-only comparison.
 */
async function legacySectionIds(
  versionId: string,
): Promise<{ activeIds: string[]; inactiveExtra: number; available: boolean }> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ sourceSectionId: string | null; isActive: boolean }>
    >(Prisma.sql`
      SELECT "sourceSectionId", "isActive"
      FROM "course_version_sections"
      WHERE "versionId" = ${versionId}
        AND "sourceSectionId" IS NOT NULL
    `);
    const activeIds = rows
      .filter((r) => r.isActive)
      .map((r) => r.sourceSectionId)
      .filter((id): id is string => Boolean(id))
      .sort();
    const inactiveExtra = rows.filter((r) => !r.isActive).length;
    return { activeIds, inactiveExtra, available: true };
  } catch {
    // Snapshot tables already dropped — compare manifest sectionCount only.
    return { activeIds: [], inactiveExtra: 0, available: false };
  }
}

function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
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
    const manifest = parseManifest(v.manifest);
    if (!manifest) {
      console.log(`  ✗ v${v.versionNumber} "${v.course.title}": manifest missing`);
      missingManifest++;
      continue;
    }

    const manifestIds = getSectionIdsFromManifest(manifest).sort();
    const { activeIds: legacyIds, inactiveExtra, available } =
      await legacySectionIds(v.id);

    if (!available) {
      if (v.sectionCount === manifestIds.length) {
        ok++;
      } else {
        console.log(
          `  ✗ v${v.versionNumber} "${v.course.title}": sectionCount ${v.sectionCount} != manifest ${manifestIds.length}`,
        );
        mismatches++;
      }
      continue;
    }

    if (inactiveExtra > 0) {
      // The only case where the isActive filter matters: manifest (active-only)
      // will legitimately be smaller than the raw snapshot row count. This
      // matches the OLD isActive:true denominator — flagged for manual review.
      console.log(
        `  ⓘ v${v.versionNumber} "${v.course.title}": snapshot had ${inactiveExtra} inactive section(s) excluded (matches old active-only denominator)`,
      );
    }

    if (setsEqual(manifestIds, legacyIds)) {
      ok++;
    } else {
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
