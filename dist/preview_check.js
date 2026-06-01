"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const p = new client_1.PrismaClient();
const id = '54261ae3-0391-4790-a3dc-f6f3df4e08e1';
(async () => {
    const u = await p.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
    if (!u) {
        console.log('USER NOT FOUND (may already be deleted/purged):', id);
        await p.$disconnect();
        return;
    }
    const blockers = {
        posts: await p.post.count({ where: { userId: id } }),
        postComments: await p.comment.count({ where: { userId: id } }),
        forumThreads: await p.forumThread.count({ where: { userId: id } }),
        forumComments: await p.forumComment.count({ where: { userId: id } }),
        assignmentsCreated: await p.assignment.count({ where: { createdByAdminId: id } }),
        assignmentsToReview: await p.assignment.count({ where: { assignedToAdminId: id } }),
        assessmentsCreated: await p.assessment.count({ where: { createdByAdminId: id } }),
        submissionsAssignedToReview: await p.assignmentSubmission.count({ where: { assignedToAdminId: id } }),
        submissionsReviewed: await p.assignmentSubmission.count({ where: { reviewedByAdminId: id } }),
    };
    const cascade = {
        enrollments: await p.userCourse.count({ where: { userId: id } }),
        quizProgress: await p.quizProgress.count({ where: { userId: id } }),
        notifications: await p.notification.count({ where: { userId: id } }),
        assessmentAttempts: await p.assessmentAttempt.count({ where: { userId: id } }),
        courseCompletions: await p.courseCompletion.count({ where: { userId: id } }),
        ownSubmissions: await p.assignmentSubmission.count({ where: { studentId: id } }),
    };
    const blockerTotal = Object.values(blockers).reduce((a, b) => a + b, 0);
    console.log('USER:', u);
    console.log('canPurge:', blockerTotal === 0);
    console.log('blockers:', blockers);
    console.log('cascade(sample):', cascade);
    await p.$disconnect();
})().catch(async (e) => { console.error('ERR', e.message); await p.$disconnect(); process.exit(1); });
//# sourceMappingURL=preview_check.js.map