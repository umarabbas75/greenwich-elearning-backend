"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertEnrollmentUsable = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
async function assertEnrollmentUsable(prisma, userId, courseId, userRole) {
    const isLearner = userRole === client_1.Role.user;
    const enrollment = await prisma.userCourse.findFirst({
        where: isLearner
            ? { userId, courseId, isActive: true }
            : { userId, courseId },
    });
    if (!enrollment) {
        throw new common_1.ForbiddenException({
            detail: 'You are not assigned to this course, or the enrolment is inactive',
        });
    }
    if (isLearner) {
        const [completion, course] = await Promise.all([
            prisma.courseCompletion.findUnique({
                where: { userId_courseId: { userId, courseId } },
                select: { courseCompletedAt: true },
            }),
            prisma.course.findUnique({
                where: { id: courseId },
                select: { validityDays: true },
            }),
        ]);
        if (completion?.courseCompletedAt) {
            const validityDays = course?.validityDays ?? 365;
            const expiresAt = new Date(completion.courseCompletedAt);
            expiresAt.setDate(expiresAt.getDate() + validityDays);
            if (new Date() > expiresAt) {
                throw new common_1.ForbiddenException({
                    detail: `Your access to this course expired on ${expiresAt.toISOString().split('T')[0]}. Please contact your administrator to renew access.`,
                });
            }
        }
    }
    return enrollment;
}
exports.assertEnrollmentUsable = assertEnrollmentUsable;
//# sourceMappingURL=assert-enrollment-usable.js.map