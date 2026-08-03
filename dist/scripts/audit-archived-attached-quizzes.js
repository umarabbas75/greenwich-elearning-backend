"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
dotenv.config();
const rawDatasourceUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
if (!rawDatasourceUrl) {
    console.error('DIRECT_DATABASE_URL (or DATABASE_URL) is required');
    process.exit(1);
}
function withConnectTimeout(url, seconds = 30) {
    if (/[?&]connect_timeout=/.test(url))
        return url;
    return `${url}${url.includes('?') ? '&' : '?'}connect_timeout=${seconds}`;
}
const prisma = new client_1.PrismaClient({
    datasources: { db: { url: withConnectTimeout(rawDatasourceUrl) } },
});
const iso = (d) => d ? d.toISOString().slice(0, 16).replace('T', ' ') : '—';
async function main() {
    console.log('\n📋 Archived-but-attached quizzes (READ-ONLY)\n');
    console.log('   Reminder: this state is NORMAL for intentionally retired quizzes.\n' +
        '   Cross-check the timeline before concluding anything is broken.\n');
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
    const byChapter = new Map();
    for (const q of archived) {
        const key = q.chapterId;
        const e = byChapter.get(key) ?? {
            chapterTitle: q.chapter?.title ?? '(chapter missing)',
            courseId: q.chapter?.module?.courseId ?? null,
            courseTitle: q.chapter?.module?.course?.title ?? '(course missing)',
            rows: [],
        };
        e.rows.push(q);
        byChapter.set(key, e);
    }
    console.log(`  ${archived.length} archived quiz row(s) still attached, across ${byChapter.size} chapter(s):\n`);
    for (const [chapterId, info] of byChapter) {
        const activeNow = await prisma.quiz.count({
            where: { chapterId, isArchived: false },
        });
        const [answers, progress] = await Promise.all([
            prisma.quizAnswer.count({ where: { chapterId } }),
            prisma.quizProgress.count({ where: { chapterId } }),
        ]);
        console.log(`  • "${info.courseTitle}" → "${info.chapterTitle}"`);
        console.log(`    chapter ${chapterId}`);
        console.log(`    active quizzes: ${activeNow}   archived-but-attached: ${info.rows.length}`);
        console.log(`    learner data on this chapter: ${answers} answer row(s), ${progress} quizProgress row(s)`);
        if (activeNow === 0 && info.rows.length > 0) {
            console.log(`    ⚠️  ZERO active quizzes — learners see no quiz here. Intentional only if\n` +
                `        you meant to retire the whole chapter quiz set.`);
        }
        for (const q of info.rows) {
            console.log(`      archived ${iso(q.updatedAt)}  ${q.id.slice(0, 8)}  ${q.question.slice(0, 50)}`);
        }
        if (info.courseId) {
            const recent = await prisma.courseVersion.findMany({
                where: { courseId: info.courseId },
                orderBy: { versionNumber: 'desc' },
                take: 6,
                select: { versionNumber: true, publishedAt: true, changeNotes: true, isLatest: true },
            });
            console.log('    recent versions (intent record):');
            for (const v of recent) {
                console.log(`      v${v.versionNumber}${v.isLatest ? ' [latest]' : ''} ${iso(v.publishedAt)}  ${(v.changeNotes ?? '').slice(0, 58)}`);
            }
        }
        console.log();
    }
    console.log('  ── latest-version vs live cross-check ──');
    const courseIds = [...new Set([...byChapter.values()].map((i) => i.courseId))].filter((c) => Boolean(c));
    for (const courseId of courseIds) {
        const latest = await prisma.courseVersion.findFirst({
            where: { courseId, isLatest: true },
            select: { versionNumber: true, manifest: true },
        });
        if (!latest) {
            console.log(`    course ${courseId}: no published version`);
            continue;
        }
        const manifest = latest.manifest;
        for (const [chapterId, info] of byChapter) {
            if (info.courseId !== courseId)
                continue;
            let inManifest = null;
            for (const mod of manifest?.modules ?? []) {
                const ch = mod.chapters?.find((c) => c.sourceId === chapterId);
                if (ch)
                    inManifest = ch.quizIds.length;
            }
            const activeNow = await prisma.quiz.count({
                where: { chapterId, isArchived: false },
            });
            const agree = inManifest === activeNow;
            console.log(`    v${latest.versionNumber} "${info.chapterTitle.slice(0, 34)}": manifest=${inManifest ?? 'absent'} live=${activeNow} ${agree ? '✓ agree' : '✗ DRIFT — run script:reconcile-drift'}`);
        }
    }
    console.log('\n  No changes made (this script never writes). To restore a specific quiz,\n' +
        '  re-assign it via the API — assignQuiz now clears isArchived correctly.\n');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=audit-archived-attached-quizzes.js.map