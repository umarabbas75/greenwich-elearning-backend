import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CronSecretGuard } from '../engagement/cron-secret.guard';
import { ScormRuntimeService } from './scorm-runtime.service';
import { ScormService } from './scorm.service';

/**
 * Vercel Cron is GET. POST aliases exist for manual curl. Guarded by
 * CRON_SECRET — same class as engagement, provided in ScormModule rather
 * than importing EngagementModule.
 */
@Controller('internal/cron')
export class ScormReconcileController {
  constructor(
    private readonly scorm: ScormService,
    private readonly runtime: ScormRuntimeService,
  ) {}

  @UseGuards(CronSecretGuard)
  @Get('scorm-import-jobs')
  @HttpCode(200)
  importJobsGet() {
    return this.runImportJobs();
  }

  @UseGuards(CronSecretGuard)
  @Post('scorm-import-jobs')
  @HttpCode(200)
  importJobsPost() {
    return this.runImportJobs();
  }

  @UseGuards(CronSecretGuard)
  @Get('scorm-reconcile')
  @HttpCode(200)
  reconcileGet() {
    return this.runReconcile();
  }

  @UseGuards(CronSecretGuard)
  @Post('scorm-reconcile')
  @HttpCode(200)
  reconcilePost() {
    return this.runReconcile();
  }

  private async runImportJobs() {
    const data = await this.scorm.processImportJobsCron();
    return {
      message: 'SCORM import-job sweep completed',
      statusCode: 200,
      data,
    };
  }

  private async runReconcile() {
    const data = await this.runtime.reconcileCron();
    return {
      message: 'SCORM reconcile sweep completed',
      statusCode: 200,
      data,
    };
  }
}
