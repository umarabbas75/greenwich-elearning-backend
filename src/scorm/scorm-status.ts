export const COMPLETION_RANK: Record<string, number> = {
  unknown: 0,
  incomplete: 1,
  completed: 2,
};

export const SUCCESS_RANK: Record<string, number> = {
  unknown: 0,
  failed: 1,
  passed: 2,
};

export function mapRegistrationCompletion(raw: unknown): string {
  const s = String(raw ?? 'UNKNOWN').toUpperCase();
  if (s === 'COMPLETED') return 'completed';
  if (s === 'INCOMPLETE') return 'incomplete';
  return 'unknown';
}

export function mapRegistrationSuccess(raw: unknown): string {
  const s = String(raw ?? 'UNKNOWN').toUpperCase();
  if (s === 'PASSED') return 'passed';
  if (s === 'FAILED') return 'failed';
  return 'unknown';
}

export function completeOnSatisfied(
  completeOn: string,
  completionStatus: string,
  successStatus: string,
): boolean {
  if (completeOn === 'passed') return successStatus === 'passed';
  return completionStatus === 'completed';
}

export function pickMonotonic(
  stored: string,
  incoming: string,
  ranks: Record<string, number>,
): string {
  const a = ranks[stored] ?? 0;
  const b = ranks[incoming] ?? 0;
  return b > a ? incoming : stored;
}

export type ScormSectionConfig = {
  packageId: string;
  completeOn: 'completed' | 'passed';
  passingScore?: number;
};

export function parseScormSectionConfig(
  config: unknown,
): ScormSectionConfig | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return null;
  }
  const row = config as Record<string, unknown>;
  if (typeof row.packageId !== 'string' || !row.packageId) return null;
  if (row.completeOn !== 'completed' && row.completeOn !== 'passed') {
    return null;
  }
  const parsed: ScormSectionConfig = {
    packageId: row.packageId,
    completeOn: row.completeOn,
  };
  if (typeof row.passingScore === 'number') {
    parsed.passingScore = row.passingScore;
  }
  return parsed;
}

export function isImportJobComplete(status: string): boolean {
  const s = status.toUpperCase();
  return s === 'COMPLETE' || s === 'COMPLETED';
}

export function isImportJobError(status: string): boolean {
  return status.toUpperCase() === 'ERROR';
}

export function isImportJobRunning(status: string): boolean {
  return status.toUpperCase() === 'RUNNING';
}
