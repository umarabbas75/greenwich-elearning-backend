import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CronSecretGuard } from '../engagement/cron-secret.guard';
import { EngagementService } from '../engagement/engagement.service';
import { errorMessage } from '../utils/error-message';
import { ScormRuntimeService } from './scorm-runtime.service';
import { ScormService } from './scorm.service';

/**
 * Vercel Cron is GET. POST aliases exist for manual curl. Guarded by
 * CRON_SECRET. Hobby plan allows one daily job — `GET daily` runs every sweep.
 */
@Controller('internal/cron')
export class ScormReconcileController {
  constructor(
    private readonly scorm: ScormService,
    private readonly runtime: ScormRuntimeService,
    private readonly engagement: EngagementService,
  ) {}

  /** Hobby-plan Vercel Cron: one daily GET that runs every sweep. */
  @UseGuards(CronSecretGuard)
  @Get('daily')
  @HttpCode(200)
  dailyGet() {
    return this.runDaily();
  }

  @UseGuards(CronSecretGuard)
  @Post('daily')
  @HttpCode(200)
  dailyPost() {
    return this.runDaily();
  }

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

  @UseGuards(CronSecretGuard)
  @Get('scorm-prune-superseded')
  @HttpCode(200)
  pruneSupersededGet() {
    return this.runPruneSuperseded();
  }

  @UseGuards(CronSecretGuard)
  @Post('scorm-prune-superseded')
  @HttpCode(200)
  pruneSupersededPost() {
    return this.runPruneSuperseded();
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

  private async runPruneSuperseded() {
    const data = await this.runtime.pruneSupersededPackagesCron();
    return {
      message: 'SCORM superseded-package prune completed',
      statusCode: 200,
      data,
    };
  }

  private async runDaily() {
    const data = {
      engagement: await this.runSettled(() => this.engagement.runSweep()),
      importJobs: await this.runSettled(() => this.scorm.processImportJobsCron()),
      reconcile: await this.runSettled(() => this.runtime.reconcileCron()),
      pruneSuperseded: await this.runSettled(() =>
        this.runtime.pruneSupersededPackagesCron(),
      ),
    };
    return {
      message: 'Daily cron sweep completed',
      statusCode: 200,
      data,
    };
  }

  private async runSettled<T>(
    fn: () => Promise<T>,
  ): Promise<T | { error: string }> {
    try {
      return await fn();
    } catch (err) {
      return { error: errorMessage(err) };
    }
  }
}
