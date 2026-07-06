/**
 * backfill-course-version-manifests.ts
 *
 * One-time migration: populate manifest + sectionCount on every CourseVersion
 * from legacy course_version_* snapshot rows (exact frozen-set parity).
 *
 * Run AFTER migration 20260706120000_course_version_manifest and BEFORE
 * migration 20260706130000_drop_course_version_snapshot_tables.
 *
 *   yarn ts-node -r tsconfig-paths/register scripts/backfill-course-version-manifests.ts
 *   yarn ts-node -r tsconfig-paths/register scripts/backfill-course-version-manifests.ts --dry-run
 */

import * as dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  buildManifestFromLegacySnapshot,
  computeStructuralFingerprint,
} from '../src/course-version/course-version.manifest';

dotenv.config();

const dryRun = process.argv.includes('--dry-run');

const datasourceUrl =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';

if (!datasourceUrl) {
  console.error('DATABASE_URL (or DIRECT_DATABASE_URL) is required');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: { db: { url: datasourceUrl } },
});

async function main() {
  console.log(
    `\n📦 Backfill course version manifests${dryRun ? ' (DRY RUN)' : ''}\n`,
  );

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

    const built = await buildManifestFromLegacySnapshot(prisma, v.id);
    if (!built) {
      console.log(
        `  ✗ v${v.versionNumber} (${v.course.title}): no legacy snapshot rows`,
      );
      failed++;
      continue;
    }

    const fingerprint = computeStructuralFingerprint(built.manifest);
    console.log(
      `  + v${v.versionNumber} "${v.course.title}": ${built.sectionCount} sections · fp=${fingerprint.slice(0, 48)}…`,
    );

    if (!dryRun) {
      await prisma.courseVersion.update({
        where: { id: v.id },
        data: {
          manifest: built.manifest as unknown as Prisma.InputJsonValue,
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
