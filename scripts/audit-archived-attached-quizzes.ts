/**
 * audit-archived-attached-quizzes.ts   (READ-ONLY — issues no writes)
 *
 * Reports quizzes that are archived (isArchived = true) while still carrying a
 * chapterId, per chapter, alongside what the chapter's CURRENT latest published
 * version says.
 *
 * ⚠️ READ THIS BEFORE ACTING ON THE OUTPUT.
 *
 * `isArchived = true AND chapterId IS NOT NULL` is NOT by itself a bug signature —
 * it is the ordinary resting state of a deliberately-retired quiz:
 *
 *   • deleteQuiz on a version-referenced quiz sets { isArchived: true } and
 *     deliberately LEAVES chapterId, so version history still resolves the row.
 *   • unAssignQuiz on a version-referenced quiz sets { isArchived: true,
 *     chapterId: null }.
 *
 * The genuine bug this was written for is narrower: assignQuiz used to re-attach
 * with a bare relation `connect`, which set chapterId but left isArchived true —
 * producing a quiz the admin had just assigned and expected to be live, yet which
 * is invisible to _count.quizzes, getAllAssignQuizzes and buildManifestFromLiveTree
 * (all filter isArchived: false). Fixed: assignQuiz now writes
 * { chapterId, isArchived: false }.
 *
 * There is NO way to tell those two apart from row state alone — both look
 * identical in the database. Distinguishing them requires intent, which is why
 * this script does not repair anything. Use the timeline it prints (updatedAt vs.
 * the version changeNotes) plus your own knowledge of what you archived on
 * purpose. A quiz archived seconds after being assigned, with a version whose
 * changeNotes say "Assigned quiz…" and no matching "Archived quiz…" after it, is
 * a bug victim. A quiz whose archive lines up with an explicit "Archived quiz…"
 * version is intentional — leave it alone.
 *
 * To bring a specific quiz back, re-assign it through the API (assignQuiz now
 * un-archives correctly). Do not bulk-flip isArchived.
 *
 *   yarn script:audit-archived-quizzes
 */

import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const rawDatasourceUrl =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
if (!rawDatasourceUrl) {
  console.error('DIRECT_DATABASE_URL (or DATABASE_URL) is required');
  process.exit(1);
}

/**
 * Neon cold-start regularly exceeds libpq's 5s default and DIRECT_DATABASE_URL
 * usually carries no query string (it exists for `prisma migrate`), so a
 * long-running script can P1001 partway through — the worst failure shape for an
 * audit, since it has already printed partial results. Force a generous
 * connect_timeout unless the URL already sets one.
 */
function withConnectTimeout(url: string, seconds = 30): string {
  if (/[?&]connect_timeout=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}connect_timeout=${seconds}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: withConnectTimeout(rawDatasourceUrl) } },
});

const iso = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 16).replace('T', ' ') : '—';

