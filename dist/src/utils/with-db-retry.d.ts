export type DbRetryMode = 'read' | 'write';
export declare function extractPrismaErrorCode(err: unknown): string | undefined;
export type DbRetryInfo = {
    attempt: number;
    maxAttempts: number;
    err: unknown;
    code?: string;
};
export declare function withDbRetry<T>(fn: () => Promise<T>, options?: {
    retries?: number;
    baseDelayMs?: number;
    mode?: DbRetryMode;
    onRetry?: (info: DbRetryInfo) => void;
    maxWallTimeMs?: number;
}): Promise<T>;
