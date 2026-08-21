"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
const assignment_service_1 = require("../src/assignment/assignment.service");
dotenv.config();
const rawUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const datasourceUrl = rawUrl.includes('-pooler') && !rawUrl.includes('pgbouncer=true')
    ? rawUrl +
        (rawUrl.includes('?') ? '&' : '?') +
        'pgbouncer=true&connect_timeout=30'
    : rawUrl;
const prisma = new client_1.PrismaClient({
    datasources: { db: { url: datasourceUrl } },
});
const stamp = Date.now();
function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}
function pdf(name) {
    return {
        fileUrl: `https://cdn.example.invalid/e2e/${stamp}/${name}`,
        fileName: name,
        fileType: 'pdf',
    };
}
async function expectReject(runner, message) {
    try {
        await runner();
    }
    catch {
        return;
    }
    throw new Error(message);
}
async function main() {
    const captured = [];
    const service = new assignment_service_1.AssignmentService(prisma, {
        createNotification: async (input) => {
            captured.push(input);
        },
        createNotificationForMany: async () => undefined,
    });
    const admin = await prisma.user.findFirst({
        where: { role: 'admin', deletedAt: null },
        select: { id: true, email: true },
    });
    assert(admin, 'Need at least one admin user in the database');
    const enrollment = await prisma.userCourse.findFirst({
        where: { isActive: true, user: { role: 'user', deletedAt: null } },
        select: { userId: true, courseId: true },
    });
    assert(enrollment, 'Need an active student enrollment to run this check');
    const sample = await prisma.assignment.findFirst({
        select: { gradingMode: true, maxPoints: true },
    });
    if (sample) {
        assert(sample.gradingMode === 'numeric' || sample.gradingMode === 'pass_fail', `Unexpected gradingMode on existing row: ${sample.gradingMode}`);
        console.log(`Existing assignment sample gradingMode=${sample.gradingMode} maxPoints=${sample.maxPoints}`);
    }
    const leftover = await prisma.assignment.findMany({
        where: { title: { startsWith: '__e2e_' } },
        select: { id: true },
    });
    if (leftover.length) {
        const leftoverIds = leftover.map((row) => row.id);
        await prisma.assignmentSubmission.deleteMany({
            where: { assignmentId: { in: leftoverIds } },
        });
        await prisma.assignment.deleteMany({ where: { id: { in: leftoverIds } } });
        console.log(`removed ${leftover.length} leftover e2e assignment(s)`);
    }
    let passFailId;
    let numericId;
    try {
        const createdPassFail = await service.createAssignment(admin.id, {
            title: `__e2e_pass_fail_${stamp}`,
            courseId: enrollment.courseId,
            assignedToAdminId: admin.id,
            gradingMode: 'pass_fail',
            maxPoints: 100,
        });
        const passFail = createdPassFail.data;
        passFailId = passFail.id;
        assert(passFail.gradingMode === 'pass_fail', 'create pass_fail did not stick');
        assert(passFail.maxPoints === null, 'pass_fail must force maxPoints null');
        console.log('created pass_fail assignment');
        const fetched = await service.getAssignmentById(passFail.id);
        assert(fetched.data.gradingMode === 'pass_fail', 'GET assignment missing gradingMode');
        const submitted = await service.createSubmission(enrollment.userId, {
            assignmentId: passFail.id,
            submissionAttachments: [pdf('practical.pdf')],
        });
        const submission = submitted.data;
        assert(submission.assignment?.gradingMode === 'pass_fail', 'submit payload missing nested assignment.gradingMode');
        const status = await service.getAssignmentStatusForStudent(enrollment.userId, passFail.id);
        const statusData = status.data;
        assert(statusData.assignment.gradingMode === 'pass_fail' &&
            statusData.assignment.maxPoints === null, 'student status assignment.gradingMode mismatch');
        await expectReject(() => service.reviewSubmission(admin.id, {
            submissionId: submission.id,
            status: 'approved',
            score: 87,
        }), 'pass_fail review must reject a numeric score');
        const passed = await service.reviewSubmission(admin.id, {
            submissionId: submission.id,
            status: 'approved',
            score: null,
            feedback: '<p>Passed</p>',
        });
        const passedRow = passed.data;
        assert(passedRow.status === 'approved', 'pass_fail approve did not set approved');
        assert(passedRow.score === null, 'pass_fail review must store score null');
        assert(passedRow.assignment?.gradingMode === 'pass_fail', 'review payload missing nested assignment.gradingMode');
        const gradedNotify = captured.find((row) => row.payload?.gradingMode === 'pass_fail');
        assert(gradedNotify?.payload?.submissionStatus === 'approved', 'ASSIGNMENT_GRADED payload missing pass_fail gradingMode');
        console.log('pass_fail review + notification payload ok');
        const createdNumeric = await service.createAssignment(admin.id, {
            title: `__e2e_numeric_${stamp}`,
            courseId: enrollment.courseId,
            assignedToAdminId: admin.id,
            gradingMode: 'numeric',
        });
        const numeric = createdNumeric.data;
        numericId = numeric.id;
        assert(numeric.gradingMode === 'numeric', 'numeric create missing gradingMode');
        assert(numeric.maxPoints === 100, 'numeric create should default maxPoints to 100');
        const numericSubmit = await service.createSubmission(enrollment.userId, {
            assignmentId: numeric.id,
            submissionAttachments: [pdf('mock.pdf')],
        });
        const numericSub = numericSubmit.data;
        await expectReject(() => service.reviewSubmission(admin.id, {
            submissionId: numericSub.id,
            status: 'approved',
        }), 'numeric approve must require score');
        const scored = await service.reviewSubmission(admin.id, {
            submissionId: numericSub.id,
            status: 'approved',
            score: '92',
        });
        assert(scored.data.score === 92, 'numeric review should coerce string score');
        console.log('numeric review with string score ok');
        const switched = await service.updateAssignment(admin.id, {
            assignmentId: numeric.id,
            gradingMode: 'pass_fail',
        });
        const switchedRow = switched.data;
        assert(switchedRow.gradingMode === 'pass_fail', 'update to pass_fail did not stick');
        assert(switchedRow.maxPoints === null, 'update to pass_fail must clear maxPoints');
        const nested = await prisma.assignmentSubmission.findUnique({
            where: { id: submission.id },
            select: { assignment: { select: { gradingMode: true, maxPoints: true } } },
        });
        assert(nested?.assignment.gradingMode === 'pass_fail', 'nested submission.assignment.gradingMode missing');
        console.log('gradingMode end-to-end checks passed');
    }
    finally {
        const ids = [passFailId, numericId].filter(Boolean);
        if (ids.length) {
            await prisma.assignmentSubmission.deleteMany({
                where: { assignmentId: { in: ids } },
            });
            await prisma.notification.deleteMany({
                where: {
                    OR: ids.flatMap((id) => [
                        { groupKey: `assignment-created:${id}` },
                        { groupKey: `assignment-submitted:${id}` },
                    ]),
                },
            });
            await prisma.assignment.deleteMany({ where: { id: { in: ids } } });
            console.log(`cleaned up ${ids.length} e2e assignment(s)`);
        }
        await prisma.$disconnect();
    }
}
main().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
});
//# sourceMappingURL=verify-assignment-grading-mode.js.map