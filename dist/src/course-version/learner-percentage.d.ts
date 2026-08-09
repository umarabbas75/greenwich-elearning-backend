import { PrismaService } from '../prisma/prisma.service';
export type DenominatorSource = 'manifest' | 'live';
export type LearnerPercentage = {
    percentage: number;
    numerator: number;
    denominator: number;
    denominatorSource: DenominatorSource;
    isCompleted: boolean;
};
export type LearnerCourseKey = {
    userId: string;
    courseId: string;
    enrolledVersionId?: string | null;
};
export declare const percentageKey: (userId: string, courseId: string) => string;
export declare function computeLearnerPercentages(prisma: PrismaService, pairs: LearnerCourseKey[]): Promise<Map<string, LearnerPercentage>>;
export declare function computeLearnerPercentage(prisma: PrismaService, userId: string, courseId: string): Promise<LearnerPercentage>;
