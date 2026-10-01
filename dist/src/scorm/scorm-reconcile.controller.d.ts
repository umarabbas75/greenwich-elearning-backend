import { EngagementService } from '../engagement/engagement.service';
import { ScormRuntimeService } from './scorm-runtime.service';
import { ScormService } from './scorm.service';
export declare class ScormReconcileController {
    private readonly scorm;
    private readonly runtime;
    private readonly engagement;
    constructor(scorm: ScormService, runtime: ScormRuntimeService, engagement: EngagementService);
    dailyGet(): Promise<{
        message: string;
        statusCode: number;
        data: {
            engagement: import("../engagement/engagement.service").SweepSummary | {
                error: string;
            };
            importJobs: {
                error: string;
            } | {
                processed: number;
                deferred: number;
                results: {
                    id: string;
                    status: string;
                }[];
            };
            reconcile: {
                error: string;
            } | {
                candidates: number;
                updated: number;
                deferred: number;
            };
            pruneSuperseded: {
                error: string;
            } | {
                candidates: number;
                pruned: number;
                deferred: number;
            };
        };
    }>;
    dailyPost(): Promise<{
        message: string;
        statusCode: number;
        data: {
            engagement: import("../engagement/engagement.service").SweepSummary | {
                error: string;
            };
            importJobs: {
                error: string;
            } | {
                processed: number;
                deferred: number;
                results: {
                    id: string;
                    status: string;
                }[];
            };
            reconcile: {
                error: string;
            } | {
                candidates: number;
                updated: number;
                deferred: number;
            };
            pruneSuperseded: {
                error: string;
            } | {
                candidates: number;
                pruned: number;
                deferred: number;
            };
        };
    }>;
    importJobsGet(): Promise<{
        message: string;
        statusCode: number;
        data: {
            processed: number;
            deferred: number;
            results: {
                id: string;
                status: string;
            }[];
        };
    }>;
    importJobsPost(): Promise<{
        message: string;
        statusCode: number;
        data: {
            processed: number;
            deferred: number;
            results: {
                id: string;
                status: string;
            }[];
        };
    }>;
    reconcileGet(): Promise<{
        message: string;
        statusCode: number;
        data: {
            candidates: number;
            updated: number;
            deferred: number;
        };
    }>;
    reconcilePost(): Promise<{
        message: string;
        statusCode: number;
        data: {
            candidates: number;
            updated: number;
            deferred: number;
        };
    }>;
    pruneSupersededGet(): Promise<{
        message: string;
        statusCode: number;
        data: {
            candidates: number;
            pruned: number;
            deferred: number;
        };
    }>;
    pruneSupersededPost(): Promise<{
        message: string;
        statusCode: number;
        data: {
            candidates: number;
            pruned: number;
            deferred: number;
        };
    }>;
    private runImportJobs;
    private runReconcile;
    private runPruneSuperseded;
    private runDaily;
    private runSettled;
}
