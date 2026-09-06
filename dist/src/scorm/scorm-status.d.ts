export declare const COMPLETION_RANK: Record<string, number>;
export declare const SUCCESS_RANK: Record<string, number>;
export declare function mapRegistrationCompletion(raw: unknown): string;
export declare function mapRegistrationSuccess(raw: unknown): string;
export declare function completeOnSatisfied(completeOn: string, completionStatus: string, successStatus: string): boolean;
export declare function pickMonotonic(stored: string, incoming: string, ranks: Record<string, number>): string;
export type ScormSectionConfig = {
    packageId: string;
    completeOn: 'completed' | 'passed';
    passingScore?: number;
};
export declare function parseScormSectionConfig(config: unknown): ScormSectionConfig | null;
export declare function isImportJobComplete(status: string): boolean;
export declare function isImportJobError(status: string): boolean;
export declare function isImportJobRunning(status: string): boolean;
