import {
  PrismaClientInitializationError,
  PrismaClientKnownRequestError,
} from '@prisma/client/runtime/library';

/** Safe to retry: pre-connect, pool checkout, or server not reached — query has not run yet. */
const TRANSIENT_CONNECT = new Set(['P1001', 'P1002', 'P2024']);

/** Additional codes safe to retry for reads only (wake / timeout / dropped conn). */
const TRANSIENT_READ_EXTRA = new Set(['P1008', 'P1017']);

export type DbRetryMode = 'read' | 'write';

export function extractPrismaErrorCode(err: unknown): string | undefined {
  if (err instanceof PrismaClientKnownRequestError) return err.code;
  if (err instanceof PrismaClientInitializationError) return err.errorCode;
  return undefined;
}

function isTransientForMode(err: unknown, mode: DbRetryMode): boolean {
  const code = extractPrismaErrorCode(err);
  if (code) {
    if (TRANSIENT_CONNECT.has(code)) return true;
    if (mode === 'read' && TRANSIENT_READ_EXTRA.has(code)) return true;
    return false;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("Can't reach database server") ||
    msg.includes('Timed out fetching a new connection from the connection pool')
  );
}

export type DbRetryInfo = {
  attempt: number;
  maxAttempts: number;
  err: unknown;
  code?: string;
};

/**
 * Retries on Neon cold-start / pool / transient connection issues.
 * Write mode only retries P1001/P1002/P2024 (and matching init codes); P1017/P1008 stay read-only
 *
 * maxWallTimeMs caps sleeps so a cold DB + retries is less likely to exceed serverless function limits
 * (e.g. Vercel 10s hobby) alongside connect_timeout on the URL.
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  options?: {
    retries?: number;
    baseDelayMs?: number;
    mode?: DbRetryMode;
    onRetry?: (info: DbRetryInfo) => void;
    /** Upper bound for elapsed time including backoff sleeps (default 8s). */
    maxWallTimeMs?: number;
  },
): Promise<T> {
  const retries = options?.retries ?? 2;
  const baseDelayMs = options?.baseDelayMs ?? 800;
  const maxWallTimeMs = options?.maxWallTimeMs ?? 8000;
  const mode = options?.mode ?? 'read';
  const onRetry = options?.onRetry;
  const startedAt = Date.now();
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransientForMode(err, mode) || attempt === retries) {
        throw err;
      }
      const delayMs = baseDelayMs * (attempt + 1);
      if (Date.now() - startedAt + delayMs > maxWallTimeMs) {
        throw err;
      }
      onRetry?.({
        attempt: attempt + 1,
        maxAttempts: retries + 1,
        err,
        code: extractPrismaErrorCode(err),
      });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}
