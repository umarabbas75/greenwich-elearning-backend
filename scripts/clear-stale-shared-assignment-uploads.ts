/**
 * Clear submissions that reused Imad's Cloudinary answer-sheet asset.
 *
 * Does NOT delete Imad's submission or the Cloudinary file.
 * Does NOT send email — ops sends manually from the template printed at the end.
 *
 * Usage:
 *   yarn ts-node -r tsconfig-paths/register scripts/clear-stale-shared-assignment-uploads.ts
 *   yarn ts-node -r tsconfig-paths/register scripts/clear-stale-shared-assignment-uploads.ts --delete
 */
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const rawUrl = process.env.DATABASE_URL ?? '';
const datasourceUrl = rawUrl.includes('pgbouncer=true')
  ? rawUrl
  : rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'pgbouncer=true&connect_timeout=30';

const prisma = new PrismaClient({ datasources: { db: { url: datasourceUrl } } });

const STALE_FILE_URL =
  'https://res.cloudinary.com/dp9urvlsz/raw/upload/v1781429861/my_uploads/GIC1_IG1-0061-ENG-OBE-Answer-sheet-V1.pdf';

/** First uploader — keep their row and the Cloudinary asset. */
const KEEP_EMAIL = 'imadmuhammad246@gmail.com';

const isDelete = process.argv.includes('--delete');

async function main() {
  const matches = await prisma.assignmentSubmission.findMany({
    where: {
      OR: [
        { fileUrl: STALE_FILE_URL },
        { attachments: { some: { fileUrl: STALE_FILE_URL } } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    include: {
      student: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
      assignment: { select: { id: true, title: true } },
      attachments: { select: { id: true, fileUrl: true, fileName: true } },
    },
  });

  const keep = matches.filter(
    (s) => s.student.email.toLowerCase() === KEEP_EMAIL.toLowerCase(),
  );
  const toClear = matches.filter(
    (s) => s.student.email.toLowerCase() !== KEEP_EMAIL.toLowerCase(),
  );

  console.log('Stale Cloudinary URL:');
  console.log(' ', STALE_FILE_URL);
  console.log('\nKEEP (Imad — do not delete):', keep.length);
  for (const s of keep) {
    console.log(
      `  ${s.student.email} | ${s.status} score=${s.score ?? 'n/a'} | ${s.assignment.title}`,
    );
    console.log(`    submissionId=${s.id}`);
  }

  console.log('\nCLEAR (bad shared-URL submissions):', toClear.length);
  for (const s of toClear) {
    console.log(
      `  ${s.student.firstName} ${s.student.lastName} <${s.student.email}>`,
    );
    console.log(`    submissionId=${s.id}`);
    console.log(`    assignment=${s.assignment.title}`);
    console.log(
      `    status=${s.status} score=${s.score ?? 'n/a'} gradedAt=${s.gradedAt?.toISOString() ?? 'n/a'}`,
    );
    console.log(`    attachments=${s.attachments.length}`);
  }

  if (toClear.length === 0) {
    console.log('\nNothing to clear.');
    return;
  }

  if (!isDelete) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --delete to clear.');
    printEmailTemplate(toClear);
    return;
  }

  const ids = toClear.map((s) => s.id);
  const result = await prisma.assignmentSubmission.deleteMany({
    where: { id: { in: ids } },
  });
  console.log(
    `\nDeleted ${result.count} submission(s). Attachments cascade-deleted.`,
  );
  console.log('Cloudinary asset left intact (Imad). Notifications left as-is.');
  printEmailTemplate(toClear);
}

function printEmailTemplate(
  rows: Array<{
    student: { firstName: string; lastName: string; email: string };
    assignment: { title: string };
    status: string;
    score: number | null;
  }>,
) {
  console.log('\n────────────────────────────────────────────────────────');
  console.log('EMAIL TEMPLATE (send manually to each student below)');
  console.log('────────────────────────────────────────────────────────\n');

  for (const s of rows) {
    const name = `${s.student.firstName} ${s.student.lastName}`.trim();
    const voidGradeNote =
      s.status === 'approved' || s.score != null
        ? `\nImportant: Any grade previously recorded against this submission (including a score of ${s.score ?? 'n/a'}) has been cleared, because the file we received was not your own upload. After you resubmit correctly, your tutor will review your work again.\n`
        : '';

    console.log(`To: ${s.student.email}`);
    console.log(
      `Subject: Action required — please re-submit your NEBOSH mock assessment\n`,
    );
    console.log(`Dear ${name},

Assalamualaikum.

We are contacting you about your submission for:

  ${s.assignment.title}

Due to a technical issue with file uploads, your submission was linked to an incorrect shared answer-sheet file (not your own PDF). We have removed that submission from the LMS so you can upload again.
${voidGradeNote}
What you need to do:
1. Open the LMS and go to the assignment above.
2. Upload your completed answer sheet again (PDF).
3. Prefer renaming the file with your name before upload, e.g. ${name.replace(/\s+/g, '-')}-GIC1-mock.pdf
   (Even if you keep the default filename, the system will now store a unique file.)
4. Submit as usual.

Please keep a local copy of your PDF — we cannot recover the earlier upload from our side.

If you have any trouble submitting, reply to this email and we will help.

JazakAllah khair,
Greenwich Training & Consulting
`);
    console.log('────────────────────────────────────────────────────────\n');
  }
}

main()
  .catch((err) => {
    console.error('\nError:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
