"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const p = new client_1.PrismaClient();
(async () => {
    const crossAttempt = await p.$queryRaw `
    SELECT cc."userId" AS completion_user, aa."userId" AS attempt_user, count(*)::int AS n
    FROM course_completions cc
    JOIN assessment_attempts aa ON aa.id = cc."bestAttemptId"
    WHERE cc."bestAttemptId" IS NOT NULL AND cc."userId" <> aa."userId"
    GROUP BY 1,2`;
    console.log('A. CourseCompletion.bestAttempt owned by a DIFFERENT user:', crossAttempt.length, crossAttempt);
    const crossNotif = await p.notification.count({
        where: { NOT: { commenterId: null } },
    });
    console.log('B. Notifications with a non-null commenterId (cross-user authored):', crossNotif);
    const subRoles = await p.$queryRaw `
    SELECT
      count(*) FILTER (WHERE "studentId" = "assignedToAdminId")::int AS self_assigned,
      count(*) FILTER (WHERE "reviewedByAdminId" IS NOT NULL AND "studentId" = "reviewedByAdminId")::int AS self_reviewed,
      count(*)::int AS total
    FROM assignment_submissions`;
    console.log('C. AssignmentSubmission role overlap:', subRoles);
})().catch(e => { console.error('ERR', e.message); process.exit(1); })
    .finally(() => p.$disconnect());
//# sourceMappingURL=collateral_audit.js.map