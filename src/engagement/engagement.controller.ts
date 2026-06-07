import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CronSecretGuard } from './cron-secret.guard';
import { EngagementService } from './engagement.service';

/**
 * Internal, machine-to-machine endpoints for the engagement sweep. Triggered by
 * Vercel Cron (see vercel.json), guarded by CRON_SECRET — NOT the user/admin JWT.
 *
 * GET is the primary handler: Vercel Cron invokes paths with an HTTP GET. POST
 * is kept as an alias for manual triggering via curl during testing.
 */
@Controller('internal/cron')
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  @UseGuards(CronSecretGuard)
  @Get('engagement-reminders')
  @HttpCode(200)
  runEngagementRemindersCron() {
    return this.runSweep();
  }

  @UseGuards(CronSecretGuard)
  @Post('engagement-reminders')
  @HttpCode(200)
  runEngagementRemindersManual() {
    return this.runSweep();
  }

  private async runSweep() {
    const summary = await this.engagement.runSweep();
    return {
      message: 'Engagement reminder sweep completed',
      statusCode: 200,
      data: summary,
    };
  }
}