async function main() {
  console.log('\n📋 Archived-but-attached quizzes (READ-ONLY)\n');
  console.log(
    '   Reminder: this state is NORMAL for intentionally retired quizzes.\n' +
      '   Cross-check the timeline before concluding anything is broken.\n',
  );

  const archived = await prisma.quiz.findMany({
    where: { isArchived: true, chapterId: { not: null } },
    select: {
      id: true,
      question: true,
      updatedAt: true,
      chapterId: true,
      chapter: {
        select: {
          title: true,
          module: {
            select: { courseId: true, course: { select: { title: true } } },
          },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (archived.length === 0) {
    console.log('  No archived-but-attached quizzes found.\n');
    return;
  }

  const byChapter = new Map<
    string,
    {
      chapterTitle: string;
      courseId: string | null;
      courseTitle: string;
      rows: typeof archived;
    }
  >();
  for (const q of archived) {
    const key = q.chapterId as string;
    const e = byChapter.get(key) ?? {
      chapterTitle: q.chapter?.title ?? '(chapter missing)',
      courseId: q.chapter?.module?.courseId ?? null,
      courseTitle: q.chapter?.module?.course?.title ?? '(course missing)',
      rows: [] as typeof archived,
    };
    e.rows.push(q);
    byChapter.set(key, e);
  }

  console.log(
    `  ${archived.length} archived quiz row(s) still attached, across ${byChapter.size} chapter(s):\n`,
  );

  for (const [chapterId, info] of byChapter) {
    const activeNow = await prisma.quiz.count({
      where: { chapterId, isArchived: false },
    });

    // What the learner-facing denominator actually is right now.
    const [answers, progress] = await Promise.all([
      prisma.quizAnswer.count({ where: { chapterId } }),
      prisma.quizProgress.count({ where: { chapterId } }),
    ]);

    console.log(`  • "${info.courseTitle}" → "${info.chapterTitle}"`);
    console.log(`    chapter ${chapterId}`);
    console.log(
      `    active quizzes: ${activeNow}   archived-but-attached: ${info.rows.length}`,
    );
    console.log(
      `    learner data on this chapter: ${answers} answer row(s), ${progress} quizProgress row(s)`,
    );
    if (activeNow === 0 && info.rows.length > 0) {
      console.log(
        `    ⚠️  ZERO active quizzes — learners see no quiz here. Intentional only if\n` +
          `        you meant to retire the whole chapter quiz set.`,
      );
    }
    for (const q of info.rows) {
      console.log(
        `      archived ${iso(q.updatedAt)}  ${q.id.slice(0, 8)}  ${q.question.slice(0, 50)}`,
      );
    }

    // Version timeline: the changeNotes are the intent record.
    if (info.courseId) {
      const recent = await prisma.courseVersion.findMany({
        where: { courseId: info.courseId },
        orderBy: { versionNumber: 'desc' },
        take: 6,
        select: { versionNumber: true, publishedAt: true, changeNotes: true, isLatest: true },
      });
      console.log('    recent versions (intent record):');
      for (const v of recent) {
        console.log(
          `      v${v.versionNumber}${v.isLatest ? ' [latest]' : ''} ${iso(
            v.publishedAt,
          )}  ${(v.changeNotes ?? '').slice(0, 58)}`,
        );
      }
    }
    console.log();
  }

  // Does the latest manifest agree with the live active set?
  console.log('  ── latest-version vs live cross-check ──');
  const courseIds = [...new Set([...byChapter.values()].map((i) => i.courseId))].filter(
    (c): c is string => Boolean(c),
  );
  for (const courseId of courseIds) {
    const latest = await prisma.courseVersion.findFirst({
      where: { courseId, isLatest: true },
      select: { versionNumber: true, manifest: true },
    });
    if (!latest) {
      console.log(`    course ${courseId}: no published version`);
      continue;
    }
    const manifest = latest.manifest as unknown as {
      modules?: Array<{ chapters?: Array<{ sourceId: string; quizIds: string[] }> }>;
    } | null;
    for (const [chapterId, info] of byChapter) {
      if (info.courseId !== courseId) continue;
      let inManifest: number | null = null;
      for (const mod of manifest?.modules ?? []) {
        const ch = mod.chapters?.find((c) => c.sourceId === chapterId);
        if (ch) inManifest = ch.quizIds.length;
      }
      const activeNow = await prisma.quiz.count({
        where: { chapterId, isArchived: false },
      });
      const agree = inManifest === activeNow;
      console.log(
        `    v${latest.versionNumber} "${info.chapterTitle.slice(0, 34)}": manifest=${
          inManifest ?? 'absent'
        } live=${activeNow} ${agree ? '✓ agree' : '✗ DRIFT — run script:reconcile-drift'}`,
      );
    }
  }

  console.log(
    '\n  No changes made (this script never writes). To restore a specific quiz,\n' +
      '  re-assign it via the API — assignQuiz now clears isArchived correctly.\n',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
