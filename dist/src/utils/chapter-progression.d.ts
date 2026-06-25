import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
export declare const DEFAULT_CHAPTER_QUIZ_PASS_PERCENTAGE = 70;
export declare function resolvePassingCriteria(stored?: number | null): number;
export declare function isFreeRoamUser(email: string | null | undefined, config: ConfigService): boolean;
export declare function getCourseIdForChapter(prisma: PrismaService, chapterId: string): Promise<string | null>;
export declare function getOrderedChapterIdsInCourse(prisma: PrismaService, courseId: string): Promise<string[]>;
export declare function getOrderedChapterIdsForUser(prisma: PrismaService, userId: string, courseId: string): Promise<string[]>;
export declare function getPreviousChapterId(prisma: PrismaService, courseId: string, chapterId: string, userId?: string): Promise<string | null>;
export type ChapterQuizGrade = {
    score: number;
    isPassed: boolean;
    passingCriteria: number;
    totalQuestions: number;
    answeredQuestions: number;
};
export declare function gradeChapterQuizFromStoredAnswers(prisma: PrismaService, userId: string, chapterId: string, storedPassingCriteria?: number | null): Promise<ChapterQuizGrade>;
export declare function isChapterComplete(prisma: PrismaService, userId: string, chapterId: string): Promise<boolean>;
export declare function assertChapterAccessible(prisma: PrismaService, config: ConfigService, userId: string, chapterId: string, userEmail?: string | null): Promise<void>;
export declare function enrichQuizProgressReport<T extends {
    passingCriteria?: number;
}>(report: T | null): T | null;
