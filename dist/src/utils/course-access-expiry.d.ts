export declare const DEFAULT_VALIDITY_DAYS = 365;
export declare function courseAccessExpiresAt(completedAt: Date, validityDaysAtCompletion: number | null | undefined, currentValidityDays: number | null | undefined): Date;
