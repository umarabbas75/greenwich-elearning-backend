import { ResponseDto } from '../dto';
import { AdminDashboardService } from './admin-dashboard.service';
export declare class AdminDashboardController {
    private readonly dashboard;
    constructor(dashboard: AdminDashboardService);
    overview(): Promise<ResponseDto>;
    loginsToday(): Promise<ResponseDto>;
    loginsTrend(days?: string): Promise<ResponseDto>;
    logins(cursor?: string, limit?: string): Promise<ResponseDto>;
    loginsBreakdown(days?: string): Promise<ResponseDto>;
    activity(days?: string, cursor?: string, limit?: string, userId?: string): Promise<ResponseDto>;
    dailyActive(days?: string): Promise<ResponseDto>;
    forumViews(days?: string, cursor?: string, limit?: string, userId?: string, threadId?: string, scope?: 'list' | 'thread'): Promise<ResponseDto>;
    completions(courseId?: string, from?: string, to?: string, passed?: string, cursor?: string, limit?: string): Promise<ResponseDto>;
    completionsByCourse(): Promise<ResponseDto>;
    engagementCohorts(): Promise<ResponseDto>;
    engagementSent(from?: string, to?: string, cursor?: string, limit?: string): Promise<ResponseDto>;
    passwordEvents(from?: string, to?: string, cursor?: string, limit?: string): Promise<ResponseDto>;
    pendingFirstLogin(): Promise<ResponseDto>;
    recentAccounts(days?: string): Promise<ResponseDto>;
    timeLeaderboard(courseId?: string, limit?: string, days?: string): Promise<ResponseDto>;
    private toInt;
}
