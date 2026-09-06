import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
export declare function assertEnrollmentUsable(prisma: PrismaService, userId: string, courseId: string, userRole: Role): Promise<{
    id: string;
    userId: string;
    courseId: string;
    isActive: boolean;
}>;
