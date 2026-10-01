export type RiseReportingMode = string | null;
export type RiseLesson = {
    index: number;
    id: string;
    title: string;
    type: string;
};
export type RiseProbeResult = {
    title: string | null;
    reporting: RiseReportingMode;
    quizItemCount: number;
    passingScore: number | null;
    lessons: RiseLesson[];
    riseIndexSpaceRisk: string | null;
};
export declare function parseRiseRuntimeData(source: string): RiseProbeResult;
export declare function unwrapRiseRuntimeJson(source: string): unknown;
export declare function unescapeRiseTitle(title: string): string;
