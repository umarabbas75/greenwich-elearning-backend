import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseDeliveryMode,
  Prisma,
  ScormPackage,
  ScormPackageStatus,
  SectionType,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { CourseVersionService } from '../course-version/course-version.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  SCORM_EMBEDDED_LAUNCH_SETTINGS,
  ScormCloudClient,
  ScormCloudHttpError,
  ScormCloudTimeoutError,
} from '../scorm-cloud/scorm-cloud.client';
import { errorMessage } from '../utils/error-message';
import {
  parseRiseRuntimeData,
  RiseLesson,
  RiseProbeResult,
  unescapeRiseTitle,
} from '../utils/rise-probe';
import { scormGateCandidateSectionsWhere } from '../utils/scorm-publish-gate';
import { CreateScormPackageDto } from './dto';
import {
  isImportJobComplete,
  isImportJobError,
  isImportJobRunning,
} from './scorm-status';

/**
 * Advisory-lock keys for tree writes: hashtextextended(<id>, <seed>), taken
 * with pg_try_advisory_xact_lock. Exported because
 * scripts/backfill-scorm-lessons.ts rewrites the same tree and must contend
 * on the same keys — a copied literal would drift silently.
 *
 *   TREE_LOCK_SEED        keyed on packageId — one complete-import per package
 *   COURSE_TREE_LOCK_SEED keyed on courseId  — one tree writer per course. The
 *     package lock alone cannot stop a NEW package's replace (a different id)
 *     from archiving the chapter while the backfill is filling it.
 *   IMPORT_START_LOCK_SEED keyed on courseId — one startPackageImport's
 *     in-flight check + create per course. Its own seed, not
 *     COURSE_TREE_LOCK_SEED: sharing that key would 409 a start (or bounce a
 *     poll's tree write) whenever the other happened to be running. Try-lock
 *     only, so nothing ever waits on it and it cannot join a deadlock.
 */
export const TREE_LOCK_SEED = 1;
export const COURSE_TREE_LOCK_SEED = 2;
export const IMPORT_START_LOCK_SEED = 3;
const IMPORT_CRON_BATCH = 8;
/**
 * Cap on a PROCESSING package's life, measured from createdAt (no schema
 * column needed). Every Cloud step leaves the row PROCESSING on a timeout so
 * slow is not mistaken for broken — but uncapped, a Cloud that keeps timing out
 * holds it there forever: the in-flight guard refuses a re-import and the
 * cron's oldest-first batch fills with such rows. Past this, the next poll
 * (cron sweep, or the poll a re-import attempt makes first) whose Cloud read
 * does not say COMPLETE marks it FAILED. A COMPLETE job is not capped here
 * (see STALE_PROCESSING_HARD_MS for the cap that covers it). A day spans at least one
 * daily cron plus any admin polling.
 */
const STALE_PROCESSING_MS = 24 * 60 * 60 * 1000;
/**
 * Hard cap on ANY PROCESSING row, from createdAt, whatever its Cloud job says
 * and whether or not its tree is built. The 24h cap above exempts a COMPLETE
 * job (its later steps — launch config, asset probe — leave it PROCESSING on a
 * timeout) and a built tree (only the publish is left, and a non-Conflict
 * publish failure leaves it PROCESSING); either can then repeat forever,
 * and the in-flight guard refuses every re-import with no admin way out.
 * Past this, the row is FAILED without asking Cloud. Safe even for a row
 * with a built tree: buildOrReplaceTree archives every live SCORM section of
 * the course (not just the predecessor's) and findScormTreeAnchor reuses the
 * chapter of any live SCORM section, so the next import replaces whatever
 * this one left live. Three days spans several daily crons plus admin polls.
 */
const STALE_PROCESSING_HARD_MS = 72 * 60 * 60 * 1000;
/**
 * Same, for a row that never got a cloudImportJobId. startPackageImport writes
 * the job id in the same ≤60s invocation that created the row, so after this
 * the invocation is long dead (killed between the two writes) and the id will
 * never arrive — no reason to make the admin wait a day.
 */
const STALE_UNSTARTED_MS = 10 * 60 * 1000;
/**
 * Budget for the Cloud delete after a timed-out import start: it runs in what
 * is left of the 60s invocation after the upload's own (35s) budget.
 */
const CLEANUP_DELETE_TIMEOUT_MS = 5_000;
/**
 * A tree lock is held by another writer. Internal: completeImportIfReady
 * turns it into an ordinary PROCESSING poll response, never an HTTP error —
 * a 409 would tell a poller to stop, and the package would then sit
 * PROCESSING (blocking re-import) until the daily cron.
 */
class TreeLockBusyError extends Error {}
/**
 * The package left PROCESSING (failIfStale, a Cloud failure) before the tree
 * write landed. Thrown to roll the tree back; never turned into a FAILED write
 * of its own — whoever moved the row already set its status and reason.
 */
class PackageNotProcessingError extends Error {}

const PLACEHOLDER_IMAGE =
  'https://res.cloudinary.com/demo/image/upload/sample.jpg';

@Injectable()
export class ScormService {
  private readonly logger = new Logger(ScormService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloud: ScormCloudClient,
    private readonly courseVersionService: CourseVersionService,
  ) {}

  async createPackage(adminId: string, body: CreateScormPackageDto) {
    const contentUrl = body.contentUrl.trim();
    if (!contentUrl.startsWith('https://')) {
      throw new BadRequestException(
        'contentUrl must be a durable public HTTPS URL (the zip never enters this API)',
      );
    }

    return this.startPackageImport(adminId, body, async (scormCloudCourseId) =>
      this.cloud.createFetchAndImportCourseJob({
        courseId: scormCloudCourseId,
        url: contentUrl,
      }),
    );
  }

