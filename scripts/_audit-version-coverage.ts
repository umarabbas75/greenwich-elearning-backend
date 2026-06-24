/**
 * _audit-version-coverage.ts
 *
 * Read-only diagnostic. Lists active enrollments that have no enrolledVersionId
 * (should be empty after backfill + activation hook).
 *
 *   yarn ts-node -r tsconfig-paths/register scripts/_audit-version-coverage.ts
 */

import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const rawUrl = process.env.DATABASE_URL ?? '';
const datasourceUrl = rawUrl.includes('pgbouncer=true')
  ? rawUrl
  : rawUrl +
    (rawUrl.includes('?') ? '&' : '?') +
    'pgbouncer=true&connect_timeout=30';

const prisma = new PrismaClient({
  datasources: { db: { url: datasourceUrl } },
});

async function main() {
  console.log('\n🔎 Version coverage audit\n');

  const unpinnedActive = await prisma.userCourse.findMany({
    where: { isActive: true, enrolledVersionId: null },
    include: {
      user: { select: { email: true } },
      course: { select: { title: true } },
    },
  });

  const coursesWithoutV1 = await prisma.course.findMany({
    where: {
      courseVersions: { none: { versionNumber: 1 } },
    },
    select: { id: true, title: true },
  });

  console.log(`Active enrollments without version pin: ${unpinnedActive.length}`);
  for (const row of unpinnedActive.slice(0, 20)) {
    console.log(
      `  - ${row.user.email} | ${row.course.title} | userCourseId=${row.id}`,
    );
  }
  if (unpinnedActive.length > 20) {
    console.log(`  … and ${unpinnedActive.length - 20} more`);
  }

  console.log(`\nCourses missing v1 snapshot: ${coursesWithoutV1.length}`);
  for (const c of coursesWithoutV1) {
    console.log(`  - ${c.title} (${c.id})`);
  }

  const versionStats = await prisma.courseVersion.groupBy({
    by: ['courseId'],
    _count: { id: true },
    _max: { versionNumber: true },
  });
  console.log(`\nCourses with at least one version: ${versionStats.length}`);

  console.log('\nDone.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
