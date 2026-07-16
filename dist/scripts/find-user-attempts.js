"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
dotenv.config();
const rawUrl = process.env.DATABASE_URL ?? '';
const datasourceUrl = rawUrl.includes('pgbouncer=true')
    ? rawUrl
    : rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'pgbouncer=true&connect_timeout=30';
const prisma = new client_1.PrismaClient({ datasources: { db: { url: datasourceUrl } } });
async function main() {
    const email = process.argv[2] ?? 'umiar.khan5590@gmail.com';
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        console.log('NO USER for', email);
        return;
    }
    console.log('USER:', user.id, user.email, user.firstName ?? '', user.lastName ?? '');
    const attempts = await prisma.assessmentAttempt.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { questionSnapshots: true } } },
    });
    console.log('ATTEMPTS:', attempts.length);
    for (const a of attempts) {
        console.log(JSON.stringify({
            id: a.id,
            assessmentId: a.assessmentId,
            status: a.status,
            title: a.snapshotTitle,
            isPassed: a.isPassed,
            percentage: a.percentage,
            startedAt: a.startedAt,
            submittedAt: a.submittedAt,
            createdAt: a.createdAt,
            snapshots: a._count?.questionSnapshots,
        }));
    }
    const completions = await prisma.courseCompletion.findMany({
        where: { userId: user.id },
    });
    console.log('COURSE_COMPLETIONS:', completions.length);
    for (const c of completions) {
        console.log(JSON.stringify(c));
    }
}
main()
    .catch((err) => {
    console.error('\nError:', err.message ?? err);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=find-user-attempts.js.map