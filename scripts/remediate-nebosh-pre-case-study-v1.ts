/**
 * remediate-nebosh-pre-case-study-v1.ts
 *
 * One-time data fix for NEBOSH IGC: the June-2026 backfill snapshotted v1 from
 * the live tree *after* Case Study sections were added (2026-06-20), so in-progress
 * learners who had finished chapters before that date see falsely low percentages.
 *
 * What this script does (single transaction):
 *   1. Rename poisoned v1 → v2 (115 sections, includes Case Studies, isLatest).
 *   2. Publish corrected v1 (111 sections, excludes Case Studies).
 *   3. Re-pin affected in-progress enrollments to corrected v1.
 *
 * Affected = had progress before the Case Study cutover AND zero progress on
 * Case Study sections. Certified completers stay on v2 unless --include-completers.
 *
 * Idempotent: exits cleanly if v1=111 + v2=115 already exists.
 *
 *   yarn ts-node -r tsconfig-paths/register scripts/remediate-nebosh-pre-case-study-v1.ts --dry-run
 *   yarn ts-node -r tsconfig-paths/register scripts/remediate-nebosh-pre-case-study-v1.ts
 *   yarn ts-node -r tsconfig-paths/register scripts/remediate-nebosh-pre-case-study-v1.ts --include-completers
 */

import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import {
  countVersionActiveSections,
  SNAPSHOT_TRANSACTION_OPTIONS,
  snapshotLiveTree,
} from '../src/course-version/course-version.snapshot';

dotenv.config();

const DEFAULT_COURSE_ID = '2ef7ce1b-7e3c-4168-8ef1-39af383174b1';
const CASE_STUDY_CUTOFF = new Date('2026-06-20T00:00:00.000Z');
const EXPECTED_V2_SECTIONS = 115;
const EXPECTED_V1_SECTIONS = 111;

const dryRun = process.argv.includes('--dry-run');
const includeCompleters = process.argv.includes('--include-completers');
const courseIdArg = process.argv.find((a) => a.startsWith('--course-id='));
const courseId = courseIdArg?.split('=')[1] ?? DEFAULT_COURSE_ID;

const datasourceUrl =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';

if (!datasourceUrl) {
  console.error('DATABASE_URL (or DIRECT_DATABASE_URL) is required');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: { db: { url: datasourceUrl } },
});

type RemediationCandidate = {
  userCourseId: string;
  userId: string;
  email: string;
  progressBeforeCutoff: number;
  progressOnCaseStudy: number;
  isCompleter: boolean;
};

