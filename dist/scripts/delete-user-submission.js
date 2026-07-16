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
const SUBMISSION_ID = '67982383-ecbb-478c-91d0-71fa8880d52e';
const EXPECTED_EMAIL = 'umiar.khan5590@gmail.com';
const isDelete = process.argv.includes('--delete');
async function main() {
    const sub = await prisma.assignmentSubmission.findUnique({
        where: { id: SUBMISSION_ID },
        include: {
            student: { select: { email: true } },
            assignment: { select: { title: true } },
            attachments: true,
        },
    });
    if (!sub) {
        console.log('Submission not found — already deleted?', SUBMISSION_ID);
        return;
    }
    console.log('Target submission:');
    console.log('  id        :', sub.id);
    console.log('  student   :', sub.student?.email);
    console.log('  assignment:', sub.assignment?.title);
    console.log('  status    :', sub.status);
    console.log('  attachments:', sub.attachments.length);
    if (sub.student?.email !== EXPECTED_EMAIL) {
        throw new Error(`Refusing to delete: student email ${sub.student?.email} != expected ${EXPECTED_EMAIL}`);
    }
    if (!isDelete) {
        console.log('\nDRY RUN — pass --delete to actually delete. Nothing changed.');
        return;
    }
    const deleted = await prisma.assignmentSubmission.delete({
        where: { id: SUBMISSION_ID },
    });
    console.log('\nDeleted submission', deleted.id, '(attachments cascade-deleted).');
    console.log('Notifications intentionally left untouched.');
}
main()
    .catch((err) => {
    console.error('\nError:', err.message ?? err);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=delete-user-submission.js.map