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
    const subs = await prisma.assignmentSubmission.findMany({
        where: { studentId: user.id },
        orderBy: { submittedAt: 'desc' },
        include: {
            assignment: { select: { id: true, title: true, courseId: true } },
            attachments: true,
        },
    });
    console.log('ASSIGNMENT_SUBMISSIONS:', subs.length);
    for (const s of subs) {
        console.log(JSON.stringify({
            submissionId: s.id,
            assignmentId: s.assignmentId,
            assignmentTitle: s.assignment?.title,
            courseId: s.assignment?.courseId,
            status: s.status,
            fileName: s.fileName,
            submittedAt: s.submittedAt,
            attachmentCount: s.attachments.length,
            attachmentFiles: s.attachments.map((a) => a.fileName),
        }));
    }
}
main()
    .catch((err) => {
    console.error('\nError:', err.message ?? err);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=find-user-submissions.js.map