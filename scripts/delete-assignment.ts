/**
 * delete-assignment.ts
 *
 * Deletes one admin-created assignment and its student submissions.
 * Does NOT delete users, courses, or any other assignments.
 *
 * Usage (dry run — default):
 *   yarn script:delete-assignment:dry
 *   yarn script:delete-assignment:dry --title="assignment 1"
 *   yarn script:delete-assignment:dry --id=<uuid>
 *
 * Delete for real:
 *   yarn script:delete-assignment --id=<uuid>
 *   yarn script:delete-assignment --title="assignment 1"
 */

import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const rawUrl = process.env.DATABASE_URL ?? '';
const datasourceUrl = rawUrl.includes('pgbouncer=true')
  ? rawUrl
  : rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'pgbouncer=true&connect_timeout=30';

const prisma = new PrismaClient({ datasources: { db: { url: datasourceUrl } } });

const DEFAULT_TITLE = 'assignment 1';
const shouldDelete = process.argv.includes('--delete');

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function resolveAssignment() {
  const id = parseArg('id');
  const title = parseArg('title') ?? DEFAULT_TITLE;

  if (id) {
    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: {
        course: { select: { id: true, title: true } },
        submissions: {
          select: {
            id: true,
            studentId: true,
            status: true,
            fileName: true,
            submittedAt: true,
            student: { select: { email: true, firstName: true } },
          },
          orderBy: { submittedAt: 'asc' },
        },
      },
    });
    if (!assignment) {
      throw new Error(`No assignment found with id=${id}`);
    }
    return assignment;
  }

  const matches = await prisma.assignment.findMany({
    where: {
      title: { equals: title, mode: 'insensitive' },
    },
    include: {
      course: { select: { id: true, title: true } },
      submissions: {
        select: {
          id: true,
          studentId: true,
          status: true,
          fileName: true,
          submittedAt: true,
          student: { select: { email: true, firstName: true } },
        },
        orderBy: { submittedAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (matches.length === 0) {
    const fuzzy = await prisma.assignment.findMany({
      select: { id: true, title: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const available = fuzzy
      .map((a) => `  • ${a.title || '(no title)'} [${a.id}]`)
      .join('\n');
    throw new Error(
      `No assignment matched title "${title}" (case-insensitive).\n\nAvailable assignments:\n${available}`,
    );
  }

  if (matches.length > 1) {
    const lines = matches
      .map(
        (a) =>
          `  • ${a.title} [${a.id}] — course: ${a.course.title}, submissions: ${a.submissions.length}`,
      )
      .join('\n');
    throw new Error(
      `Multiple assignments matched title "${title}". Pass --id= explicitly.\n\nMatches:\n${lines}`,
    );
  }

  return matches[0];
}

async function main() {
  const mode = shouldDelete ? 'DELETE' : 'DRY RUN';
  console.log(`\n📋 Delete assignment script — ${mode}\n`);

  const [assignment, userCount, courseCount] = await Promise.all([
    resolveAssignment(),
    prisma.user.count(),
    prisma.course.count(),
  ]);

  console.log('Target assignment:');
  console.log(`  id          : ${assignment.id}`);
  console.log(`  title       : ${assignment.title}`);
  console.log(`  course      : ${assignment.course.title} (${assignment.course.id})`);
  console.log(`  createdAt   : ${assignment.createdAt.toISOString().slice(0, 10)}`);
  console.log(`  isActive    : ${assignment.isActive}`);
  console.log(`  submissions : ${assignment.submissions.length}`);
  console.log();

  if (assignment.submissions.length > 0) {
    console.log('Submissions to delete:');
    for (const s of assignment.submissions) {
      const who = s.student.email ?? s.studentId;
      console.log(
        `  • ${who} — ${s.status} — submitted ${s.submittedAt.toISOString().slice(0, 10)}`,
      );
    }
    console.log();
  }

  console.log('Will delete:');
  console.log(`  assignment_submissions : ${assignment.submissions.length}`);
  console.log(`  assignments            : 1`);
  console.log();
  console.log('Will NOT delete:');
  console.log(`  users   (currently ${userCount})`);
  console.log(`  courses (currently ${courseCount})`);
  console.log(`  course  "${assignment.course.title}" stays intact`);
  console.log();

  if (!shouldDelete) {
    console.log('ℹ️  Dry run — pass --delete to remove this assignment and its submissions.\n');
    return;
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const submissions = await tx.assignmentSubmission.deleteMany({
      where: { assignmentId: assignment.id },
    });
    const assignments = await tx.assignment.deleteMany({
      where: { id: assignment.id },
    });
    return { submissions: submissions.count, assignments: assignments.count };
  });

  const [usersAfter, coursesAfter, stillThere] = await Promise.all([
    prisma.user.count(),
    prisma.course.count(),
    prisma.assignment.findUnique({ where: { id: assignment.id } }),
  ]);

  console.log('🗑️  Deleted:');
  console.log(`  ✓ ${deleted.submissions} assignment_submissions`);
  console.log(`  ✓ ${deleted.assignments} assignments`);
  console.log();
  console.log('Safety check:');
  console.log(`  users unchanged   : ${usersAfter === userCount ? 'yes' : 'NO'}`);
  console.log(`  courses unchanged : ${coursesAfter === courseCount ? 'yes' : 'NO'}`);
  console.log(`  assignment gone   : ${stillThere ? 'NO' : 'yes'}`);
  console.log('\n✅ Done.\n');
}

main()
  .catch((err) => {
    console.error('\n❌ Error:', err.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
