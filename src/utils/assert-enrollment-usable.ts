import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Shared enrolment gate. Extracted from CourseService so ScormModule can
 * enforce the same UserCourse.isActive / validityDays rules without importing
 * CourseService (this repo has zero forwardRef usages).
 *
 * Callers MUST pass `Role.user` for learners — the helper only enforces
 * active enrolment and post-completion expiry when `userRole === Role.user`.
 */
export async function assertEnrollmentUsable(
  prisma: PrismaService,
  userId: string,
  courseId: string,
  userRole: Role,
): Promise<{ id: string; userId: string; courseId: string; isActive: boolean }> {
  const isLearner = userRole === Role.user;
  const enrollment = await prisma.userCourse.findFirst({
    where: isLearner
      ? { userId, courseId, isActive: true }
      : { userId, courseId },
  });
  if (!enrollment) {
    throw new ForbiddenException({
      detail:
        'You are not assigned to this course, or the enrolment is inactive',
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
        throw new ForbiddenException({
          detail: `Your access to this course expired on ${
            expiresAt.toISOString().split('T')[0]
          }. Please contact your administrator to renew access.`,
        });
      }
    }
  }

  return enrollment;
}
