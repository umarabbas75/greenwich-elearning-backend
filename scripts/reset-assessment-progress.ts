/**
 * reset-assessment-progress.ts
 *
 * Deletes all user-specific assessment data:
 *   - attempt_question_snapshots  (answers, scores, per-attempt question copies)
 *   - course_completions          (pass/fail records, certificate URLs)
 *   - assessment_attempts         (all student attempts)
 *
 * Does NOT touch:
 *   - assessments                 (assessment definitions)
 *   - assessment_questions        (question rosters)
 *   - questions / question_categories (question bank)
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/reset-assessment-progress.ts
 *
 * Add --dry-run to preview counts without deleting:
 *   npx ts-node -r tsconfig-paths/register scripts/reset-assessment-progress.ts --dry-run
 */

import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

// Neon uses pgBouncer in transaction mode by default.
// Scripts run outside the app server need pgbouncer=true to avoid
// "connection pool timeout" errors when opening a direct connection.
const rawUrl = process.env.DATABASE_URL ?? '';
const datasourceUrl = rawUrl.includes('pgbouncer=true')
  ? rawUrl
  : rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'pgbouncer=true&connect_timeout=30';

const prisma = new PrismaClient({ datasources: { db: { url: datasourceUrl } } });
const isDryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(`\n🔍 Counting records...\n`);

  const [snapshots, completions, attempts] = await Promise.all([
    prisma.attemptQuestionSnapshot.count(),
    prisma.courseCompletion.count(),
    prisma.assessmentAttempt.count(),
  ]);

  console.log(`  attempt_question_snapshots : ${snapshots}`);
  console.log(`  course_completions         : ${completions}`);
  console.log(`  assessment_attempts        : ${attempts}`);
  console.log();

  if (isDryRun) {
    console.log('ℹ️  Dry run — no data was deleted.\n');
    return;
  }

  if (snapshots + completions + attempts === 0) {
    console.log('✅ Nothing to delete — all tables are already empty.\n');
    return;
  }

  console.log('🗑️  Deleting...\n');

  const [deletedSnapshots, deletedCompletions, deletedAttempts] = await prisma.$transaction([
    prisma.attemptQuestionSnapshot.deleteMany(),
    prisma.courseCompletion.deleteMany(),
    prisma.assessmentAttempt.deleteMany(),
  ]);

  console.log(`  ✓ Deleted ${deletedSnapshots.count} attempt_question_snapshots`);
  console.log(`  ✓ Deleted ${deletedCompletions.count} course_completions`);
  console.log(`  ✓ Deleted ${deletedAttempts.count} assessment_attempts`);
  console.log('\n✅ Assessment progress reset complete.\n');
}

main()
  .catch((err) => {
    console.error('\n❌ Error:', err.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