  /** Import via SCORM Cloud multipart upload (packages too large for Cloudinary, etc.). */
  async createPackageFromUpload(
    adminId: string,
    file: Buffer,
    body: Omit<CreateScormPackageDto, 'contentUrl'> & { filename?: string },
  ) {
    if (!file.length) {
      throw new BadRequestException('SCORM zip file is empty');
    }
    const filename = body.filename?.trim() || 'package.zip';
    return this.startPackageImport(adminId, body, async (scormCloudCourseId) =>
      this.cloud.createUploadAndImportCourseJob({
        courseId: scormCloudCourseId,
        file,
        filename,
      }),
    );
  }

  private async startPackageImport(
    adminId: string,
    body: Omit<CreateScormPackageDto, 'contentUrl'>,
    startCloudJob: (scormCloudCourseId: string) => Promise<string>,
  ) {
    // Tracked so a failed hand-off to Cloud can undo a course this call
    // created. An import onto an EXISTING course must never delete it.
    const createdCourseHere = !body.courseId;
    const course = body.courseId
      ? await this.prepareExistingCourse(body.courseId)
      : await this.createImportedCourse(body as CreateScormPackageDto);

    const scormCloudCourseId = randomUUID();
    const title = (body.title?.trim() || course.title).trim();

    await this.pollStaleInFlightImport(course.id, adminId);

    // In-flight check + create under a per-course lock: two concurrent starts
    // could otherwise both see no PROCESSING row and, with different version
    // numbers, both create one. Try-lock — a start that loses answers 409
    // rather than queueing a second import behind the first.
    let pkg: ScormPackage;
    try {
      pkg = await this.prisma.$transaction(
        async (tx) => {
          const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>(
            Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${course.id}, ${IMPORT_START_LOCK_SEED})) AS locked`,
          );
          if (!locked) {
            throw new ConflictException(
              'An import is starting for this course. Wait a moment and retry.',
            );
          }

          const inFlight = await tx.scormPackage.findFirst({
            where: {
              courseId: course.id,
              status: ScormPackageStatus.PROCESSING,
            },
          });
          // A stale job-less row is not in flight — it can never finish — so
          // fail it here rather than make the admin wait for a poll or the
          // cron. A row WITH a job id is never failed here without asking
          // Cloud: pollStaleInFlightImport above already polled a day-old one
          // (failing it only if Cloud still had it running), so one still
          // PROCESSING now is genuinely in flight — unless it is past the
          // hard cap (STALE_PROCESSING_HARD_MS), which never asks Cloud.
          if (
            inFlight &&
            !(await this.failIfPastHardCap(inFlight, tx)) &&
            (inFlight.cloudImportJobId ||
              !(await this.failIfStale(inFlight, tx)))
          ) {
            throw new ConflictException(
              'An import is already in progress for this course. Wait for it to finish (or fail) before starting another.',
            );
          }

          // Only now that this start is not refused: a 409 above must leave
          // a live course as it was. See prepareExistingCourse for why.
          if (!createdCourseHere) {
            await tx.course.update({
              where: { id: course.id },
              data: {
                deliveryMode: CourseDeliveryMode.IMPORTED_SCORM,
                isActive: false,
              },
            });
          }

          const latest = await tx.scormPackage.findFirst({
            where: { courseId: course.id },
            orderBy: { versionNumber: 'desc' },
            select: { versionNumber: true },
          });
          return tx.scormPackage.create({
            data: {
              courseId: course.id,
              versionNumber: (latest?.versionNumber ?? 0) + 1,
              title,
              scormCloudCourseId,
              zipSha256: body.zipSha256 ?? null,
              completeOn: body.completeOn,
              passingScore: body.passingScore ?? null,
              status: ScormPackageStatus.PROCESSING,
            },
          });
        },
        // A timeout here is contention like the try-lock — answered the same
        // way below.
        { timeout: 10_000 },
      );
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'A concurrent package import created the same version number. Retry shortly.',
        );
      }
      if (isTransactionTimeout(err)) {
        throw new ConflictException(
          'An import is starting for this course. Wait a moment and retry.',
        );
      }
      throw err;
    }

    let jobId: string;
    try {
      jobId = await startCloudJob(scormCloudCourseId);
    } catch (err) {
      const reason = cloudErrorMessage(err);
      // A timeout is not a rejection: the POST may have reached Cloud, which
      // can go on creating the course after we stop waiting — so not even a
      // 404 from the delete below proves it is gone. Never roll back on one:
      // the FAILED row's scormCloudCourseId is the only pointer a later course
      // delete has to a Cloud course that counts against the account limit.
      const timedOut = err instanceof ScormCloudTimeoutError;
      await this.prisma.scormPackage.update({
        where: { id: pkg.id },
        data: {
          status: ScormPackageStatus.FAILED,
          failureReason: timedOut
            ? `${reason} — SCORM Cloud may still create course ${scormCloudCourseId}; delete this course to clean it up`
            : reason,
        },
      });
      if (timedOut) {
        await this.deleteCloudCourseAfterTimeout(scormCloudCourseId);
        throw err;
      }

      // Cloud never accepted the job, so nothing was created on their side and
      // the admin is about to see an error. If this call also created the
      // catalogue course, leaving it behind puts a permanently broken row in
      // the admin list — no tree, no version, "0 units", and setCourseActive
      // refuses it forever — with nothing on screen saying why. Undo it. An
      // import onto an existing course keeps the FAILED package as history.
      if (createdCourseHere) {
        try {
          await this.prisma.scormPackage.delete({ where: { id: pkg.id } });
          await this.prisma.course.delete({ where: { id: course.id } });
        } catch (cleanupErr) {
          this.logger.warn(
            `Failed to roll back course ${course.id} after a rejected SCORM ` +
              `import: ${errorMessage(cleanupErr)}`,
          );
        }
      }

      throw err instanceof HttpException
        ? err
        : new HttpException(reason, HttpStatus.BAD_GATEWAY);
    }

    // Outside the Cloud try on purpose: from here Cloud HAS a course and a
    // job, so a DB failure must never take the rejected-start rollback above
    // — that would delete the only row pointing at the Cloud course.
    try {
      const updated = await this.prisma.scormPackage.update({
        where: { id: pkg.id },
        data: { cloudImportJobId: jobId },
      });
      return {
        message: 'SCORM import job started',
        statusCode: 200,
        data: updated,
      };
    } catch (err) {
      this.logger.error(
        `Package ${pkg.id}: Cloud import job ${jobId} started but recording it ` +
          `failed: ${errorMessage(err)}`,
      );
      // Best effort. If this write fails too the row stays PROCESSING with no
      // job id and the stale-unstarted sweep FAILs it; either way it keeps
      // scormCloudCourseId for a course delete to clean up.
      try {
        await this.prisma.scormPackage.updateMany({
          where: { id: pkg.id, status: ScormPackageStatus.PROCESSING },
          data: {
            status: ScormPackageStatus.FAILED,
            failureReason: `SCORM Cloud import job ${jobId} started but could not be recorded — SCORM Cloud course ${scormCloudCourseId} exists; delete this course to clean it up`,
          },
        });
      } catch (markErr) {
        this.logger.warn(
          `Could not mark package ${pkg.id} FAILED: ${errorMessage(markErr)}`,
        );
      }
      throw err;
    }
  }

  /**
   * A PROCESSING row with a job id past the 24h cap may still be one whose
   * Cloud job finished with nobody polling — failing it unasked would throw
   * away a good import. So a re-import polls it first, outside (and before)
   * the start tx: Cloud network calls and the tree tx do not belong under the
   * start lock. The poll completes it, fails it (Cloud still running / timed
   * out past the cap), or leaves it PROCESSING — and then the start tx's
   * in-flight guard answers 409. Best effort: a poll error just leaves the
   * guard to refuse.
   */
  private async pollStaleInFlightImport(
    courseId: string,
    adminId: string | null,
  ): Promise<void> {
    const inFlight = await this.prisma.scormPackage.findFirst({
      where: {
        courseId,
        status: ScormPackageStatus.PROCESSING,
        cloudImportJobId: { not: null },
        sectionId: null,
        createdAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) },
      },
    });
    if (!inFlight) return;
    try {
      await this.completeImportIfReady(inFlight.id, adminId);
    } catch (err) {
      this.logger.warn(
        `Could not poll stale in-flight package ${inFlight.id} before a ` +
          `re-import: ${errorMessage(err)}`,
      );
    }
  }

  /** Best effort; the FAILED row stays either way (see startPackageImport). */
  private async deleteCloudCourseAfterTimeout(
    scormCloudCourseId: string,
  ): Promise<void> {
    try {
      await this.cloud.deleteCourse(scormCloudCourseId, {
        timeoutMs: CLEANUP_DELETE_TIMEOUT_MS,
      });
    } catch (err) {
      if (err instanceof ScormCloudHttpError && err.cloudStatus === 404) {
        return;
      }
      this.logger.warn(
        `Could not delete SCORM Cloud course ${scormCloudCourseId} after a ` +
          `timed-out import start: ${errorMessage(err)}`,
      );
    }
  }

  /**
   * FAILs a PROCESSING row past its stale cap (see STALE_PROCESSING_MS).
   * True when this call failed it. For a row with a job id, call only AFTER
   * asking Cloud (failIfStaleAfterPoll) — never before. Conditional on
   * sectionId null: a row whose tree is built has only DB work left, and
   * failing it would strand live
   * sections; and a poll that built the tree a moment ago must win. A tree tx
   * in progress holds this row FOR UPDATE, so the write waits for it and then
   * sees sectionId set (no-op), or sees it rolled back (fails it). `db`: the
   * caller's tx when called inside one — the pool may have one connection.
   */
  private async failIfStale(
    pkg: ScormPackage,
    db: Pick<Prisma.TransactionClient, 'scormPackage'> = this.prisma,
  ): Promise<boolean> {
    const reason = staleProcessingReason(pkg, Date.now());
    if (!reason) return false;
    const { count } = await db.scormPackage.updateMany({
      where: {
        id: pkg.id,
        status: ScormPackageStatus.PROCESSING,
        sectionId: null,
      },
      data: { status: ScormPackageStatus.FAILED, failureReason: reason },
    });
    if (count > 0) {
      this.logger.warn(`Package ${pkg.id} marked FAILED: ${reason}`);
    }
    return count > 0;
  }

  /**
   * FAILs a PROCESSING row past STALE_PROCESSING_HARD_MS. Unlike failIfStale
   * this ignores job status and sectionId (see the constant for why a built
   * tree is safe to fail). True when this call failed it. `db`: as failIfStale.
   */
  private async failIfPastHardCap(
    pkg: ScormPackage,
    db: Pick<Prisma.TransactionClient, 'scormPackage'> = this.prisma,
  ): Promise<boolean> {
    if (
      pkg.status !== ScormPackageStatus.PROCESSING ||
      Date.now() - pkg.createdAt.getTime() < STALE_PROCESSING_HARD_MS
    ) {
      return false;
    }
    const reason = 'SCORM import did not finish within 72h — re-import';
    const { count } = await db.scormPackage.updateMany({
      where: { id: pkg.id, status: ScormPackageStatus.PROCESSING },
      data: { status: ScormPackageStatus.FAILED, failureReason: reason },
    });
    if (count > 0) {
      this.logger.warn(`Package ${pkg.id} marked FAILED: ${reason}`);
    }
    return count > 0;
  }

  /**
   * The post-poll half of the stale cap: Cloud was asked and did not say
   * COMPLETE (still running, unrecognised, or the read timed out). A job id
   * row is never failed BEFORE asking — its job may have finished hours ago
   * with nobody polling (closed tab, daily cron).
   */
  private async failIfStaleAfterPoll(pkg: ScormPackage) {
    return (await this.failIfStale(pkg)) ? this.reread(pkg) : pkg;
  }

  /**
   * FAILED write for a step of this poll. Conditional like failIfStale: a
   * concurrent poll may have built the tree (or moved the row) meanwhile, and
   * an unconditional write would strand its live sections under a FAILED row.
   */
  private async failIfUnbuilt(
    pkg: ScormPackage,
    data: Prisma.ScormPackageUpdateManyMutationInput,
  ) {
    await this.prisma.scormPackage.updateMany({
      where: {
        id: pkg.id,
        status: ScormPackageStatus.PROCESSING,
        sectionId: null,
      },
      data,
    });
    return this.reread(pkg);
  }

  private async reread(pkg: ScormPackage): Promise<ScormPackage> {
    return (
      (await this.prisma.scormPackage.findUnique({ where: { id: pkg.id } })) ??
      pkg
    );
  }

  async getPackage(id: string) {
    const pkg = await this.prisma.scormPackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('SCORM package not found');
    return { message: 'ok', statusCode: 200, data: pkg };
  }

  async listPackages(courseId: string) {
    const packages = await this.prisma.scormPackage.findMany({
      where: { courseId },
      orderBy: { versionNumber: 'desc' },
    });
    return { message: 'ok', statusCode: 200, data: packages };
  }

  async getImportStatus(id: string, adminId?: string | null) {
    const result = await this.completeImportIfReady(id, adminId ?? null);
    return { message: 'ok', statusCode: 200, data: result };
  }

  /**
   * `deadline` (epoch ms): no package STARTS after it; the rest are reported
   * as deferred for the next run. Set by the daily cron, which shares one
   * 60s invocation across several sweeps.
   */
  async processImportJobsCron(deadline?: number) {
    const pending = await this.prisma.scormPackage.findMany({
      where: {
        status: ScormPackageStatus.PROCESSING,
        // Job-less rows only once stale, so this sweep is what fails them;
        // a younger one may be a start still in progress.
        OR: [
          { cloudImportJobId: { not: null } },
          { createdAt: { lt: new Date(Date.now() - STALE_UNSTARTED_MS) } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: IMPORT_CRON_BATCH,
    });
    // Sequential, not Promise.all: with connection_limit=1 (Neon/Vercel) a
    // second concurrent tree $transaction waits on the pool, and once it
    // waits past maxWait the import fails over nothing but contention.
    const results: Array<{ id: string; status: string }> = [];
    let deferred = 0;
    for (const pkg of pending) {
      if (deadline !== undefined && Date.now() >= deadline) {
        deferred += 1;
        continue;
      }
      try {
        const data = await this.completeImportIfReady(pkg.id, null);
        results.push({ id: pkg.id, status: String(data.status) });
      } catch (err) {
        this.logger.warn(
          `Import-job cron failed for package ${pkg.id}: ${errorMessage(err)}`,
        );
        results.push({ id: pkg.id, status: 'error' });
      }
    }
    return { processed: results.length, deferred, results };
  }

  async replacePreview(courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, deliveryMode: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.deliveryMode !== CourseDeliveryMode.IMPORTED_SCORM) {
      throw new BadRequestException('Course is not an imported SCORM course');
    }

    const current = await this.prisma.scormPackage.findFirst({
      where: { courseId, status: ScormPackageStatus.READY },
      orderBy: { versionNumber: 'desc' },
    });
    if (!current) {
      return {
        message: 'ok',
        statusCode: 200,
        data: {
          completedOnOldPackage: 0,
          pinnedEnrollments: 0,
          floatingEnrollments: 0,
          packageId: null,
        },
      };
    }

    const registrations = await this.prisma.scormRegistration.findMany({
      where: { packageId: current.id },
      select: {
        completeOn: true,
        completionStatus: true,
        successStatus: true,
      },
    });
    const completedOnOldPackage = registrations.filter((row) =>
      row.completeOn === 'passed'
        ? row.successStatus === 'passed'
        : row.completionStatus === 'completed',
    ).length;

    const latest =
      await this.courseVersionService.getLatestPublishedVersion(courseId);
    const [pinnedEnrollments, floatingEnrollments] = await Promise.all([
      latest
        ? this.prisma.userCourse.count({
            where: { courseId, enrolledVersionId: latest.id },
          })
        : Promise.resolve(0),
      this.prisma.userCourse.count({
        where: { courseId, enrolledVersionId: null },
      }),
    ]);

    return {
      message: 'ok',
      statusCode: 200,
      data: {
        packageId: current.id,
        versionNumber: current.versionNumber,
        completedOnOldPackage,
        pinnedEnrollments,
        floatingEnrollments,
      },
    };
  }

  /**
   * Poll Cloud, then (once) build the synthetic tree in its own locked
   * transaction, commit, then publishNewVersion in its own tx.
   */
  async completeImportIfReady(packageId: string, adminId: string | null) {
    const pkg = await this.prisma.scormPackage.findUnique({
      where: { id: packageId },
    });
    if (!pkg) throw new NotFoundException('SCORM package not found');
    if (pkg.status === ScormPackageStatus.READY && !pkg.sectionId) {
      this.logger.error(
        `Package ${pkg.id} is READY but sectionId is null — data invariant violated`,
      );
      throw new InternalServerErrorException(
        'SCORM package is READY but has no linked section',
      );
    }
    // READY, FAILED, SUPERSEDED, PRUNED: nothing left to do. PRUNED especially
    // must not reach Cloud — its Cloud course is deleted, so the steps below
    // would rewrite it FAILED with a misleading reason.
    if (pkg.status !== ScormPackageStatus.PROCESSING) return pkg;

    // Before any Cloud call or publish retry: past the hard cap nothing is
    // retried (see STALE_PROCESSING_HARD_MS).
    if (await this.failIfPastHardCap(pkg)) return this.reread(pkg);

    if (pkg.sectionId && pkg.status === ScormPackageStatus.PROCESSING) {
      // The warning is written only with READY, so a publish that failed after
      // the tree committed lost it; recompute it from the probe the tree tx
      // stored rather than let this write importWarning: null over it.
      const storedProbe =
        pkg.riseProbeJson as unknown as RiseProbeResult | null;
      return this.finishPublishAndReady(
        pkg.id,
        pkg.courseId,
        adminId,
        this.importWarningFor(pkg.completeOn, storedProbe),
      );
    }

    if (!pkg.cloudImportJobId) {
      // No job to ask about, so the (10-min) stale cap is the only answer.
      if (await this.failIfStale(pkg)) return this.reread(pkg);
      this.logger.warn(
        `Package ${pkg.id} is PROCESSING without cloudImportJobId — cannot complete import`,
      );
      return pkg;
    }

    let job;
    try {
      job = await this.cloud.getImportJobStatus(pkg.cloudImportJobId);
    } catch (err) {
      // A slow status read is not an answer: a 504 would tell the poller to
      // stop. Answer PROCESSING so it keeps polling (the stale cap bounds it).
      if (err instanceof ScormCloudTimeoutError) {
        this.logger.warn(
          `Import job status timed out for package ${pkg.id} — leaving PROCESSING`,
        );
        return this.failIfStaleAfterPoll(pkg);
      }
      throw err;
    }
    if (isImportJobRunning(job.status) || !job.status) {
      return this.failIfStaleAfterPoll(pkg);
    }
    if (isImportJobError(job.status)) {
      // Conditional, like failIfStale: a concurrent poll may already have
      // moved the row on, and this must not overwrite that.
      await this.prisma.scormPackage.updateMany({
        where: { id: pkg.id, status: ScormPackageStatus.PROCESSING },
        data: {
          status: ScormPackageStatus.FAILED,
          failureReason: job.message || 'SCORM Cloud import job failed',
        },
      });
      return this.reread(pkg);
    }
    if (!isImportJobComplete(job.status)) {
      this.logger.warn(
        `Import job ${pkg.cloudImportJobId} has unrecognised status "${job.status}" — leaving PROCESSING`,
      );
      return this.failIfStaleAfterPoll(pkg);
    }
    // COMPLETE: never 24h-capped from here on. The import itself finished,
    // so failing it would throw away a good package; the steps below leave it
    // PROCESSING on a timeout and the next poll retries them (bounded only by
    // STALE_PROCESSING_HARD_MS, checked above).

    try {
      await this.cloud.setCourseConfiguration(
        pkg.scormCloudCourseId,
        SCORM_EMBEDDED_LAUNCH_SETTINGS,
      );
    } catch (err) {
      const message = errorMessage(err);
      // Slow is not broken: the import itself finished, so FAILED here would
      // throw away a good package over one hung request. The next poll
      // retries the whole step.
      if (err instanceof ScormCloudTimeoutError) {
        this.logger.warn(
          `FRAMESET launch configuration timed out for package ${pkg.id} — leaving PROCESSING`,
        );
        return pkg;
      }
      this.logger.error(
        `FRAMESET launch configuration failed for package ${pkg.id}: ${message}`,
      );
      return this.failIfUnbuilt(pkg, {
        status: ScormPackageStatus.FAILED,
        failureReason: `SCORM Cloud launch configuration failed: ${message}`,
      });
    }

    let probe: RiseProbeResult | null = null;
    try {
      const asset = await this.cloud.getCourseAsset(
        pkg.scormCloudCourseId,
        'scormcontent/runtime-data.js',
      );
      probe = parseRiseRuntimeData(asset);
    } catch (err) {
      const message = errorMessage(err);
      // A timeout says nothing about the package, but probe=null would build
      // a binary single section (or refuse completeOn 'passed') for good.
      // Leave it PROCESSING; the next poll re-probes.
      if (err instanceof ScormCloudTimeoutError) {
        this.logger.warn(
          `Rise probe timed out for package ${pkg.id} — leaving PROCESSING`,
        );
        return pkg;
      }
      this.logger.warn(`Rise probe failed for package ${pkg.id}: ${message}`);
    }

    if (probe?.riseIndexSpaceRisk) {
      // See extractRiseLessons: decoded suspendData indices are assumed to key
      // the filtered+sorted lesson list. Every package so far makes the two
      // readings identical; this one does not, so its first learner's decode is
      // worth checking by hand before the numbers are trusted.
      this.logger.warn(
        `Package ${pkg.id} has a lesson manifest where the suspendData index space is unverified ` +
          `(${probe.riseIndexSpaceRisk}) — confirm a learner's decoded lessons map to the right sections`,
      );
    }

    const gate = this.policyGate(pkg.completeOn, probe);
    if (gate.refuse) {
      return this.failIfUnbuilt(pkg, {
        status: ScormPackageStatus.FAILED,
        failureReason: gate.reason,
        riseProbeJson: probe
          ? (probe as unknown as Prisma.InputJsonValue)
          : undefined,
      });
    }
    if (gate.warn) {
      this.logger.warn(`Package ${pkg.id}: ${gate.warn}`);
    }

    const chapterTitle = unescapeRiseTitle(probe?.title || pkg.title);

    let treeBuilt = false;
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>(
            Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${pkg.id}, ${TREE_LOCK_SEED})) AS locked`,
          );
          if (!locked) {
            throw new TreeLockBusyError(
              `Another complete-import is already in progress for package ${pkg.id}`,
            );
          }

          // Lock the row, not just read it: failIfStale (cron, re-import) can
          // FAIL it while this poll was out at Cloud. Building a tree for a
          // FAILED row archives the live chapter for a package nothing will
          // ever retry. Held to commit, so a failIfStale arriving now waits
          // and then sees sectionId set.
          const [fresh] = await tx.$queryRaw<
            Array<{ status: ScormPackageStatus; sectionId: string | null }>
          >(
            Prisma.sql`SELECT status, "sectionId" FROM "scorm_packages" WHERE id = ${pkg.id} FOR UPDATE`,
          );
          if (!fresh) return;
          if (fresh.status !== ScormPackageStatus.PROCESSING) return;
          if (fresh.sectionId) return;

          await this.buildOrReplaceTree(tx, {
            courseId: pkg.courseId,
            packageId: pkg.id,
            versionNumber: pkg.versionNumber,
            chapterTitle,
            completeOn: pkg.completeOn,
            passingScore: pkg.passingScore ?? probe?.passingScore ?? null,
            riseProbeJson: probe,
          });
          treeBuilt = true;
        },
        { timeout: 20000 },
      );
    } catch (err) {
      if (err instanceof PackageNotProcessingError) {
        this.logger.warn(
          `Package ${pkg.id}: ${err.message} — tree rolled back`,
        );
        return this.reread(pkg);
      }
      // P2028: the transaction could not start within maxWait (the one pooled
      // connection is busy — another poll, the cron) or outlived its timeout.
      // Contention, like a held lock, not a broken package: retry next poll.
      if (err instanceof TreeLockBusyError || isTransactionTimeout(err)) {
        // Same shape as any other still-PROCESSING poll, so pollers keep
        // polling rather than stopping on an error.
        this.logger.log(
          `Package ${pkg.id}: ${err.message} — leaving PROCESSING`,
        );
        return pkg;
      }
      this.logger.error(
        `Synthetic tree failed for package ${pkg.id}: ${errorMessage(err)}`,
      );
      return this.failIfUnbuilt(pkg, {
        status: ScormPackageStatus.FAILED,
        failureReason: errorMessage(err),
        riseProbeJson: probe
          ? (probe as unknown as Prisma.InputJsonValue)
          : undefined,
      });
    }

    const after = await this.prisma.scormPackage.findUnique({
      where: { id: pkg.id },
    });
    if (!after) throw new NotFoundException('SCORM package not found');
    if (after.status === ScormPackageStatus.READY) return after;
    if (!after.sectionId) return after;
    if (!treeBuilt) {
      return after;
    }

    return this.finishPublishAndReady(
      pkg.id,
      pkg.courseId,
      adminId,
      this.importWarningFor(pkg.completeOn, probe),
    );
  }

  /**
   * Admin-visible, not just logged: for the index-space case a learner's
   * decoded lessons may map to the wrong sections, and nobody reads server
   * logs looking for that. Pure of the probe, so a publish retry recomputes
   * exactly what the first pass would have written.
   */
  private importWarningFor(
    completeOn: string,
    probe: RiseProbeResult | null,
  ): string | null {
    return (
      [
        this.policyGate(completeOn, probe).warn,
        riseIndexSpaceWarning(probe?.riseIndexSpaceRisk ?? null),
      ]
        .filter(Boolean)
        .join(' | ') || null
    );
  }

  private async finishPublishAndReady(
    packageId: string,
    courseId: string,
    adminId: string | null,
    importWarning: string | null,
  ) {
    const current = await this.prisma.scormPackage.findUnique({
      where: { id: packageId },
    });
    if (!current) throw new NotFoundException('SCORM package not found');
    // READY: done already. FAILED/SUPERSEDED: never publish for, or
    // resurrect, a row someone else moved on.
    if (current.status !== ScormPackageStatus.PROCESSING) {
      return current;
    }

    let published: Awaited<
      ReturnType<CourseVersionService['publishNewVersion']>
    >;
    try {
      published = await this.courseVersionService.publishNewVersion(
        adminId,
        courseId,
        'Imported SCORM package',
      );
    } catch (err) {
      // Another publish holds the course's publish lock. Contention, not an
      // answer: a 409 would tell the poller to stop. The row stays PROCESSING
      // with its tree, and the next poll retries just the publish.
      if (err instanceof ConflictException) {
        this.logger.log(
          `Package ${packageId}: ${err.message} — leaving PROCESSING`,
        );
        return current;
      }
      throw err;
    }
    // Conditional for the same reason. The tree tx's row lock means a FAILED
    // row should never get here with a tree; if one does (moved between the
    // read above and now), the version is already out, so say so loudly and
    // return the row as it stands rather than paper over it with READY.
    const { count } = await this.prisma.scormPackage.updateMany({
      where: { id: packageId, status: ScormPackageStatus.PROCESSING },
      data: {
        status: ScormPackageStatus.READY,
        failureReason: null,
        importWarning,
      },
    });
    const after = await this.prisma.scormPackage.findUnique({
      where: { id: packageId },
    });
    if (!after) throw new NotFoundException('SCORM package not found');
    if (count === 0) {
      this.logger.error(
        `Package ${packageId} left PROCESSING (now ${after.status}) while a ` +
          `version was published for course ${courseId} — not marking READY; ` +
          `reconcile by hand`,
      );
    }
    return { ...after, publishedVersion: published };
  }

  private policyGate(
    completeOn: string,
    probe: RiseProbeResult | null,
  ): { refuse: boolean; reason?: string; warn?: string } {
    const quizItemCount = probe?.quizItemCount ?? 0;
    const reporting = probe?.reporting ?? null;

    if (completeOn === 'passed') {
      if (!probe) {
        return {
          refuse: true,
          reason:
            'completeOn is "passed" but the Rise probe could not run, so quiz/reporting cannot be verified',
        };
      }
      if (quizItemCount === 0) {
        return {
          refuse: true,
          reason:
            'completeOn is "passed" but this package has no scoreable quiz items',
        };
      }
      if (!reporting || !reporting.startsWith('passed-')) {
        return {
          refuse: true,
          reason: `completeOn is "passed" but Rise reporting is "${
            reporting ?? 'unknown'
          }" (expected passed-*)`,
        };
      }
    }

    if (completeOn === 'completed' && !probe) {
      return {
        refuse: false,
        warn: 'Rise probe unavailable; completion gate could not be verified (non-Rise packages may still import with completeOn "completed")',
      };
    }

    if (completeOn === 'completed' && quizItemCount === 0) {
      return {
        refuse: false,
        warn: 'Package has no quiz items; completeOn "completed" will fire when the SCO reports completed',
      };
    }
    return { refuse: false };
  }

  private async buildOrReplaceTree(
    tx: Prisma.TransactionClient,
    args: {
      courseId: string;
      packageId: string;
      versionNumber: number;
      chapterTitle: string;
      completeOn: string;
      passingScore: number | null;
      riseProbeJson: RiseProbeResult | null;
    },
  ) {
    // Try-lock, not a blocking wait: the holder is the backfill script (whose
    // transaction can outlast this one's 20s timeout) or another package's
    // import on the same course. TreeLockBusyError leaves the package
    // PROCESSING (completeImportIfReady returns it as an in-progress poll
    // rather than marking FAILED) so the next poll retries.
    const [{ locked: courseLocked }] = await tx.$queryRaw<
      Array<{ locked: boolean }>
    >(
      Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${args.courseId}, ${COURSE_TREE_LOCK_SEED})) AS locked`,
    );
    if (!courseLocked) {
      throw new TreeLockBusyError(
        `Another SCORM tree write is in progress for course ${args.courseId}`,
      );
    }

    const config: Prisma.InputJsonValue = {
      packageId: args.packageId,
      completeOn: args.completeOn,
      ...(args.passingScore != null ? { passingScore: args.passingScore } : {}),
    };

    const previousReady = await tx.scormPackage.findFirst({
      where: {
        courseId: args.courseId,
        status: ScormPackageStatus.READY,
        id: { not: args.packageId },
      },
      orderBy: { versionNumber: 'desc' },
    });

    // The predecessor is not only a READY package. A partial destroy marks
    // READY packages PRUNED (sections still live), and a package can end
    // FAILED after its tree landed. Looking at READY alone, a re-import then
    // grew a second module/chapter and left the old sections live: the gate
    // reports them as extra, and assertImportedCourseTreeLocked forbids
    // archiving them by hand — the course could never be published again.
    const existing = await this.findScormTreeAnchor(tx, args, previousReady);

    let moduleId: string;
    let chapterId: string;

    if (existing) {
      ({ moduleId, chapterId } = existing);
    } else {
      const mod = await tx.module.create({
        data: {
          title: 'Course content',
          description: '',
          courseId: args.courseId,
        },
      });
      const chapter = await tx.chapter.create({
        data: {
          title: args.chapterTitle,
          description: '',
          pdfFile: '',
          moduleId: mod.id,
        },
      });
      moduleId = mod.id;
      chapterId = chapter.id;
    }

    // Archive EVERY live SCORM section of the course, not just the
    // predecessor's chapter, nor by its single `sectionId` (a lesson manifest
    // owns N sections and `sectionId` names only the first). Runs before this
    // package's sections exist, so none of them is touched; whatever is live
    // now belongs to an earlier package (READY, PRUNED or FAILED alike).
    await tx.section.updateMany({
      where: {
        type: SectionType.SCORM,
        isArchived: false,
        chapter: { module: { courseId: args.courseId } },
      },
      data: { isArchived: true, archivedAt: new Date() },
    });
    if (previousReady) {
      await tx.scormPackage.update({
        where: { id: previousReady.id },
        data: { status: ScormPackageStatus.SUPERSEDED },
      });
    }
    // A reused chapter is NOT renamed to the new package's title: it is shared
    // with every earlier version, and version manifests store only source ids
    // (titles are read live), so a rename would retitle the curriculum pinned
    // learners are still on. scormPackage.title carries the new name.

    // ── Materialise the curriculum ──────────────────────────────────────────
    //
    // One Section per Rise lesson, so an imported course produces the same
    // shape a native one does: the percentage engine, the roster drill-down,
    // the PDF report and the completion gate all count sections, and none of
    // them needs to know SCORM exists.
    //
    // No lesson manifest (non-Rise, or a Rise export we cannot read) → one
    // section, exactly as before. The branch lives here, at import, and costs
    // one `if`; putting it at any read surface would cost a fork in each.
    const lessons = args.riseProbeJson?.lessons ?? [];
    const sectionSpecs =
      lessons.length > 0
        ? lessons.map((lesson) => ({
            title: lesson.title,
            orderIndex: lesson.index + 1,
            // packageId + completeOn stay on EVERY section: the launch path
            // reads them off whichever SCORM section it finds first, and
            // parseScormSectionConfig requires both.
            config: {
              ...(config as Record<string, unknown>),
              scormLessonId: lesson.id,
              scormLessonIndex: lesson.index,
              scormLessonType: lesson.type,
            } as Prisma.InputJsonValue,
            lesson,
          }))
        : [
            {
              title: args.chapterTitle,
              orderIndex: 1,
              config,
              lesson: null,
            },
          ];

    // Ids pre-generated so one createMany replaces N round-trips inside the
    // 20s transaction (a 40-lesson course was 40 sequential INSERTs) — we
    // need each id for the manifest, and Prisma 5.9's createMany returns only
    // a count (createManyAndReturn is 5.14+).
    const created: Array<{ id: string; lesson: RiseLesson | null }> =
      sectionSpecs.map((spec) => ({ id: randomUUID(), lesson: spec.lesson }));
    await tx.section.createMany({
      data: sectionSpecs.map((spec, i) => ({
        id: created[i].id,
        title: spec.title,
        description: '',
        chapterId,
        moduleId,
        type: SectionType.SCORM,
        orderIndex: spec.orderIndex,
        config: spec.config,
      })),
    });

    // The manifest carries each lesson's section id, so resolving a decoded
    // index on the progress path is a JSON read instead of a query.
    const lessonManifest = created
      .filter((row) => row.lesson !== null)
      .map((row) => ({
        index: row.lesson!.index,
        id: row.lesson!.id,
        title: row.lesson!.title,
        type: row.lesson!.type,
        sectionId: row.id,
      }));

    // Conditional so a row that left PROCESSING can never be given a tree;
    // 0 rows throws, rolling back the archive/supersede/sections above.
    const { count } = await tx.scormPackage.updateMany({
      where: { id: args.packageId, status: ScormPackageStatus.PROCESSING },
      data: {
        // The FIRST lesson section. Everything that treats this as "the" SCORM
        // section (launch, certify fallback) wants a valid section, not
        // specifically lesson 1 — and `chapterId` below is what the replace and
        // progress paths use when they need the whole set.
        sectionId: created[0].id,
        chapterId,
        lessons:
          lessonManifest.length > 0
            ? (lessonManifest as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
        lessonCount: lessonManifest.length > 0 ? lessonManifest.length : null,
        title: args.chapterTitle,
        riseProbeJson: args.riseProbeJson
          ? (args.riseProbeJson as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
    if (count === 0) {
      throw new PackageNotProcessingError(
        `Package ${args.packageId} is no longer PROCESSING`,
      );
    }
  }

  /**
   * The chapter/module a new package's sections go into, so a course keeps
   * ONE SCORM tree across re-imports. In order: the chapter of the newest
   * READY or PRUNED package that recorded one; a legacy READY predecessor's
   * section (packages from before `chapterId` existed); the chapter of any
   * live SCORM section (e.g. a FAILED package whose tree landed). Only a live
   * chapter in a live module counts — the gate ignores anything else. Null:
   * build a fresh module/chapter.
   */
  private async findScormTreeAnchor(
    tx: Prisma.TransactionClient,
    args: { courseId: string; packageId: string },
    previousReady: ScormPackage | null,
  ): Promise<{ moduleId: string; chapterId: string } | null> {
    const withChapter = await tx.scormPackage.findFirst({
      where: {
        courseId: args.courseId,
        id: { not: args.packageId },
        status: { in: [ScormPackageStatus.READY, ScormPackageStatus.PRUNED] },
        chapterId: { not: null },
      },
      orderBy: { versionNumber: 'desc' },
      select: { chapterId: true },
    });
    if (withChapter?.chapterId) {
      const chapter = await tx.chapter.findFirst({
        where: {
          id: withChapter.chapterId,
          isArchived: false,
          module: { courseId: args.courseId, isArchived: false },
        },
        select: { id: true, moduleId: true },
      });
      if (chapter) return { moduleId: chapter.moduleId, chapterId: chapter.id };
    }

    if (previousReady?.sectionId && !previousReady.chapterId) {
      const oldSection = await tx.section.findUnique({
        where: { id: previousReady.sectionId },
        select: { chapterId: true, moduleId: true },
      });
      if (!oldSection?.chapterId || !oldSection.moduleId) {
        throw new Error('Previous SCORM section is missing chapter/module');
      }
      return { moduleId: oldSection.moduleId, chapterId: oldSection.chapterId };
    }

    const live = await tx.section.findFirst({
      where: scormGateCandidateSectionsWhere(args.courseId),
      orderBy: { createdAt: 'desc' },
      select: { chapterId: true, chapter: { select: { moduleId: true } } },
    });
    return live
      ? { moduleId: live.chapter.moduleId, chapterId: live.chapterId }
      : null;
  }

  private async prepareExistingCourse(courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) throw new NotFoundException('Course not found');

    if (course.deliveryMode === CourseDeliveryMode.NATIVE) {
      const liveModules = await this.prisma.module.count({
        where: { courseId, isArchived: false },
      });
      if (liveModules > 0) {
        throw new BadRequestException(
          'Cannot import SCORM over a native course that already has modules',
        );
      }
    }

    // Validation only. The switch to IMPORTED_SCORM + isActive:false (an
    // imported course may not be active until it has a READY package and its
    // live SCORM sections — the tree is about to be replaced) is written in
    // startPackageImport's start tx, after the in-flight check, so a refused
    // re-import leaves the course untouched.
    return course;
  }

  private async createImportedCourse(body: CreateScormPackageDto) {
    const title = body.title?.trim();
    if (!title) {
      throw new BadRequestException(
        'title is required when creating a course with the package',
      );
    }
    const existing = await this.prisma.course.findUnique({
      where: { title },
    });
    if (existing) {
      throw new ConflictException('Course already exists with that title');
    }

    try {
      return await this.prisma.course.create({
        data: {
          title,
          description: body.description?.trim() || '',
          image: body.image?.trim() || PLACEHOLDER_IMAGE,
          overview: body.overview?.trim() || '',
          duration: body.duration?.trim() || '',
          assessment: body.assessment?.trim() || '',
          syllabusOverview: body.syllabusOverview?.trim() || '',
          resourcesOverview: body.resourcesOverview?.trim() || '',
          assessments: [],
          resources: [],
          syllabus: [],
          deliveryMode: CourseDeliveryMode.IMPORTED_SCORM,
          isActive: false,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Course already exists with that title');
      }
      throw err;
    }
  }
}

/**
 * Admin-visible importWarning for a manifest whose index space is unverified.
 * Shared with scripts/backfill-scorm-lessons.ts so a backfilled package says
 * exactly what an imported one would. Names the flag because it is the only
 * way off binary progress (see unverifiedIndexSpaceRisk in the runtime).
 */
export function riseIndexSpaceWarning(risk: string | null): string | null {
  return risk
    ? `Lesson index space is unverified for this package (${risk}) — ` +
        `learners report complete/incomplete only (no per-lesson %) until an admin ` +
        `checks a learner's decoded lessons map to the right sections and runs ` +
        `\`yarn script:backfill-scorm-lessons --verify-index-space=<packageId>\``
    : null;
}

/** Why a PROCESSING row can never finish (see STALE_PROCESSING_MS), or null. */
function staleProcessingReason(
  pkg: Pick<
    ScormPackage,
    'status' | 'sectionId' | 'cloudImportJobId' | 'createdAt'
  >,
  now: number,
): string | null {
  if (pkg.status !== ScormPackageStatus.PROCESSING || pkg.sectionId) {
    return null;
  }
  const age = now - pkg.createdAt.getTime();
  if (!pkg.cloudImportJobId) {
    return age >= STALE_UNSTARTED_MS
      ? 'SCORM import never started (no SCORM Cloud import job was recorded) — re-import'
      : null;
  }
  return age >= STALE_PROCESSING_MS
    ? 'SCORM Cloud import did not complete within 24h (SCORM Cloud repeatedly timed out) — re-import'
    : null;
}

function isTransactionTimeout(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2028'
  );
}

function cloudErrorMessage(err: unknown): string {
  if (err instanceof ScormCloudHttpError) {
    return `SCORM Cloud HTTP ${err.cloudStatus}: ${err.cloudBody.slice(
      0,
      300,
    )}`;
  }
  return errorMessage(err);
}
