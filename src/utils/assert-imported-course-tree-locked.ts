import { ForbiddenException } from '@nestjs/common';
import { CourseDeliveryMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const IMPORTED_SCORM_TREE_LOCKED_MESSAGE =
  'Imported SCORM courses have a locked curriculum. Replace the package instead of editing the tree.';

export type ImportedCourseTreeRef = {
  courseId?: string;
  moduleId?: string;
  chapterId?: string;
  sectionId?: string;
};

/**
 * Reject any native tree write on an IMPORTED_SCORM course. Extra live
 * sections would make countCompletionDenominator wait forever and
 * checkContentCompletion would never stamp courseCompletedAt.
 */
export async function assertImportedCourseTreeLocked(
  prisma: PrismaService,
  ref: ImportedCourseTreeRef,
): Promise<void> {
  const courseId = await resolveCourseId(prisma, ref);
  if (!courseId) return;

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { deliveryMode: true },
  });
  if (course?.deliveryMode === CourseDeliveryMode.IMPORTED_SCORM) {
    throw new ForbiddenException(IMPORTED_SCORM_TREE_LOCKED_MESSAGE);
  }
}

async function resolveCourseId(
  prisma: PrismaService,
  ref: ImportedCourseTreeRef,
): Promise<string | null> {
  if (ref.courseId) return ref.courseId;

  if (ref.moduleId) {
    const mod = await prisma.module.findUnique({
      where: { id: ref.moduleId },
      select: { courseId: true },
    });
    return mod?.courseId ?? null;
  }

  if (ref.chapterId) {
    const chapter = await prisma.chapter.findUnique({
      where: { id: ref.chapterId },
      select: { module: { select: { courseId: true } } },
    });
    return chapter?.module?.courseId ?? null;
  }

  if (ref.sectionId) {
    const section = await prisma.section.findUnique({
      where: { id: ref.sectionId },
      select: {
        chapter: { select: { module: { select: { courseId: true } } } },
      },
    });
    return section?.chapter?.module?.courseId ?? null;
  }

  return null;
}