async function findCaseStudySectionIds(targetCourseId: string): Promise<string[]> {
  const rows = await prisma.section.findMany({
    where: {
      title: { contains: 'Case Study', mode: 'insensitive' },
      isArchived: false,
      chapter: {
        isArchived: false,
        module: { courseId: targetCourseId, isArchived: false },
      },
    },
    select: { id: true, title: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => r.id);
}

async function isAlreadyRemediated(targetCourseId: string): Promise<boolean> {
  const versions = await prisma.courseVersion.findMany({
    where: { courseId: targetCourseId },
    orderBy: { versionNumber: 'asc' },
  });
  if (versions.length !== 2) return false;

  const [v1, v2] = versions;
  if (v1.versionNumber !== 1 || v2.versionNumber !== 2) return false;

  const [v1Sections, v2Sections] = await Promise.all([
    countVersionActiveSections(prisma, v1.id),
    countVersionActiveSections(prisma, v2.id),
  ]);

  return (
    v1Sections === EXPECTED_V1_SECTIONS &&
    v2Sections === EXPECTED_V2_SECTIONS &&
    v2.isLatest === true
  );
}

async function findRemediationCandidates(
  targetCourseId: string,
  poisonedVersionId: string,
  caseStudyIds: string[],
): Promise<RemediationCandidate[]> {
  const enrollments = await prisma.userCourse.findMany({
    where: {
      courseId: targetCourseId,
      enrolledVersionId: poisonedVersionId,
    },
    include: {
      user: { select: { id: true, email: true } },
    },
  });

  const candidates: RemediationCandidate[] = [];

  for (const uc of enrollments) {
    const completion = await prisma.courseCompletion.findUnique({
      where: {
        userId_courseId: { userId: uc.userId, courseId: targetCourseId },
      },
      select: { courseCompletedAt: true },
    });
    const isCompleter = !!completion?.courseCompletedAt;

    if (isCompleter && !includeCompleters) {
      continue;
    }

    const progress = await prisma.userCourseProgress.findMany({
      where: { userId: uc.userId, courseId: targetCourseId },
      select: { sectionId: true, createdAt: true },
    });

    const progressBeforeCutoff = progress.filter(
      (p) => p.createdAt < CASE_STUDY_CUTOFF,
    ).length;
    const progressOnCaseStudy = progress.filter((p) =>
      caseStudyIds.includes(p.sectionId),
    ).length;

    if (progressBeforeCutoff > 0 && progressOnCaseStudy === 0) {
      candidates.push({
        userCourseId: uc.id,
        userId: uc.userId,
        email: uc.user.email,
        progressBeforeCutoff,
        progressOnCaseStudy,
        isCompleter,
      });
    }
  }

  return candidates.sort((a, b) => a.email.localeCompare(b.email));
}

async function main() {
  console.log(
    `\n🔧 NEBOSH pre-Case-Study v1 remediation${dryRun ? ' (DRY RUN)' : ''}\n`,
  );
  console.log(
    `Using ${process.env.DIRECT_DATABASE_URL ? 'DIRECT_DATABASE_URL' : 'DATABASE_URL'}`,
  );
  console.log(`Course: ${courseId}`);
  console.log(`Include completers: ${includeCompleters}\n`);

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, title: true },
  });
  if (!course) {
    console.error(`Course not found: ${courseId}`);
    process.exit(1);
  }
  console.log(`Course title: "${course.title}"\n`);

  if (await isAlreadyRemediated(courseId)) {
    console.log('✓ Already remediated (v1=111, v2=115). Nothing to do.\n');
    return;
  }

  const caseStudyIds = await findCaseStudySectionIds(courseId);
  if (caseStudyIds.length === 0) {
    console.error('No Case Study sections found — aborting.');
    process.exit(1);
  }
  console.log(`Case Study sections to exclude from corrected v1: ${caseStudyIds.length}`);

  const poisonedV1 = await prisma.courseVersion.findFirst({
    where: { courseId, versionNumber: 1 },
    include: { _count: { select: { sections: true, enrollments: true } } },
  });

  if (!poisonedV1) {
    console.error('No v1 found — run backfill first or check course id.');
    process.exit(1);
  }

  const v2Exists = await prisma.courseVersion.findFirst({
    where: { courseId, versionNumber: 2 },
  });
  if (v2Exists) {
    console.error(
      'v2 already exists but remediation state is unexpected — manual review required.',
    );
    process.exit(1);
  }

  const poisonedSectionCount = await countVersionActiveSections(
    prisma,
    poisonedV1.id,
  );
  console.log(
    `Current v1: ${poisonedSectionCount} sections, ${poisonedV1._count.enrollments} pinned enrollment(s)`,
  );

  if (poisonedSectionCount !== EXPECTED_V2_SECTIONS) {
    console.warn(
      `⚠ Expected ${EXPECTED_V2_SECTIONS} sections in poisoned v1, found ${poisonedSectionCount}. Proceed with caution.`,
    );
  }

  const csInPin = await prisma.courseVersionSection.count({
    where: {
      versionId: poisonedV1.id,
      sourceSectionId: { in: caseStudyIds },
      isActive: true,
    },
  });
  if (csInPin !== caseStudyIds.length) {
    console.warn(
      `⚠ Expected ${caseStudyIds.length} Case Study rows in v1 pin, found ${csInPin}.`,
    );
  }

  const candidates = await findRemediationCandidates(
    courseId,
    poisonedV1.id,
    caseStudyIds,
  );

  console.log(`\n── Re-pin candidates (${candidates.length}) ──`);
  for (const c of candidates) {
    console.log(
      `  ${c.email} | pre-cutoff progress: ${c.progressBeforeCutoff} | completer: ${c.isCompleter}`,
    );
  }

  const stayOnV2 =
    poisonedV1._count.enrollments - candidates.length;
  console.log(`\nStay on v2 (latest): ${stayOnV2} enrollment(s)`);

  if (dryRun) {
    console.log('\n(dry run — no writes)\n');
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.courseVersion.update({
      where: { id: poisonedV1.id },
      data: {
        versionNumber: 2,
        isLatest: true,
        changeNotes:
          'Includes Case Study sections (2026-06-20). Former backfill v1 promoted to v2.',
      },
    });

    const corrected = await snapshotLiveTree(tx, courseId, {
      versionNumber: 1,
      status: 'PUBLISHED',
      isLatest: false,
      publishedAt: new Date('2026-06-19T23:59:59.000Z'),
      changeNotes:
        'Pre-Case-Study curriculum (remediation). Excludes Case Study sections added 2026-06-20.',
      excludeSourceSectionIds: caseStudyIds,
    });

    if (corrected.sectionCount !== EXPECTED_V1_SECTIONS) {
      throw new Error(
        `Corrected v1 has ${corrected.sectionCount} sections, expected ${EXPECTED_V1_SECTIONS}`,
      );
    }

    const repin = await tx.userCourse.updateMany({
      where: { id: { in: candidates.map((c) => c.userCourseId) } },
      data: { enrolledVersionId: corrected.versionId },
    });

    return { corrected, repinned: repin.count };
  }, SNAPSHOT_TRANSACTION_OPTIONS);

  console.log('\n── Done ──');
  console.log(`  Corrected v1 id:     ${result.corrected.versionId}`);
  console.log(`  Corrected v1 sections: ${result.corrected.sectionCount}`);
  console.log(`  Promoted v2 id:      ${poisonedV1.id}`);
  console.log(`  Re-pinned enrollments: ${result.repinned}`);
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
