import { EngagementService } from './engagement.service';
export declare class EngagementController {
    private readonly engagement;
    constructor(engagement: EngagementService);
    runEngagementRemindersCron(): Promise<{
        message: string;
        statusCode: number;
        data: import("./engagement.service").SweepSummary;
    }>;
    runEngagementRemindersManual(): Promise<{
        message: string;
        statusCode: number;
        data: import("./engagement.service").SweepSummary;
    }>;
    private runSweep;
}
