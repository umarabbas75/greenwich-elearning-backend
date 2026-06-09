import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ResponseDto } from '../dto';
import { AdminDashboardService } from './admin-dashboard.service';

/**
 * Admin analytics dashboard. Every route is admin-only via AuthGuard('jwt')
 * (JwtAdminStrategy enforces role === 'admin'). Read-only aggregates + lists
 * over existing data plus the audit logs (email_logs, security_events).
 *
 * Base path: /api/v1/admin/dashboard
 */
@Controller('admin/dashboard')
@UseGuards(AuthGuard('jwt'))
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  // ── Overview ────────────────────────────────────────────────────────────

  /** KPI cards: users, courses, enrollments, logins, active learners, etc. */
  @Get('overview')
  overview(): Promise<ResponseDto> {
    return this.dashboard.getOverview();
  }

  // ── Logins ──────────────────────────────────────────────────────────────

  /** Count + list of today's logins (who logged in today). */
  @Get('logins/today')
  loginsToday(): Promise<ResponseDto> {
    return this.dashboard.getLoginsToday();
  }

  /** Daily login counts over the last N days (default 7) for a trend chart. */
  @Get('logins/trend')
  loginsTrend(@Query('days') days?: string): Promise<ResponseDto> {
    return this.dashboard.getLoginsTrend(this.toInt(days, 7));
  }

  /** Paginated recent logins (user, time, ip, device). */
  @Get('logins')
  logins(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ResponseDto> {
    return this.dashboard.getRecentLogins({
      cursor,
      limit: this.toInt(limit, 30),
    });
  }

  /** Login breakdown by device/browser and by country/IP (last N days). */
  @Get('logins/breakdown')
  loginsBreakdown(@Query('days') days?: string): Promise<ResponseDto> {
    return this.dashboard.getLoginBreakdown(this.toInt(days, 30));
  }

  // ── Activity ────────────────────────────────────────────────────────────

  /** Unified activity feed across all signals (default last 5 days). */
  @Get('activity')
  activity(
    @Query('days') days?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
  ): Promise<ResponseDto> {
    return this.dashboard.getActivityFeed({
      days: this.toInt(days, 5),
      cursor,
      limit: this.toInt(limit, 50),
      userId,
    });
  }

  /** Distinct active users per day over the last N days (DAU trend). */
  @Get('activity/daily-active')
  dailyActive(@Query('days') days?: string): Promise<ResponseDto> {
    return this.dashboard.getDailyActiveUsers(this.toInt(days, 7));
  }

  // ── Completions ───────────────────────────────────────────────────────────

  /** Filterable list of course completions (courseId, date range, passed). */
  @Get('completions')
  completions(
    @Query('courseId') courseId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('passed') passed?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ResponseDto> {
    return this.dashboard.getCompletions({
      courseId,
      from,
      to,
      passed: passed === undefined ? undefined : passed === 'true',
      cursor,
      limit: this.toInt(limit, 30),
    });
  }

  /** Per-course funnel: enrolled → activated → started → completed (+ rate). */
  @Get('completions/by-course')
  completionsByCourse(): Promise<ResponseDto> {
    return this.dashboard.getCompletionsByCourse();
  }

  // ── Engagement ──────────────────────────────────────────────────────────

  /** Live counts of never-started vs stalled cohorts (uses sweep thresholds). */
  @Get('engagement/cohorts')
  engagementCohorts(): Promise<ResponseDto> {
    return this.dashboard.getEngagementCohorts();
  }

  /** Log of which users were sent low-engagement reminders + delivery status. */
  @Get('engagement/sent')
  engagementSent(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ResponseDto> {
    return this.dashboard.getEngagementSent({
      from,
      to,
      cursor,
      limit: this.toInt(limit, 30),
    });
  }

  // ── Security ──────────────────────────────────────────────────────────────

  /** Password change/reset events (who, when, which kind). */
  @Get('security/password-events')
  passwordEvents(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ResponseDto> {
    return this.dashboard.getPasswordEvents({
      from,
      to,
      cursor,
      limit: this.toInt(limit, 30),
    });
  }

  /** Admin-created accounts that have not yet completed first-login change. */
  @Get('security/pending-first-login')
  pendingFirstLogin(): Promise<ResponseDto> {
    return this.dashboard.getPendingFirstLogin();
  }

  /** Recently created accounts (last N days). */
  @Get('security/recent-accounts')
  recentAccounts(@Query('days') days?: string): Promise<ResponseDto> {
    return this.dashboard.getRecentAccounts(this.toInt(days, 7));
  }

  // ── Time-on-platform leaderboards ─────────────────────────────────────────

  /** Top users (and per-course breakdown) by active time spent. */
  @Get('leaderboards/time')
  timeLeaderboard(
    @Query('courseId') courseId?: string,
    @Query('limit') limit?: string,
  ): Promise<ResponseDto> {
    return this.dashboard.getTimeLeaderboard({
      courseId,
      limit: this.toInt(limit, 20),
    });
  }

  /** Clamp + parse an integer query param with a default. */
  private toInt(value: string | undefined, def: number): number {
    const n = value ? parseInt(value, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : def;
  }
}
