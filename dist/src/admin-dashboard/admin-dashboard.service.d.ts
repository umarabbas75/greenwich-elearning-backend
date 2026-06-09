import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ResponseDto } from '../dto';
export declare class AdminDashboardService {
    private readonly prisma;
    private readonly config;
    constructor(prisma: PrismaService, config: ConfigService);
    getOverview(): Promise<ResponseDto>;
    private distinctActiveUsers;
    getLoginsToday(): Promise<ResponseDto>;
    getLoginsTrend(days: number): Promise<ResponseDto>;
    getRecentLogins(params: {
        cursor?: string;
        limit: number;
    }): Promise<ResponseDto>;
    getLoginBreakdown(days: number): Promise<ResponseDto>;
    getActivityFeed(params: {
        days: number;
        cursor?: string;
        limit: number;
        userId?: string;
    }): Promise<ResponseDto>;
    getDailyActiveUsers(days: number): Promise<ResponseDto>;
    getCompletions(params: {
        courseId?: string;
        from?: string;
        to?: string;
        passed?: boolean;
        cursor?: string;
        limit: number;
    }): Promise<ResponseDto>;
    getCompletionsByCourse(): Promise<ResponseDto>;
    getEngagementCohorts(): Promise<ResponseDto>;
    getEngagementSent(params: {
        from?: string;
        to?: string;
        cursor?: string;
        limit: number;
    }): Promise<ResponseDto>;
    getPasswordEvents(params: {
        from?: string;
        to?: string;
        cursor?: string;
        limit: number;
    }): Promise<ResponseDto>;
    getPendingFirstLogin(): Promise<ResponseDto>;
    getRecentAccounts(days: number): Promise<ResponseDto>;
    getTimeLeaderboard(params: {
        courseId?: string;
        limit: number;
    }): Promise<ResponseDto>;
    private activityRollupCte;
    private read;
    private wrap;
    private n;
    private num;
    private tally;
    private parseDevice;
}
