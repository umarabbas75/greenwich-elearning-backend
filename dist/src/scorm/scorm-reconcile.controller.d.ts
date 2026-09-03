import { ScormRuntimeService } from './scorm-runtime.service';
import { ScormService } from './scorm.service';
export declare class ScormReconcileController {
    private readonly scorm;
    private readonly runtime;
    constructor(scorm: ScormService, runtime: ScormRuntimeService);
    importJobsGet(): Promise<{
        message: string;
        statusCode: number;
        data: {
            processed: number;
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
        };
    }>;
    reconcilePost(): Promise<{
        message: string;
        statusCode: number;
        data: {
            candidates: number;
            updated: number;
        };
    }>;
    pruneSupersededGet(): Promise<{
        message: string;
        statusCode: number;
        data: {
            candidates: number;
            pruned: number;
        };
    }>;
    pruneSupersededPost(): Promise<{
        message: string;
        statusCode: number;
        data: {
            candidates: number;
            pruned: number;
        };
    }>;
    private runImportJobs;
    private runReconcile;
    private runPruneSuperseded;
}
