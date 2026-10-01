import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CronSecretGuard } from '../engagement/cron-secret.guard';
import { EngagementService } from '../engagement/engagement.service';
import { errorMessage } from '../utils/error-message';
import { ScormRuntimeService } from './scorm-runtime.service';
import { ScormService } from './scorm.service';

/**
 * No SCORM sweep starts a new item after this much of the daily invocation.
 * Shared, not per-sweep: each sweep's own budget counted from its own start,
 * so three in a row could add up past Vercel's 60s. 40s rather than ~50 makes
 * a kill unlikely, NOT impossible: an import item started just before it can
 * take its Cloud budgets (≈ 10+10+25s) plus the 20s tree tx plus the publish,
 * well past 60s. That is survivable by design, not by this number: a kill
 * inside the tree tx or the publish tx rolls it back (the row stays
 * PROCESSING and the next poll/cron redoes the item), and a kill between the
 * two leaves "has section, still PROCESSING", which the next poll finishes by
 * publishing only. A per-item "enough time left" gate would need ≥65s and so
 * defer every import — not worth it.
 */
const DAILY_SCORM_DEADLINE_MS = 40_000;

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
    // Measured from invocation start, before engagement runs.
    const deadline = Date.now() + DAILY_SCORM_DEADLINE_MS;
    // Engagement first, as before. It takes no deadline, and a kill midway is
    // unrecoverable: notification rows are inserted before their emails go
    // out, so dedupe never re-sends them. Every SCORM sweep, by contrast, is
    // resumable — it stops starting items at the shared deadline and reports
    // the rest as `deferred` for the next run (and pull-on-read covers learners
    // in between). So a slow engagement sweep costs SCORM a day, not data.
    const engagement = await this.runSettled(() => this.engagement.runSweep());
    const importJobs = await this.runSettled(() =>
      this.scorm.processImportJobsCron(deadline),
    );
    const reconcile = await this.runSettled(() =>
      this.runtime.reconcileCron(deadline),
    );
    const pruneSuperseded = await this.runSettled(() =>
      this.runtime.pruneSupersededPackagesCron(deadline),
    );
    const data = { engagement, importJobs, reconcile, pruneSuperseded };
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
