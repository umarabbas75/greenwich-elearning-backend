export type RiseReportingMode = string | null;
export type RiseProbeResult = {
    title: string | null;
    reporting: RiseReportingMode;
    quizItemCount: number;
    passingScore: number | null;
};
export declare function parseRiseRuntimeData(source: string): RiseProbeResult;
export declare function unwrapRiseRuntimeJson(source: string): unknown;
export declare function unescapeRiseTitle(title: string): string;
