import { PrismaClient } from '@prisma/client';
export declare const startedKey: (userId: string, courseId: string) => string;
export declare function buildStartedSet(prisma: PrismaClient): Promise<Set<string>>;
