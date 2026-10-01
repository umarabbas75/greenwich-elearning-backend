export type RiseSuspendProgress = {
    completedIndices: number[];
    cpv: string | null;
};
export declare function parseRiseSuspendData(raw: unknown): RiseSuspendProgress | null;
export type RiseLessonRef = {
    lessonId: string;
    lessonIndex: number;
    lessonTitle: string;
};
export declare function resolveRiseLesson(locationRaw: unknown, lessons: Array<{
    index: number;
    id: string;
    title: string;
}>): RiseLessonRef | null;
