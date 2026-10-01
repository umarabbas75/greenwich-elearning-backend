export type ExtractedRuntime = {
    runtime: Record<string, unknown> | null;
    attempts: number | null;
    suspended: boolean | null;
    completionAmount: number | null;
};
export declare function extractRuntime(payload: unknown): ExtractedRuntime | null;
