import { CourseDeliveryMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
export declare const IMPORTED_SCORM_TREE_LOCKED_MESSAGE = "Imported SCORM courses have a locked curriculum. Replace the package instead of editing the tree.";
export type ImportedCourseTreeRef = {
    courseId?: string;
    moduleId?: string;
    chapterId?: string;
    sectionId?: string;
};
export declare function assertImportedCourseTreeLocked(prisma: PrismaService, ref: ImportedCourseTreeRef, options?: {
    deliveryMode?: CourseDeliveryMode | null;
}): Promise<void>;
