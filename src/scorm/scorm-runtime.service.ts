import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CourseDeliveryMode,
  Prisma,
  Role,
  ScormPackageStatus,
  ScormRegistration,
  SectionType,
  User,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { CourseVersionService } from '../course-version/course-version.service';
import {
  PinnedCurriculumSection,
  PinnedCurriculumTree,
} from '../course-version/course-version.manifest';
import { PrismaService } from '../prisma/prisma.service';
import {
  ScormCloudClient,
  ScormCloudHttpError,
  ScormCloudRegistrationProgress,
} from '../scorm-cloud/scorm-cloud.client';
import { assertEnrollmentUsable } from '../utils/assert-enrollment-usable';
import {
  parseRiseSuspendData,
  resolveRiseLesson,
} from '../utils/rise-progress';
import { extractRuntime } from '../utils/scorm-runtime-extract';
import { recordChapterAndModuleCompletionIfNeeded } from '../utils/chapter-progression';
import { errorMessage } from '../utils/error-message';
import { compensateCloudRegistration } from '../utils/scorm-cloud-compensate';
import { scormPlayerReturnUrl } from '../utils/scorm-player-url';
import { stripTrailingSlash } from '../utils/strip-trailing-slash';
import { LaunchScormDto } from './dto';
import {
  COMPLETION_RANK,
  completeOnSatisfied,
  mapRegistrationCompletion,
  mapRegistrationSuccess,
  parseScormSectionConfig,
  pickMonotonic,
  SUCCESS_RANK,
} from './scorm-status';

const RECONCILE_BATCH = 20;
const DEFAULT_RECONCILE_AGE_SECONDS = 300;
const PRUNE_SUPERSEDED_BATCH = 10;
/**
 * Floor between runtime pulls for one registration. Rise commits on roughly
 * every block change, so without this an active learner costs one Cloud read
 * per scroll; at 60s the ceiling is ~1 call/min per learner actually studying.
 */
const DEFAULT_RUNTIME_PULL_MIN_INTERVAL_MS = 60_000;
/**
 * Shorter floor for the postback that satisfies completeOn. Certification wants
 * the freshest lesson data, but a certify that keeps failing makes Cloud re-post
 * indefinitely — so this bounds the retry rate instead of waiving the floor.
 */
const TERMINAL_RUNTIME_PULL_MIN_INTERVAL_MS = 10_000;
/**
 * Floor for the postback that ends a session. Effectively a bypass — the point
 * is to catch the learner's last commit — kept just above zero so concurrent
 * duplicates of the same postback collapse into one pull via the atomic claim.
 */
const SESSION_END_RUNTIME_PULL_MIN_INTERVAL_MS = 1_000;
/**
 * "Dirty" rows reconcile pulls IN ADDITION to the sweep's RECONCILE_BATCH: a
 * postback was recorded that no runtime snapshot followed (debounced, or the
 * pull failed). Additive rather than carved out of the sweep, so the
 * incomplete/uncertified sweep keeps all of its slots.
 */
const RECONCILE_DIRTY_BATCH = 10;
/**
 * Only dirt this recent is prioritised. At deploy every historic row reads
 * dirty (`lastRuntimeAppliedAt` was never written), and without a window that
 * backlog would take the dirty slots for weeks; older rows still reach Cloud
 * through the sweep if they are incomplete.
 */
const RECONCILE_DIRTY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/**
 * Outbound Cloud reads in flight at once during reconcile. One cron invocation
 * firing the whole batch concurrently is a burst Cloud can throttle and that
 * holds that many DB connections across the round-trip.
 */
const RECONCILE_CONCURRENCY = 5;
/**
 * No reconcile item STARTS after this much wall-clock. The invocation is capped
 * at Vercel's 60s, and the caps alone do not fit it: 10 dirty + 20 sweep = 30
 * items at concurrency 5 is 6 waves × (10s Cloud timeout + ~2s apply/certify)
 * = ~72s worst case. With the deadline, worst case is 30s + one in-flight item
 * (~12s) = ~42s, leaving headroom for the other jobs the daily cron runs in the
 * same invocation. On a healthy Cloud (~0.5s/read) all 30 finish in seconds;
 * what the deadline cuts under a slow one is the tail — sweep rows, since dirty
 * go first — which the next run picks up.
 */
const RECONCILE_DEADLINE_MS = 30_000;
/**
 * How long a progress READ will wait on a pull-on-read before answering from
 * the DB as it stands. The pull keeps running past it; the page just does not
 * wait for it.
 */
const READ_PULL_BUDGET_MS = 2_500;
/** Bound on the per-process dedupe set for undecodable-blob warnings. */
const UNDECODABLE_WARN_CACHE = 500;
/**
 * Key on `ScormRegistration.metadata` recording the Rise cpv this
 * registration's blob corroborated against the manifest. Two distinct
 * registrations agreeing is what seeds `ScormPackage.riseCpv`.
 */
const CORROBORATED_CPV_KEY = 'riseCpvCorroborated';

type CertifyOutcome = 'done' | 'skipped' | 'retry';

/**
 * Bounded retries for the compare-and-set scalar write. Each retry means a
 * concurrent writer touched the row in the few ms since the re-read, so more
 * than a couple in a row is not contention we expect to see.
 */
const SCALAR_WRITE_ATTEMPTS = 5;

/**
 * Timing facts about the snapshot being applied — what makes "clean" honest.
 *
 * Every stamp is the instant the INFORMATION was current, never the instant it
 * was written. A pull's answer can land long after it was issued (a slow Cloud,
 * a Vercel-frozen promise resuming on the next request), and stamping it at
 * apply time would mark clean a row whose newer postback it never saw.
 */
export type ApplySnapshotTiming = {
  /**
   * When the Cloud request this payload answers was ISSUED, or when the
   * postback carrying it was received. Gates the last-write-wins snapshot
   * fields: an apply older than what the row already reflects skips them.
   */
  snapshotAt?: Date;
  /** Set by real postbacks only; written as GREATEST into lastPostbackAt. */
  postbackReceivedAt?: Date;
  /**
   * The payload is the answer to a FULL pull. A FULL pull that returns no
   * runtime (Rise has not written one yet) still happened, so it still marks
   * the row clean — otherwise such rows stay dirty forever.
   */
  fullPull?: boolean;
};

@Injectable()
export class ScormRuntimeService {
  private readonly logger = new Logger(ScormRuntimeService.name);
  /** Dedupe keys for `warnUndecodableSuspendData`. */
  private readonly undecodableSeen = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cloud: ScormCloudClient,
    private readonly courseVersionService: CourseVersionService,
    private readonly courseCompletion: CourseCompletionService,
  ) {}

  async launch(
    user: User,
    body: LaunchScormDto,
  ): Promise<{ launchLink: string }> {
    if (user.deletedAt) {
      throw new ForbiddenException('Account is not available');
    }

    const frontend = this.config.get<string>('PUBLIC_FRONTEND_URL');
    if (!frontend) {
      throw new InternalServerErrorException(
        'PUBLIC_FRONTEND_URL is not configured',
      );
    }

    const isLearner = user.role === Role.user;
    const resolved = isLearner
      ? (
          await Promise.all([
            this.resolvePinnedScormTarget(user.id, body.courseId),
            assertEnrollmentUsable(
              this.prisma,
              user.id,
              body.courseId,
              Role.user,
            ),
          ])
        )[0]
      : await this.resolvePinnedScormTarget(user.id, body.courseId);

    if (body.packageId && body.packageId !== resolved.package.id) {
      throw new ConflictException(
        'packageId does not match the SCORM package on your pinned curriculum',
      );
    }

    if (isLearner && !resolved.courseIsActive) {
      throw new ForbiddenException('This course is not published yet');
    }

    const pkgStatus = resolved.package.status;
    if (
      pkgStatus !== ScormPackageStatus.READY &&
      pkgStatus !== ScormPackageStatus.SUPERSEDED
    ) {
      throw new ForbiddenException('This SCORM package is not ready to launch');
    }

    // Resolved BEFORE the Promise.all, not inside its argument array. An
    // `await` in there runs while `ensureCloudRegistration(...)` is already
    // in flight with no handler attached — so if that rejects in the window
    // (unset postback credentials, a Cloud 5xx on createRegistration) Node
    // sees an unhandled rejection and the process exits instead of returning
    // an error to the caller.
    const repairStalePointer = await this.lastSeenPointerIsStale(
      user.id,
      resolved.chapterId,
    );

    const [registration] = await Promise.all([
      this.ensureCloudRegistration({
        user,
        courseId: body.courseId,
        packageId: resolved.package.id,
        scormCloudCourseId: resolved.package.scormCloudCourseId,
        sectionId: resolved.sectionId,
        moduleId: resolved.moduleId,
        chapterId: resolved.chapterId,
        completeOn: resolved.completeOn,
      }),
      this.upsertLastSeen({
        userId: user.id,
        courseId: body.courseId,
        moduleId: resolved.moduleId,
        chapterId: resolved.chapterId,
        sectionId: resolved.sectionId,
        repairStalePointer,
      }),
    ]);

    const launchLink = await this.cloud.buildRegistrationLaunchLink({
      registrationId: registration.scormCloudRegistrationId,
      redirectOnExitUrl: scormPlayerReturnUrl(frontend, body.courseId),
      expiry: 120,
    });

    return { launchLink };
  }

  /**
   * Persist Cloud snapshot first. Then, if completeOn is satisfied, run the
   * D1 certify bridge. Missing row or incomplete certify → 5xx so Cloud retries.
   *
   * ## Why this also pulls
   *
   * Registrations are created with `resultsFormat: 'COURSE'`, and a COURSE
   * payload carries no `activityDetails.children`, so no runtime, so no
   * suspendData — measured against the live API, not assumed. Push therefore
   * cannot deliver lesson progress on its own.
   *
   * Switching the postback to FULL would fix that but puts per-question learner
   * answers on the wire on every commit and changes the envelope the working
   * completion path depends on. Instead the postback stays the TRIGGER and a
   * debounced server-side pull supplies the detail: freshness tracks learner
   * activity instead of the daily cron's 20-registration ceiling, with no
   * change to the Cloud-side contract and no learner PII in transit.
   *
   * The pull is best-effort by construction. Cloud retries 5xx indefinitely, so
   * a Cloud outage must not turn every postback into a retry storm — a failed
   * pull degrades to the snapshot the postback already carried.
   */
  async handlePostback(payload: unknown): Promise<void> {
    // Taken before anything else: this is the instant the postback's
    // information was current, and what lastPostbackAt records.
    const receivedAt = new Date();
    const parsed = this.parseProgressPayload(payload);
    if (!parsed.id) {
      throw new InternalServerErrorException('Postback payload is missing id');
    }

    const row = await this.prisma.scormRegistration.findUnique({
      where: { scormCloudRegistrationId: parsed.id },
    });
    if (!row) {
      throw new InternalServerErrorException(
        'Unknown SCORM registration (dummy TestRegistrationPostback ids are expected to 5xx after auth)',
      );
    }

    const { payload: pulled, issuedAt } = await this.pullRuntimeDetail(
      row,
      parsed,
    );

    // Re-read when a pull happened. `row` predates a Cloud round-trip, and
    // everything merged below — pickMonotonic, the time max, the access-date
    // min/max — would otherwise compare against a snapshot a concurrent
    // postback or reconcile may already have advanced, writing it backwards.
    // A vanished row falls through to the original: the update then fails
    // loudly, which is the right outcome for a purged registration.
    const current =
      pulled === parsed
        ? row
        : (await this.prisma.scormRegistration.findUnique({
            where: { id: row.id },
          })) ?? row;

    // The pull REPLACES the postback body, and the two are snapshots at
    // slightly different instants. Completion and success are ranked
    // monotonically downstream and time takes a Math.max, but `score` has no
    // such guard — so a pull that lands a moment behind would discard a score
    // the postback had just reported. Carry forward anything the pull does not
    // itself supply.
    const enriched: ScormCloudRegistrationProgress =
      pulled === parsed
        ? parsed
        : {
            ...pulled,
            // Max, not coalesce. The two snapshots are instants apart on the
            // SAME attempt, so a pull that lags would otherwise discard the
            // higher score the postback had just reported — and `scoreScaled`
            // is last-write-wins downstream, unlike completion and success
            // which are rank-merged.
            score: higherScore(pulled.score, parsed.score),
            totalSecondsTracked:
              pulled.totalSecondsTracked ?? parsed.totalSecondsTracked,
            // Rank-merged, not just coalesced. If the pulled snapshot lags the
            // postback (or omits these), taking it verbatim reads as 'unknown',
            // completeOnSatisfied goes false and certification is skipped —
            // silently, because nothing throws, so Cloud gets a 200 and never
            // retries and the learner waits for the daily reconcile.
            registrationCompletion: higherRanked(
              pulled.registrationCompletion,
              parsed.registrationCompletion,
              mapRegistrationCompletion,
              COMPLETION_RANK,
            ),
            registrationSuccess: higherRanked(
              pulled.registrationSuccess,
              parsed.registrationSuccess,
              mapRegistrationSuccess,
              SUCCESS_RANK,
            ),
          };

    await this.applyProgressAndMaybeCertify(current, enriched, {
      throwIfCertifyIncomplete: true,
      postbackReceivedAt: receivedAt,
      // A pull was issued after the postback arrived, so it is the fresher
      // of the two; without one, the postback body is the snapshot.
      snapshotAt: issuedAt ?? receivedAt,
      fullPull: issuedAt != null,
    });
  }

  /**
   * Upgrade a postback payload to FULL detail with one Cloud read.
   *
   * Debounced per registration: Rise commits often, and without a floor an
   * active learner would cost one Cloud call per block they scroll past.
   *
   * The floor is wall-clock against `lastRuntimePullAt` — a dedicated column,
   * NOT `lastPostbackAt`. Every postback stamps the latter, so the gap since it
   * is smallest exactly when the learner is active, and debouncing against it
   * would mean "pull only after 60s of inactivity": the learners this exists to
   * serve would never be pulled for at all. A column rather than in-process
   * state because this runs serverless, where a module-level cache would not
   * survive between invocations.
   *
   * Returns the original payload and a null `issuedAt` when the pull is skipped
   * or fails; `issuedAt` is the claim instant when a FULL body came back.
   * Never throws.
   */
  private async pullRuntimeDetail(
    row: ScormRegistration,
    payload: ScormCloudRegistrationProgress,
  ): Promise<{
    payload: ScormCloudRegistrationProgress;
    issuedAt: Date | null;
  }> {
    const skipped = { payload, issuedAt: null };
    // Already FULL (a future resultsFormat change, or the reconcile cron) —
    // nothing to add.
    if (extractRuntime(payload)?.runtime) return skipped;

    const floorMs = this.runtimePullFloorMs();

    // Measured against the last PULL, never against `lastPostbackAt` — that one
    // is stamped by every postback, so the gap since it is small precisely when
    // the learner is active, and an active learner would never be pulled for.
    // A cheap pre-check on the row we already hold; the claim below is the
    // authoritative, atomic one.
    const sincePull = row.lastRuntimePullAt
      ? Date.now() - row.lastRuntimePullAt.getTime()
      : Number.POSITIVE_INFINITY;

    // The session-end commit. Without a trailing pull, the learner's LAST
    // commit before closing Rise is the one most likely to land inside the
    // floor, and nothing would look again until their next session or the
    // daily reconcile. The COURSE envelope carries no `runtime.exit`, so the
    // signal is the activity's `suspended` flipping to true — which Cloud sets
    // when the SCO suspends on exit. Edge-triggered against the stored value,
    // so it fires once per session and cannot become a per-commit bypass.
    //
    // Relies on Cloud flipping `suspended` back to false when the learner
    // resumes; if it ever stopped doing so, the edge would fire once per
    // registration rather than once per session. Not fixable from here — and
    // a missed edge only leaves the row dirty for pull-on-read and reconcile.
    const sessionEnded =
      row.suspended !== true && extractRuntime(payload)?.suspended === true;

    let effectiveFloorMs = floorMs;
    if (sessionEnded) {
      effectiveFloorMs = SESSION_END_RUNTIME_PULL_MIN_INTERVAL_MS;
    } else if (
      sincePull >= TERMINAL_RUNTIME_PULL_MIN_INTERVAL_MS &&
      sincePull < floorMs &&
      (await this.isTerminalPostback(row, payload))
    ) {
      // Only evaluated when the shorter floor would actually change the
      // answer, so an ordinary commit pays no extra queries.
      effectiveFloorMs = Math.min(
        floorMs,
        TERMINAL_RUNTIME_PULL_MIN_INTERVAL_MS,
      );
    }

    if (sincePull < effectiveFloorMs) return skipped;

    // Claimed BEFORE the call, so the floor counts attempts rather than
    // successes. A Cloud outage makes `getRegistrationProgress` throw, and
    // stamping afterwards would leave `lastRuntimePullAt` untouched — so every
    // subsequent Rise commit would issue another outbound call for as long as
    // the outage lasted, which is the opposite of what a rate limiter is for.
    //
    // Inside the try for the same reason everything else here is: the row can
    // vanish between the caller's findUnique and this write (a concurrent GDPR
    // purge, or any transient DB error), and an escape from this method becomes
    // a 5xx that Cloud retries on the same body forever.
    let issuedAt: Date | null = null;
    try {
      issuedAt = await this.claimRuntimePull(row.id, effectiveFloorMs);
      if (!issuedAt) return skipped;

      const full = await this.cloud.getRegistrationProgress(
        row.scormCloudRegistrationId,
        'full',
      );
      // A 2xx with an unusable body is as much a failed pull as a throw, and
      // handing it downstream would read every field as absent — which, under
      // "absent never nulls present", is silent no-op at best and at worst a
      // crash on the first property read. Keep the snapshot we already have.
      if (!full || typeof full !== 'object' || Array.isArray(full)) {
        this.logger.warn(
          `Runtime pull for registration ${row.id} returned no usable body; falling back to the postback snapshot`,
        );
        return skipped;
      }
      return { payload: full, issuedAt };
    } catch (err) {
      if (issuedAt) await this.markRuntimeGoneIf404(row.id, issuedAt, err);
      this.logger.warn(
        `Runtime pull failed for registration ${
          row.id
        }; falling back to the postback snapshot: ${errorMessage(err)}`,
      );
      return skipped;
    }
  }

  /**
   * Whether this postback decides certification AND the bridge could act on
   * it. Without the second half, a learner the bridge will only ever skip
   * (staff preview, unpublished course, revoked enrolment) keeps the 10s floor
   * forever: `completedAt` never gets stamped for them, so the cheap test
   * alone stays true on every commit.
   *
   * `canRecordProgress` makes exactly the checks the bridge makes before it
   * would return 'skipped'.
   */
  private async isTerminalPostback(
    row: ScormRegistration,
    payload: ScormCloudRegistrationProgress,
  ): Promise<boolean> {
    if (row.completedAt != null) return false;
    if (
      !completeOnSatisfied(
        row.completeOn,
        mapRegistrationCompletion(payload.registrationCompletion),
        mapRegistrationSuccess(payload.registrationSuccess),
      )
    ) {
      return false;
    }
    return this.canRecordProgress(row, 'terminal pull floor');
  }

  /**
   * Cloud says the registration does not exist (deleted Cloud-side, or its
   * package was pruned). Every later pull would 404 too, so mark the row clean
   * as of this attempt: pull-on-read and reconcile then stop retrying it until
   * a new postback — which a gone registration cannot send — dirties it again.
   *
   * Monotonic in the write itself, so it can never walk the stamp backwards
   * past a newer apply. Best-effort, like every other stamp on these paths.
   */
  private async markRuntimeGoneIf404(
    registrationId: string,
    issuedAt: Date,
    err: unknown,
  ): Promise<void> {
    if (!(err instanceof ScormCloudHttpError) || err.cloudStatus !== 404) {
      return;
    }
    this.logger.warn(
      `Cloud has no registration for ${registrationId} (404); marking its runtime as pulled so reads and reconcile stop retrying it`,
    );
    try {
      await this.prisma.scormRegistration.updateMany({
        where: {
          id: registrationId,
          OR: [
            { lastRuntimeAppliedAt: null },
            { lastRuntimeAppliedAt: { lt: issuedAt } },
          ],
        },
        data: { lastRuntimeAppliedAt: issuedAt },
      });
    } catch (stampErr) {
      this.logger.warn(
        `Could not mark registration ${registrationId} as gone: ${errorMessage(
          stampErr,
        )}`,
      );
    }
  }

  /**
   * The configured floor between runtime pulls.
   *
   * A bad env var must not silently DISABLE the floor. NaN fails every
   * comparison, and `Number('')` is 0 — both would turn each postback into a
   * Cloud read, the exact storm this constant exists to prevent. Require a
   * positive number to override; anything else falls back to the default.
   */
  private runtimePullFloorMs(): number {
    const configured = Number(
      this.config.get('SCORM_RUNTIME_PULL_MIN_INTERVAL_MS'),
    );
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_RUNTIME_PULL_MIN_INTERVAL_MS;
  }

  /**
   * Atomically take the right to pull for one registration.
   *
   * Check-and-stamp in ONE conditional statement: a read-then-update lets two
   * concurrent postbacks (Rise commits in bursts) both see "outside the floor"
   * and both pull. Only the writer whose UPDATE matched owns the pull.
   *
   * Returns the claim instant — the moment the Cloud request is issued, which
   * is what the eventual apply stamps as `lastRuntimeAppliedAt` — or null when
   * another caller holds the floor.
   */
  private async claimRuntimePull(
    registrationId: string,
    floorMs: number,
  ): Promise<Date | null> {
    const now = new Date();
    const { count } = await this.prisma.scormRegistration.updateMany({
      where: {
        id: registrationId,
        OR: [
          { lastRuntimePullAt: null },
          { lastRuntimePullAt: { lt: new Date(now.getTime() - floorMs) } },
        ],
      },
      data: { lastRuntimePullAt: now },
    });
    return count === 1 ? now : null;
  }

  /**
   * Pull-on-read: bring a "dirty" registration up to date before it is shown.
   *
   * Dirty means a postback was recorded that no runtime snapshot followed —
   * the debounce skipped it, or the pull failed — so the learner's latest
   * lessons exist only in Cloud. This is the trailing pull the debounce lacks,
   * placed where staleness is actually observed.
   *
   * Bounded three ways so a read stays cheap: clean rows cost nothing, the
   * same atomic floor as the postback path applies, and the caller waits at
   * most READ_PULL_BUDGET_MS. Never throws — a failed refresh just means the
   * page shows what the DB already had.
   *
   * Public so admin read paths (roster, reports) can call it per registration.
   */
  async refreshIfDirty(
    row: Pick<
      ScormRegistration,
      'id' | 'scormCloudRegistrationId' | 'lastPostbackAt' | 'packageId'
    > & {
      lastRuntimeAppliedAt: Date | null;
      /** The package's status when the caller already has it; else looked up. */
      packageStatus?: ScormPackageStatus | null;
    },
  ): Promise<boolean> {
    if (!isRuntimeDirty(row)) return false;
    let issuedAt: Date | null;
    try {
      // A pruned package's Cloud course — and every registration on it — is
      // deleted, so a pull can only 404. Checked after the dirty test so a
      // clean row still costs nothing.
      const status =
        row.packageStatus !== undefined
          ? row.packageStatus
          : (
              await this.prisma.scormPackage.findUnique({
                where: { id: row.packageId },
                select: { status: true },
              })
            )?.status;
      if (status === ScormPackageStatus.PRUNED) return false;

      issuedAt = await this.claimRuntimePull(row.id, this.runtimePullFloorMs());
      if (!issuedAt) return false;
    } catch (err) {
      this.logger.warn(
        `Pull-on-read claim failed for registration ${row.id}: ${errorMessage(
          err,
        )}`,
      );
      return false;
    }
    const claimedAt = issuedAt;

    const work = (async (): Promise<boolean> => {
      let progress: ScormCloudRegistrationProgress;
      try {
        progress = await this.cloud.getRegistrationProgress(
          row.scormCloudRegistrationId,
          'full',
        );
      } catch (err) {
        await this.markRuntimeGoneIf404(row.id, claimedAt, err);
        throw err;
      }
      if (
        !progress ||
        typeof progress !== 'object' ||
        Array.isArray(progress)
      ) {
        return false;
      }
      const fresh = await this.prisma.scormRegistration.findUnique({
        where: { id: row.id },
      });
      if (!fresh) return false;
      // Stamped with the CLAIM instant, not when this resolves. If the budget
      // below wins, this promise can finish much later — on serverless, only
      // when the frozen instance next thaws — and a postback that arrived
      // meanwhile must keep the row dirty.
      await this.applyProgressAndMaybeCertify(fresh, progress, {
        throwIfCertifyIncomplete: false,
        snapshotAt: claimedAt,
        fullPull: true,
      });
      return true;
    })().catch((err) => {
      // Attached up front: if the budget below wins the race, nobody else is
      // left awaiting this promise, and an unhandled rejection kills the
      // process.
      this.logger.warn(
        `Pull-on-read failed for registration ${row.id}: ${errorMessage(err)}`,
      );
      return false;
    });

    let timer: NodeJS.Timeout | undefined;
    const budget = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), READ_PULL_BUDGET_MS);
      timer.unref?.();
    });
    try {
      return await Promise.race([work, budget]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * `invocationDeadline` (epoch ms): the daily cron's shared deadline. This
   * run's own RECONCILE_DEADLINE_MS counts from ITS start, which, after the
   * sweeps before it, can land past the 60s kill; the earlier of the two wins.
   */
  async reconcileCron(invocationDeadline?: number) {
    const startedAt = Date.now();
    const ageSeconds = Number(
      this.config.get('SCORM_RECONCILE_AGE_SECONDS') ??
        DEFAULT_RECONCILE_AGE_SECONDS,
    );
    const cutoff = new Date(startedAt - ageSeconds * 1000);
    const dirtySince = new Date(startedAt - RECONCILE_DIRTY_WINDOW_MS);

    // Dirty rows first: a postback whose runtime was never pulled (debounced,
    // or the pull failed) leaves the learner's last lessons only in Cloud, and
    // without priority they would wait behind the oldest-first sweep below —
    // possibly for days at one cron a day. Newest-dirty first, and only within
    // RECONCILE_DIRTY_WINDOW_MS, so neither the deploy-time backlog nor a row
    // that keeps failing can pin these slots. Pruned packages are excluded:
    // their Cloud registrations are deleted, so a pull can only 404.
    const dirty = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT sr.id
          FROM "scorm_registrations" sr
          JOIN "scorm_packages" sp ON sp.id = sr."packageId"
         WHERE sr."lastPostbackAt" IS NOT NULL
           AND sr."lastPostbackAt" < ${cutoff}
           AND sr."lastPostbackAt" >= ${dirtySince}
           AND sp."status" <> 'PRUNED'
           AND (
             sr."lastRuntimeAppliedAt" IS NULL
             OR sr."lastPostbackAt" > sr."lastRuntimeAppliedAt"
           )
         ORDER BY sr."lastPostbackAt" DESC
         LIMIT ${RECONCILE_DIRTY_BATCH}
      `,
    );

    // Least-recently-PULLED first. Reconcile no longer stamps lastPostbackAt
    // (only real postbacks do), so ordering by it alone would hand the same
    // oldest abandoned-incomplete rows every slot on every run; the pull claim
    // below stamps lastRuntimePullAt, which rotates them to the back.
    const sweep = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT sr.id
          FROM "scorm_registrations" sr
          JOIN "scorm_packages" sp ON sp.id = sr."packageId"
          LEFT JOIN "course_completions" cc
            ON cc."userId" = sr."userId" AND cc."courseId" = sr."courseId"
         WHERE COALESCE(sr."lastPostbackAt", sr."firstLaunchAt", sr."createdAt") < ${cutoff}
           AND sp."status" <> 'PRUNED'
           AND (
             (sr."completeOn" = 'passed' AND sr."successStatus" <> 'passed')
             OR (sr."completeOn" <> 'passed' AND sr."completionStatus" <> 'completed')
             OR (
               (
                 (sr."completeOn" = 'passed' AND sr."successStatus" = 'passed')
                 OR (sr."completeOn" <> 'passed' AND sr."completionStatus" = 'completed')
               )
               AND (cc."courseCompletedAt" IS NULL OR cc."isPassed" = false)
             )
           )
         ORDER BY sr."lastRuntimePullAt" ASC NULLS FIRST,
                  COALESCE(sr."lastPostbackAt", sr."firstLaunchAt", sr."createdAt") ASC
         LIMIT ${RECONCILE_BATCH}
      `,
    );

    // Dirty first, deduped. At most RECONCILE_DIRTY_BATCH + RECONCILE_BATCH;
    // the deadline below, not this cap, is what keeps the run inside 60s.
    const candidates = Array.from(
      new Set([...(dirty ?? []), ...(sweep ?? [])].map((c) => c.id)),
    ).map((id) => ({ id }));

    if (candidates.length === 0) {
      return { candidates: 0, updated: 0, deferred: 0 };
    }

    const rows = await this.prisma.scormRegistration.findMany({
      where: { id: { in: candidates.map((c) => c.id) } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const deadline = Math.min(
      startedAt + RECONCILE_DEADLINE_MS,
      invocationDeadline ?? Infinity,
    );

    const results = await mapWithConcurrency(
      candidates,
      RECONCILE_CONCURRENCY,
      async ({ id }): Promise<boolean | 'deferred'> => {
        if (Date.now() >= deadline) return 'deferred';
        let issuedAt: Date | null = null;
        try {
          const row = byId.get(id);
          if (!row) return false;
          // Through the same claim as every other pull: it is the issue
          // instant the apply stamps, it rotates the sweep, and it stops this
          // doubling up on a pull a postback just made.
          issuedAt = await this.claimRuntimePull(id, this.runtimePullFloorMs());
          if (!issuedAt) return false;
          // 'full' — the only detail level that carries runtime.suspendData,
          // which is the only source of lesson-level progress.
          const progress = await this.cloud.getRegistrationProgress(
            row.scormCloudRegistrationId,
            'full',
          );
          if (!progress || typeof progress !== 'object') return false;
          const fresh = await this.prisma.scormRegistration.findUnique({
            where: { id },
          });
          if (!fresh) return false;
          await this.applyProgressAndMaybeCertify(fresh, progress, {
            throwIfCertifyIncomplete: false,
            snapshotAt: issuedAt,
            fullPull: true,
          });
          return true;
        } catch (err) {
          if (issuedAt) await this.markRuntimeGoneIf404(id, issuedAt, err);
          this.logger.warn(
            `Reconcile failed for registration ${id}: ${errorMessage(err)}`,
          );
          return false;
        }
      },
    );

    return {
      candidates: candidates.length,
      updated: results.filter((r) => r === true).length,
      deferred: results.filter((r) => r === 'deferred').length,
    };
  }

  /**
   * Best-effort prune of SUPERSEDED packages whose Cloud course is no longer
   * referenced by in-progress registrations or pinned enrollments on the old
   * section's version.
   */
  async pruneSupersededPackagesCron(deadline?: number) {
    const superseded = await this.prisma.scormPackage.findMany({
      where: {
        status: ScormPackageStatus.SUPERSEDED,
        sectionId: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      take: PRUNE_SUPERSEDED_BATCH,
      select: {
        id: true,
        courseId: true,
        sectionId: true,
        scormCloudCourseId: true,
        // Needed by canPruneSupersededPackage to resolve every section this
        // package owns, not just the first lesson's.
        lessons: true,
        chapterId: true,
      },
    });

    let pruned = 0;
    let deferred = 0;
    for (const pkg of superseded) {
      // Each item is several Cloud calls (one per registration, then the
      // course), so the shared deadline is checked per package; the rest wait
      // for the next run, still SUPERSEDED.
      if (deadline !== undefined && Date.now() >= deadline) {
        deferred += 1;
        continue;
      }
      try {
        const canPrune = await this.canPruneSupersededPackage(pkg);
        if (!canPrune) continue;

        const registrations = await this.prisma.scormRegistration.findMany({
          where: { packageId: pkg.id },
          select: { scormCloudRegistrationId: true },
        });
        for (const reg of registrations) {
          await compensateCloudRegistration(
            this.cloud,
            reg.scormCloudRegistrationId,
            this.logger,
          );
        }
        try {
          await this.cloud.deleteCourse(pkg.scormCloudCourseId);
        } catch (err) {
          this.logger.warn(
            `Failed SCORM Cloud DeleteCourse ${
              pkg.scormCloudCourseId
            }: ${errorMessage(err)}`,
          );
          continue;
        }
        await this.prisma.scormPackage.update({
          where: { id: pkg.id },
          data: { status: ScormPackageStatus.PRUNED },
        });
        pruned += 1;
      } catch (err) {
        this.logger.warn(
          `Prune check failed for package ${pkg.id}: ${errorMessage(err)}`,
        );
      }
    }

    return { candidates: superseded.length, pruned, deferred };
  }

  /**
   * A learner's SCORM state. A DB read, except for one bounded case: a "dirty"
   * registration (a postback no runtime pull followed) is refreshed first via
   * `refreshIfDirty`, which waits at most READ_PULL_BUDGET_MS and never throws.
   * Without it, the learner's last commit before closing Rise is invisible
   * until the daily reconcile.
   *
   * Since lesson progress became ordinary `UserCourseProgress` rows, this is no
   * longer the primary progress source: `course.percentage` from the shared
   * percentage engine is, and it is correct for SCORM without any branch. What
   * remains here is the SCORM-specific detail no native course has — the
   * bookmark, attempts, the resume flag, and Cloud's own access timestamps.
   *
   * Additive only: every field the previous contract returned is still here.
   */
  async getLearnerProgress(userId: string, courseId: string) {
    if (!courseId) {
      throw new BadRequestException('courseId is required');
    }
    const select = {
      id: true,
      packageId: true,
      completionStatus: true,
      successStatus: true,
      scoreScaled: true,
      totalTimeSeconds: true,
      firstLaunchAt: true,
      lastPostbackAt: true,
      completedAt: true,
      lessonsCompleted: true,
      lessonsCompletedAtCertify: true,
      progressSource: true,
      lessonId: true,
      lessonIndex: true,
      lessonTitle: true,
      attempts: true,
      suspended: true,
      firstAccessAt: true,
      lastAccessAt: true,
      // Read for the dirty check only; stripped from the response below.
      scormCloudRegistrationId: true,
      lastRuntimeAppliedAt: true,
    } satisfies Prisma.ScormRegistrationSelect;

    let found = await this.prisma.scormRegistration.findFirst({
      where: { userId, courseId },
      orderBy: { createdAt: 'desc' },
      select,
    });
    if (!found) return { message: 'ok', statusCode: 200, data: null };

    // The denominator for "Lesson 6 of 14". Comes from the registration's OWN
    // package, so a learner on a superseded package still sees their own
    // package's lesson count rather than the newest one's. Read before the
    // refresh because its status decides whether a pull is even possible.
    const pkg = await this.prisma.scormPackage.findUnique({
      where: { id: found.packageId },
      select: { lessonCount: true, status: true },
    });

    if (
      await this.refreshIfDirty({
        ...found,
        packageStatus: pkg?.status ?? null,
      })
    ) {
      found =
        (await this.prisma.scormRegistration.findUnique({
          where: { id: found.id },
          select,
        })) ?? found;
    }
    // The response contract predates the dirty check; keep its two
    // bookkeeping fields out of it.
    const row: Partial<typeof found> & Pick<typeof found, 'packageId'> = {
      ...found,
    };
    delete row.scormCloudRegistrationId;
    delete row.lastRuntimeAppliedAt;

    const lessonsTotal = pkg?.lessonCount ?? null;
    // Certification stamps a progress row for every section, so the shared
    // percentage engine reads 100% for a certified learner — but the decoded
    // set is what they actually read, and "3 of 14" beside a 100% course reads
    // as a bug. Report the course's own verdict; the decoded figure stays
    // available for anyone asking what was really read.
    const certified = row.completedAt != null && lessonsTotal != null;

    return {
      message: 'ok',
      statusCode: 200,
      data: {
        ...row,
        lessonsCompleted: certified ? lessonsTotal : row.lessonsCompleted,
        lessonsCompletedDecoded: row.lessonsCompleted ?? null,
        lessonsTotal,
      },
    };
  }

  async applyProgressAndMaybeCertify(
    current: ScormRegistration,
    payload: ScormCloudRegistrationProgress,
    options: { throwIfCertifyIncomplete: boolean } & ApplySnapshotTiming,
  ): Promise<void> {
    // Defaulting to "now" is only right for a caller that applies what it
    // just fetched; every path in this file passes the real instant.
    const snapshotAt = options.snapshotAt ?? new Date();

    // Lesson-level progress, when this payload carries a runtime. Runs BEFORE
    // the scalar update so both land in the same pass, and returns the extra
    // columns to write rather than writing them itself — one update per call.
    //
    // Guarded, like every other best-effort block here. This method's contract
    // is that the Cloud snapshot is persisted FIRST; letting a transient
    // failure in the lesson decode (a vanished package row, an FK race on a
    // section being archived) escape would abandon that write entirely and
    // return a 5xx that Cloud retries on the same body indefinitely — losing
    // the completion status as well as the lesson detail.
    let lessonUpdate: Prisma.ScormRegistrationUpdateInput = {};
    let lessonsFailed = false;
    try {
      lessonUpdate = await this.applyLessonProgress(
        current,
        payload,
        isSnapshotFresh(current, snapshotAt),
      );
    } catch (err) {
      this.logger.warn(
        `Lesson progress failed for registration ${
          current.id
        }; keeping the Cloud snapshot: ${errorMessage(err)}`,
      );
      lessonsFailed = true;
    }

    // Not when the lesson apply threw: lastRuntimeAppliedAt is what marks the
    // row clean, and stamping it would hide lessons that never landed from the
    // dirty-first reconcile and the pull-on-read alike.
    const markApplied =
      !lessonsFailed &&
      (options.fullPull || !!extractRuntime(payload)?.runtime);
    const { completionStatus, successStatus } = await this.writeScalars(
      current,
      payload,
      lessonUpdate,
      {
        snapshotAt,
        postbackReceivedAt: options.postbackReceivedAt,
        markApplied,
      },
    );

    if (
      !completeOnSatisfied(current.completeOn, completionStatus, successStatus)
    ) {
      return;
    }

    // Already certified: the bridge is a dozen queries plus a full-curriculum
    // stamp, and a finished learner reopening the package keeps posting back.
    // `completedAt` alone is not trusted as the answer — it is only set when
    // the bridge last returned 'done', and the completion row it vouched for
    // can since have been reset — so confirm that row is still certified.
    if (current.completedAt != null && (await this.isStillCertified(current))) {
      return;
    }

    const outcome = await this.runCompletionBridge({
      ...current,
      completionStatus,
      successStatus,
    });
    if (outcome === 'skipped') {
      return;
    }
    if (outcome === 'done') {
      return;
    }
    if (options.throwIfCertifyIncomplete) {
      throw new InternalServerErrorException(
        'SCORM snapshot saved but course certification is not complete yet',
      );
    }
  }

  /**
   * The single scalar write for one apply, as a compare-and-set on `updatedAt`.
   *
   * Everything here merges against the row as it stands: completion/success by
   * rank, time and lastAccessAt by max, firstAccessAt by min, the two dirty
   * stamps by max. `current` was read before the lesson decode (several
   * queries, sometimes a Cloud call), so merging against it and writing
   * unconditionally is a lost update — a lagging pull could put 'incomplete'
   * back over a concurrent 'completed'. The conditional `updatedAt` makes any
   * intervening write fail this one, and the retry re-merges against it.
   *
   * The last-write-wins snapshot fields (bookmark, attempts, suspended, score,
   * metadata…) are written only when this snapshot is at least as new as what
   * the row already reflects; a late, stale apply keeps just the monotonic
   * merges, which cannot regress anything.
   */
  private async writeScalars(
    current: ScormRegistration,
    payload: ScormCloudRegistrationProgress,
    snapshotFields: Prisma.ScormRegistrationUpdateInput,
    timing: {
      snapshotAt: Date;
      postbackReceivedAt?: Date;
      markApplied: boolean;
    },
  ): Promise<{ completionStatus: string; successStatus: string }> {
    const incomingCompletion = mapRegistrationCompletion(
      payload.registrationCompletion,
    );
    const incomingSuccess = mapRegistrationSuccess(payload.registrationSuccess);
    const scoreScaled =
      typeof payload.score?.scaled === 'number' ? payload.score.scaled : null;
    const totalTimeSeconds =
      typeof payload.totalSecondsTracked === 'number'
        ? payload.totalSecondsTracked
        : null;
    const firstAccess = toDate(payload.firstAccessDate);
    const lastAccess = toDate(payload.lastAccessDate);

    let row = current;
    for (let attempt = 1; ; attempt += 1) {
      const completionStatus = pickMonotonic(
        row.completionStatus,
        incomingCompletion,
        COMPLETION_RANK,
      );
      const successStatus = pickMonotonic(
        row.successStatus,
        incomingSuccess,
        SUCCESS_RANK,
      );
      const fresh = isSnapshotFresh(row, timing.snapshotAt);

      const data: Prisma.ScormRegistrationUpdateInput = {
        completionStatus,
        successStatus,
        ...(totalTimeSeconds != null
          ? {
              totalTimeSeconds: Math.max(
                totalTimeSeconds,
                row.totalTimeSeconds ?? totalTimeSeconds,
              ),
            }
          : {}),
        ...(firstAccess &&
        (!row.firstAccessAt || firstAccess < row.firstAccessAt)
          ? { firstAccessAt: firstAccess }
          : {}),
        ...(lastAccess && (!row.lastAccessAt || lastAccess > row.lastAccessAt)
          ? { lastAccessAt: lastAccess }
          : {}),
        ...(fresh
          ? {
              ...(scoreScaled != null ? { scoreScaled } : {}),
              ...snapshotFields,
              // Merged, not replaced: keys this pass does not produce — the
              // corroborated cpv a previous pass recorded, anything a later
              // writer adds — must survive an apply that early-returns before
              // re-deriving them.
              ...(snapshotFields.metadata !== undefined
                ? {
                    metadata: {
                      ...jsonObject(row.metadata),
                      ...jsonObject(snapshotFields.metadata),
                    } as Prisma.InputJsonValue,
                  }
                : {}),
            }
          : {}),
        // Only real postbacks move this; reconcile and pull-on-read never do,
        // or a pull would read as "a postback nobody pulled for".
        ...(timing.postbackReceivedAt
          ? {
              lastPostbackAt: maxDate(
                row.lastPostbackAt,
                timing.postbackReceivedAt,
              ),
            }
          : {}),
        // The ISSUE instant, never "now": a postback received after the pull
        // was issued is newer than anything the pull saw, so the row has to
        // stay dirty for it.
        ...(timing.markApplied
          ? {
              lastRuntimeAppliedAt: maxDate(
                row.lastRuntimeAppliedAt,
                timing.snapshotAt,
              ),
            }
          : {}),
      };

      try {
        await this.prisma.scormRegistration.update({
          where: { id: current.id, updatedAt: row.updatedAt },
          data,
        });
        return { completionStatus, successStatus };
      } catch (err) {
        const conflict =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2025';
        if (!conflict || attempt >= SCALAR_WRITE_ATTEMPTS) throw err;
        const reread = await this.prisma.scormRegistration.findUnique({
          where: { id: current.id },
        });
        // Gone, not raced: surface the original failure, as before.
        if (!reread) throw err;
        row = reread;
      }
    }
  }

  private async isStillCertified(row: {
    userId: string;
    courseId: string;
  }): Promise<boolean> {
    const completion = await this.prisma.courseCompletion.findUnique({
      where: {
        userId_courseId: { userId: row.userId, courseId: row.courseId },
      },
      select: { courseCompletedAt: true, isPassed: true },
    });
    return !!(completion?.courseCompletedAt && completion.isPassed);
  }

  /**
   * Turn a Cloud runtime record into native `UserCourseProgress` rows.
   *
   * This is the whole point of the lesson work: once the decoded completed-set
   * is written as ordinary progress rows against ordinary sections, the
   * percentage engine, the roster drill-down, the PDF report and the completion
   * gate all report SCORM progress correctly with no knowledge that SCORM
   * exists. Nothing downstream branches.
   *
   * Returns the scalar columns for the caller's single update. Writes the
   * progress rows itself, because those are additive and independent.
   *
   * ## Rules that are not negotiable
   *
   * - **Resolve indices against the registration's OWN package.** Lesson
   *   indices are package-scoped; resolving them against the course's newest
   *   package silently attributes progress to the wrong lessons. This is the
   *   single easiest way to corrupt the feature, so the manifest is read from
   *   `registration.packageId` and never from the course.
   * - **Absent data never nulls present data.** A COURSE-format payload carries
   *   no runtime at all. It must leave the bookmark, the lesson counters and
   *   the progress rows exactly as they were, or every such postback would
   *   erase what the last full pull filled in.
   * - **Additive only.** `skipDuplicates`, never a delete — matching native
   *   monotonic progress, and surviving a Rise re-attempt that resets
   *   suspendData.
   */
  private async applyLessonProgress(
    current: ScormRegistration,
    payload: ScormCloudRegistrationProgress,
    /**
     * This snapshot is at least as new as what the row reflects. A stale one
     * still unions its lessons (additive, so harmless) but must not move the
     * resume pointer back to where the learner was before.
     */
    fresh = true,
  ): Promise<Prisma.ScormRegistrationUpdateInput> {
    const extracted = extractRuntime(payload);
    if (!extracted) return {};

    // Scalars are safe to take from any detail level that supplies them.
    const update: Prisma.ScormRegistrationUpdateInput = {};
    if (extracted.attempts != null) update.attempts = extracted.attempts;
    if (extracted.suspended != null) update.suspended = extracted.suspended;
    if (extracted.completionAmount != null) {
      update.completionAmount = extracted.completionAmount;
    }
    // Cloud's access dates are min/max-merged in `writeScalars`, against the
    // row as it stands at write time rather than this pre-decode snapshot.

    // No runtime → ACTIVITY or COURSE detail. Everything below needs
    // suspendData, and writing nulls here would erase a good earlier pull.
    //
    // `metadata` is written INSIDE this guard for the same reason. A COURSE
    // postback still carries `activityDetails`, so storing it would replace the
    // richer snapshot a previous FULL pull left — the runtime block and
    // suspendDataBytes would flip in and out on alternating writes, which is
    // the same "absent nulls present" failure this method exists to avoid.
    if (!extracted.runtime) return update;
    const metadata = buildRegistrationMetadata(payload) as Record<
      string,
      unknown
    >;
    update.metadata = metadata as Prisma.InputJsonValue;

    // The verbatim string Cloud gave us — evidence, not an interpretation — so
    // it is recorded on every path below, including the binary fallbacks where
    // the derived lesson LABEL is cleared. Keeping it is what lets someone
    // reconstruct what the package actually reported when a decode failed.
    if (typeof extracted.runtime.location === 'string') {
      update.locationRaw = extracted.runtime.location;
    }

    const pkg = await this.prisma.scormPackage.findUnique({
      where: { id: current.packageId },
      select: { id: true, lessons: true, riseCpv: true, riseProbeJson: true },
    });
    const lessons = parsePackageLessons(pkg?.lessons);
    if (lessons.length === 0) {
      // Single-section package: nothing to resolve indices against.
      update.progressSource = 'binary';
      return clearLessonLabel(update, current);
    }

    const decoded = parseRiseSuspendData(extracted.runtime.suspendData);
    // The access gate, evaluated at most once per call and shared by every
    // curriculum write below (the resume pointer as well as the progress rows).
    // The Cloud SNAPSHOT above is deliberately outside it: recording what the
    // package reported is not the same as granting the learner progress.
    let canRecordCache: boolean | null = null;
    const canRecord = async (): Promise<boolean> => {
      if (canRecordCache === null) {
        canRecordCache = await this.canRecordProgress(current);
      }
      return canRecordCache;
    };

    // Rise's content-package fingerprint. If it changes, the index space no
    // longer describes the manifest these sections were built from, so the
    // decoded indices would land on the wrong lessons. Refuse rather than
    // guess; the scalars above are still safe to keep.
    //
    // Checked BEFORE the bookmark is resolved. The lesson label is read out of
    // the same stale manifest, so writing it first would persist exactly the
    // "Lesson 6 of 14" misattribution this guard exists to prevent.
    if (decoded?.cpv && pkg?.riseCpv && decoded.cpv !== pkg.riseCpv) {
      this.logger.warn(
        `Registration ${current.id}: suspendData cpv ${decoded.cpv} does not match package ${pkg.id} cpv ${pkg.riseCpv} — skipping lesson progress`,
      );
      update.progressSource = 'binary';
      return clearLessonLabel(update, current);
    }

    // The bookmark. A label for "Lesson 6 of 14", never a numerator (§1.4):
    // measured live, the bookmark sat at index 5 while {0,1,4} were complete.
    //
    // Resolved by lesson ID, independent of suspendData, so it stands even
    // when the blob below cannot be decoded or its index space is unverified —
    // clearing a bookmark we can read just because a different field failed
    // would throw away the one position signal we still trust.
    const bookmark = resolveRiseLesson(extracted.runtime.location, lessons);
    if (bookmark) {
      update.lessonId = bookmark.lessonId;
      // 1-based, to read as "Lesson 6 of 14". Everything else in this feature
      // is 0-based — see the schema comment; `lessonId` is what joins back to
      // the manifest without arithmetic.
      update.lessonIndex = bookmark.lessonIndex + 1;
      update.lessonTitle = bookmark.lessonTitle;

      // Point "continue where you left off" at the lesson the learner is
      // actually on. `upsertLastSeen` runs at LAUNCH and can only know the
      // section it launched (lesson 1), and LastSeenSection is unique per
      // (userId, chapterId) — which all N lesson sections share — so without
      // this the resume link is permanently lesson 1.
      //
      // Only when the bookmark MOVED. Rise re-commits the same location on
      // every block, and the pointer cannot have changed if the lesson has
      // not — that would be a section lookup plus an upsert per pull for
      // nothing. (The launch path's stale-pointer repair is the one writer
      // that can move it otherwise, and it only fires for a dead section.)
      const bookmarkLesson = lessons.find(
        (l) => l.index === bookmark.lessonIndex,
      );
      // Gated: the resume pointer is learner curriculum state, so a revoked or
      // soft-deleted learner with an open Rise tab must not keep moving it.
      if (
        fresh &&
        bookmark.lessonId !== current.lessonId &&
        bookmarkLesson?.sectionId &&
        (await canRecord())
      ) {
        await this.updateLastSeenLesson(current, bookmarkLesson.sectionId);
      }
    }

    if (!decoded) {
      // Undocumented format we could not read. Degrade to the package's own
      // 0/100 verdict — exactly the behaviour that existed before this work.
      // Logged, because a Rise format change would otherwise present only as
      // every learner quietly sitting at 0 lessons.
      this.warnUndecodableSuspendData(
        current.id,
        extracted.runtime.suspendData,
      );
      update.progressSource = 'binary';
      return bookmark
        ? keepSourceIfDecoded(update, current)
        : clearLessonLabel(update, current);
    }

    // A manifest where the suspendData index space could be read two ways (a
    // soft-deleted lesson, a divider, `position` out of array order) — see
    // `extractRiseLessons`. Nobody has verified which reading Rise uses, so
    // applying indices here would be a guess that misattributes every lesson
    // after the divergence. Binary until an admin sets
    // `riseProbeJson.riseIndexSpaceVerified` after checking a real decode
    // (`yarn script:backfill-scorm-lessons --verify-index-space=<packageId>`).
    const indexSpaceRisk = unverifiedIndexSpaceRisk(pkg?.riseProbeJson);
    if (indexSpaceRisk) {
      update.progressSource = 'binary';
      return bookmark
        ? keepSourceIfDecoded(update, current)
        : clearLessonLabel(update, current);
    }

    // Seeding the fingerprint. Once set, it rejects every blob that disagrees,
    // so a wrong seed permanently degrades every other learner on the package
    // to binary — and the blob is learner-controlled. Two defences:
    //
    // 1. The blob must corroborate the manifest. `every` is vacuously true on
    //    an empty array, and a learner who has completed nothing is the MOST
    //    likely first postback, so demand positive evidence: at least one
    //    decoded index, all of which the manifest has, or a bookmark that
    //    resolves to a real lesson.
    // 2. One learner is not enough. The corroborated cpv is recorded on this
    //    registration's metadata, and the package is seeded only once a SECOND,
    //    distinct registration (one per learner per package, by the unique)
    //    has corroborated the same value. Staying unseeded costs nothing:
    //    decoding continues meanwhile.
    //
    // Known limit: one person holding two learner accounts on the package can
    // still forge a seed. Closing that needs a trusted cpv source (the package
    // itself), not more corroboration; an admin can clear `riseCpv` to reset.
    //
    // The count runs only when this registration's corroborated cpv is new or
    // changed. Once recorded, a SECOND registration's first corroboration is
    // what finds it and seeds — re-counting here on every pull would add a
    // JSON-path scan per commit for nothing. (Two registrations corroborating
    // in the same instant can each miss the other; a third then seeds.)
    if (decoded.cpv && !pkg?.riseCpv) {
      const indicesCorroborate =
        decoded.completedIndices.length > 0 &&
        decoded.completedIndices.every((index) =>
          lessons.some((l) => l.index === index),
        );
      if (indicesCorroborate || bookmark !== null) {
        metadata[CORROBORATED_CPV_KEY] = decoded.cpv;
        if (
          jsonObject(current.metadata)[CORROBORATED_CPV_KEY] !== decoded.cpv
        ) {
          await this.maybeSeedPackageCpv(current, decoded.cpv);
        }
      }
    }

    update.progressSource = 'suspend-data';

    // Union with what we have already applied, never a replacement. Postbacks
    // are unordered and retried, and a Rise re-attempt resets suspendData —
    // progress rows are additive so they survive that, and the recorded set has
    // to as well or the learner's count visibly walks backwards.
    const byIndex = new Map(lessons.map((l) => [l.index, l]));

    // Keep only indices this package's manifest actually has. A re-authored
    // Rise package can report an index beyond our lesson list, and counting it
    // would produce "20 of 14" — the count, the stored set and the progress
    // rows all have to describe the same lessons. The cpv guard above catches
    // most of these, but it needs a fingerprint on BOTH sides to fire.
    const known = new Set(current.lessonsCompletedIndices ?? []);
    const merged = Array.from(new Set([...known, ...decoded.completedIndices]))
      .filter((index) => byIndex.has(index))
      .sort((a, b) => a - b);

    // Skip the write only when the SET is unchanged — comparing sizes would
    // drop a re-attempt that completed a DIFFERENT set of the same cardinality
    // (say {0,1,4} → {2,3,5}), which reads as "nothing new" while three lessons
    // go unrecorded.
    const knownInManifest = Array.from(known).filter((i) => byIndex.has(i));
    if (merged.length === knownInManifest.length) {
      // Chapter/module completion is stamped alongside the rows below, but that
      // call is best-effort — if it threw, the indices were still recorded and
      // this branch would short-circuit every later attempt, leaving the
      // learner at N/N sections under a chapter marked incomplete.
      //
      // Retried here, but only when they hold every lesson: that is the sole
      // state in which the chapter could newly complete, so a part-way pull
      // pays nothing. `isChapterComplete` gates the helper, so a repeat is a
      // no-op.
      if (
        lessons.length > 0 &&
        knownInManifest.length === lessons.length &&
        (await canRecord())
      ) {
        const anySection = lessons.find((l) => l.sectionId);
        if (anySection) {
          await this.stampChapterCompletion(current, anySection.sectionId);
        }
      }
      // Nothing new to apply, but the counter still has to be consistent with
      // the stored set — including the first decode of a learner who has
      // completed nothing, where it must read 0 rather than "never looked".
      //
      // Done through the same atomic statement rather than the scalar update:
      // `current` was read before the Cloud call, so any value derived from it
      // here (even behind a `== null` check, which is itself stale) could lower
      // what a concurrent pass just raised — and a certify landing in that
      // window would snapshot the regressed figure into the write-once
      // `lessonsCompletedAtCertify`.
      await this.applyLessonIndices(
        current.id,
        [],
        lessons.map((l) => l.index),
      );
      return update;
    }

    const rows = merged
      .map((index) => byIndex.get(index))
      .filter((l): l is PackageLesson => !!l?.sectionId);

    const sections = rows.length
      ? await this.prisma.section.findMany({
          where: { id: { in: rows.map((l) => l.sectionId) } },
          select: {
            id: true,
            chapterId: true,
            moduleId: true,
            chapter: { select: { moduleId: true } },
          },
        })
      : [];
    const sectionById = new Map(sections.map((s) => [s.id, s]));

    // Build rows and the applied-index list TOGETHER, so the two can never
    // disagree. A lesson that cannot be written — no Section row, or no chapter
    // to hang it off — must not be recorded as applied: the skip guard above
    // would then short-circuit every later postback and that lesson would never
    // get a row. `moduleId` falls back through the chapter for the same reason
    // stampCompletionDenominator does: Section.moduleId is nullable while
    // UserCourseProgress.moduleId is not.
    const data: Array<{
      userId: string;
      courseId: string;
      chapterId: string;
      moduleId: string;
      sectionId: string;
    }> = [];
    const appliedIndices: number[] = [];

    for (const lesson of rows) {
      const section = sectionById.get(lesson.sectionId);
      const moduleId = section?.moduleId ?? section?.chapter?.moduleId ?? null;
      if (!section?.chapterId || !moduleId) continue;
      data.push({
        userId: current.userId,
        courseId: current.courseId,
        chapterId: section.chapterId,
        moduleId,
        sectionId: section.id,
      });
      appliedIndices.push(lesson.index);
    }

    if (data.length === 0) {
      // Could not write anything, so nothing is applied and nothing is
      // recorded — leave the counter alone too, or `Math.max` would freeze a
      // figure that no progress row backs and that never self-corrects.
      //
      // Logged here rather than only in the partial case below, which this
      // early return would otherwise skip — total failure is the one most worth
      // hearing about.
      if (rows.length > 0) {
        this.logger.warn(
          `Registration ${current.id}: none of ${rows.length} decoded lesson(s) resolved to a writable section; they stay unapplied and will be retried on the next pull.`,
        );
      }
      return update;
    }

    // Progress rows are learner curriculum state, so they need the same access
    // gate the certify path applies. Cloud keeps posting back for a learner
    // whose enrolment was revoked or whose access expired — without this, an
    // open Rise tab would keep re-creating rows for a course they can no longer
    // reach. The Cloud SNAPSHOT above is still recorded either way: that is a
    // faithful record of what the package reported, not a grant of progress.
    if (!(await canRecord())) {
      return update;
    }

    await this.prisma.userCourseProgress.createMany({
      data,
      skipDuplicates: true,
    });

    // Every lesson section shares one chapter, so this is a single call.
    await this.stampChapterCompletion(
      current,
      data[0].sectionId,
      data[0].chapterId,
    );

    if (data.length < rows.length) {
      this.logger.warn(
        `Registration ${current.id}: ${
          rows.length - data.length
        } decoded lesson(s) ` +
          `could not be written (section missing or has no chapter); they stay ` +
          `unapplied and will be retried on the next pull.`,
      );
    }

    // Recorded only now, and only for what actually landed. Writing `merged`
    // here instead would mark the skipped lessons applied and stop any later
    // postback retrying them — a learner stuck below their real progress with a
    // column claiming otherwise. Reachable via the backfill, which re-points a
    // package at new section ids.
    //
    // Unioned in SQL rather than in JS. `current` was read before the Cloud
    // call, so computing the new set from it and writing `{ set: … }` is a
    // read-modify-write: an overlapping reconcile pass or second postback would
    // be clobbered and the "monotonic" counter could regress (5 → 4) until some
    // later decode happened to produce a superset. Doing the union in the
    // UPDATE makes it atomic against whatever the row actually holds now, so
    // concurrent writers compose instead of racing.
    // `lessonsCompleted` is derived inside this statement too, so it is never
    // written from the stale snapshot on this path.
    await this.applyLessonIndices(
      current.id,
      appliedIndices,
      lessons.map((l) => l.index),
    );

    return update;
  }

  /**
   * Seed `ScormPackage.riseCpv` once two distinct registrations agree.
   *
   * The count excludes this registration, whose own marker is only written by
   * the caller's update after this returns — so "≥ 1 other" is "≥ 2 total".
   * Conditional on the column still being null, so a concurrent seed (or one
   * an admin just cleared and another pass re-made) is never overwritten.
   *
   * Best-effort: failing to seed only means trying again on the next pull, so
   * it must not take the rest of the lesson update down with it.
   */
  private async maybeSeedPackageCpv(
    current: { id: string; packageId: string },
    cpv: string,
  ): Promise<void> {
    try {
      const others = await this.prisma.scormRegistration.count({
        where: {
          packageId: current.packageId,
          id: { not: current.id },
          metadata: { path: [CORROBORATED_CPV_KEY], equals: cpv },
        },
      });
      if (others < 1) return;
      await this.prisma.scormPackage.updateMany({
        where: { id: current.packageId, riseCpv: null },
        data: { riseCpv: cpv },
      });
    } catch (err) {
      this.logger.warn(
        `Could not seed the Rise fingerprint for package ${
          current.packageId
        }: ${errorMessage(err)}`,
      );
    }
  }

  /**
   * Say so when a non-empty suspendData blob cannot be decoded.
   *
   * Deduped per (registration, version) within this instance: Rise
   * re-commits on every block, and an unreadable format would otherwise log
   * once per pull per learner. Not keyed on length — the blob grows with every
   * commit, which would make the dedupe a no-op. The cache is bounded and per-process, which on
   * serverless means "at most once per cold start" — enough to be noticed.
   */
  private warnUndecodableSuspendData(
    registrationId: string,
    raw: unknown,
  ): void {
    // Absent or empty is a learner Rise has not written state for yet — normal,
    // and not what this warning is for.
    if (typeof raw !== 'string' || raw.trim().length === 0) return;
    let version: unknown = 'unparseable';
    try {
      const envelope = JSON.parse(raw) as unknown;
      if (
        envelope &&
        typeof envelope === 'object' &&
        !Array.isArray(envelope)
      ) {
        version = (envelope as Record<string, unknown>).v;
      }
    } catch {
      // Keep 'unparseable'.
    }
    const key = `${registrationId}:${String(version)}`;
    if (this.undecodableSeen.has(key)) return;
    if (this.undecodableSeen.size >= UNDECODABLE_WARN_CACHE) {
      this.undecodableSeen.clear();
    }
    this.undecodableSeen.add(key);
    this.logger.warn(
      `Registration ${registrationId}: suspendData could not be decoded ` +
        `(v=${JSON.stringify(version) ?? 'undefined'}, ${
          raw.length
        } bytes) — falling back to binary progress`,
    );
  }

  /**
   * Stamp chapter/module completion for the chapter holding the lesson tree.
   *
   * The native section-complete path does this alongside the progress row, and
   * the roster drill-down and PDF report read those rows — without it a learner
   * who finished every lesson but has not yet satisfied `completeOn` shows all
   * sections done under a chapter still marked incomplete.
   *
   * Best-effort: a bookkeeping failure must never fail a postback. The helper
   * is internally gated by `isChapterComplete`, so calling it for a part-way
   * learner is a no-op rather than a false completion — which is what makes it
   * safe to retry from the unchanged-set path.
   */
  private async stampChapterCompletion(
    row: { id: string; userId: string; courseId: string },
    sectionId: string,
    knownChapterId?: string,
  ): Promise<void> {
    try {
      let chapterId = knownChapterId;
      if (!chapterId) {
        const section = await this.prisma.section.findUnique({
          where: { id: sectionId },
          select: { chapterId: true },
        });
        chapterId = section?.chapterId ?? undefined;
      }
      if (!chapterId) return;

      await recordChapterAndModuleCompletionIfNeeded(
        this.prisma,
        row.userId,
        chapterId,
        { courseId: row.courseId },
      );
    } catch (err) {
      this.logger.warn(
        `Chapter/module completion bookkeeping failed for registration ${
          row.id
        }: ${errorMessage(err)}`,
      );
    }
  }

  /**
   * Whether the learner's stored resume pointer still names a live section.
   *
   * A package replace and the backfill both archive the section the pointer
   * holds while leaving the row itself intact — it is unique per
   * (userId, chapterId) and the replacement reuses the chapter. Only the launch
   * path can repair that, and it must not otherwise rewind a bookmark the
   * progress path has already moved forward.
   *
   * Errs toward repairing: if this cannot be determined, a correct-but-rewound
   * pointer is better than one aimed at content that no longer exists.
   */
  private async lastSeenPointerIsStale(
    userId: string,
    chapterId: string,
  ): Promise<boolean> {
    try {
      const existing = await this.prisma.lastSeenSection.findUnique({
        where: { userId_chapterId: { userId, chapterId } },
        select: { sectionId: true },
      });
      if (!existing?.sectionId) return true;

      const section = await this.prisma.section.findUnique({
        where: { id: existing.sectionId },
        select: { isActive: true, isArchived: true },
      });
      return !section || section.isArchived || !section.isActive;
    } catch {
      return true;
    }
  }

  /**
   * Move the learner's resume pointer to the lesson section they are on.
   *
   * Best-effort: the section may have been archived by a package replace
   * between the pull and this write, and a stale resume pointer must never fail
   * a postback.
   */
  private async updateLastSeenLesson(
    row: { id: string; userId: string; courseId: string },
    sectionId: string,
  ): Promise<void> {
    try {
      const section = await this.prisma.section.findUnique({
        where: { id: sectionId },
        select: {
          chapterId: true,
          moduleId: true,
          chapter: { select: { moduleId: true } },
        },
      });
      const moduleId = section?.moduleId ?? section?.chapter?.moduleId ?? null;
      if (!section?.chapterId || !moduleId) return;

      await this.prisma.lastSeenSection.upsert({
        where: {
          userId_chapterId: {
            userId: row.userId,
            chapterId: section.chapterId,
          },
        },
        update: { sectionId },
        create: {
          userId: row.userId,
          chapterId: section.chapterId,
          sectionId,
          moduleId,
          courseId: row.courseId,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Could not move the resume pointer for registration ${
          row.id
        }: ${errorMessage(err)}`,
      );
    }
  }

  /**
   * Whether this learner may still accrue curriculum progress on this course.
   *
   * Mirrors the checks `runCompletionBridge` already makes before certifying —
   * usable enrolment and a published course — so the two paths cannot disagree
   * about who is allowed to gain progress. Failures are treated as "no": this
   * runs on the postback path, where throwing means a 5xx and an indefinite
   * Cloud retry.
   */
  private async canRecordProgress(
    row: {
      id: string;
      userId: string;
      courseId: string;
    },
    purpose = 'lesson progress',
  ): Promise<boolean> {
    try {
      // A soft-deleted account keeps its enrolment row, and the reconcile cron
      // does not exclude it — so without this a deleted learner would keep
      // accruing progress and chapter completion rows on every pass while the
      // certify path refused them. Same check, same order as the bridge.
      const [user, course] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: row.userId },
          select: { deletedAt: true },
        }),
        this.prisma.course.findUnique({
          where: { id: row.courseId },
          select: { isActive: true },
        }),
      ]);
      if (!user || user.deletedAt) return false;
      if (!course?.isActive) return false;

      await assertEnrollmentUsable(
        this.prisma,
        row.userId,
        row.courseId,
        Role.user,
      );
      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) {
        this.logger.warn(
          `Skipping SCORM ${purpose} for registration ${
            row.id
          }: enrolment not usable (${errorMessage(err)})`,
        );
        return false;
      }
      this.logger.warn(
        `Skipping SCORM ${purpose} for registration ${row.id}: ${errorMessage(
          err,
        )}`,
      );
      return false;
    }
  }

  /**
   * Atomically union `indices` into `lessonsCompletedIndices` and re-derive
   * `lessonsCompleted` from the result, inside one statement.
   *
   * Kept out of the caller's update object precisely so it is NOT part of a
   * last-write-wins scalar write — this is the one field where two concurrent
   * writers must compose rather than overwrite.
   */
  private async applyLessonIndices(
    registrationId: string,
    indices: number[],
    validIndices: number[],
  ): Promise<void> {
    // An empty `indices` is a normalise, not a no-op: it re-derives
    // `lessonsCompleted` from whatever set the row holds — filtered to the
    // current manifest — which is how a first decode with zero completions gets
    // a 0 instead of staying null, and how a set left over from a previous
    // manifest gets trimmed.
    //
    // The union reads the target row's OWN column in the SET expression rather
    // than through a self-join subquery. Postgres re-evaluates SET expressions
    // against the re-fetched row under EvalPlanQual when a concurrent UPDATE
    // unblocks this one, but it does NOT re-evaluate a `FROM (SELECT …)`
    // subplan — so the subquery form would let the second writer union against
    // a snapshot taken before it waited, silently dropping the first writer's
    // indices.
    // The `= ANY(validIndices)` filter applies to the ALREADY-STORED indices
    // too, not just the incoming ones. Without it a set written against a
    // previous manifest survives the union and `cardinality` counts it, so
    // `lessonsCompleted` could exceed `lessonCount` — the "20 of 14" the JS
    // filter prevents for new indices but cannot reach for old ones.
    //
    // The count is the cardinality of that filtered set and nothing else — no
    // GREATEST against the stored figure. Monotonicity already comes from the
    // set (a union only grows within the valid indices); a GREATEST on top
    // could never come DOWN, so a count once inflated by stale indices would
    // stay above both the set it describes and `lessonCount` forever.
    // Arrays are emitted as explicit `ARRAY[...]::int[]` literals rather than
    // bound parameters. Prisma cannot infer an element type for an EMPTY JS
    // array, so `${[]}::int[]` can go to Postgres as `text[]` and be rejected —
    // and this call sits inside applyLessonProgress's catch, so the throw would
    // silently discard the whole update (bookmark, scalars, metadata) on the
    // common "nothing new decoded" path, which passes exactly that empty array.
    const incoming = intArrayLiteral(indices);
    const valid = intArrayLiteral(validIndices);
    const mergedSet = Prisma.sql`
      SELECT DISTINCT i
        FROM unnest(
               COALESCE(sr."lessonsCompletedIndices", ARRAY[]::int[]) || ${incoming}
             ) AS i
       WHERE i = ANY(${valid})
    `;

    // Passed as a single Prisma.Sql rather than a tagged template so the
    // composed statement is one inspectable object — the array literals are
    // embedded in `.sql`, which is what makes this assertable in tests.
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "scorm_registrations" sr
         SET "lessonsCompletedIndices" = ARRAY(${mergedSet} ORDER BY 1),
             "lessonsCompleted" = cardinality(ARRAY(${mergedSet}))
       WHERE sr."id" = ${registrationId}
    `);
  }

  private async runCompletionBridge(row: {
    id: string;
    userId: string;
    courseId: string;
    packageId: string;
    sectionId: string;
    completeOn: string;
    completionStatus: string;
    successStatus: string;
  }): Promise<CertifyOutcome> {
    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      this.logger.warn(
        `Skipping SCORM certify for registration ${row.id}: user missing or deleted`,
      );
      return 'skipped';
    }

    try {
      await assertEnrollmentUsable(
        this.prisma,
        row.userId,
        row.courseId,
        Role.user,
      );
    } catch (err) {
      if (err instanceof ForbiddenException) {
        this.logger.warn(
          `Skipping SCORM certify for registration ${
            row.id
          }: enrolment not usable (${errorMessage(err)})`,
        );
        return 'skipped';
      }
      throw err;
    }

    const course = await this.prisma.course.findUnique({
      where: { id: row.courseId },
      select: { isActive: true },
    });
    if (!course?.isActive) {
      this.logger.warn(
        `Skipping SCORM certify for registration ${row.id}: course is not published`,
      );
      return 'skipped';
    }

    const pkg = await this.prisma.scormPackage.findUnique({
      where: { id: row.packageId },
      select: { sectionId: true },
    });
    let sectionId = pkg?.sectionId ?? row.sectionId;
    if (!sectionId) {
      this.logger.warn(
        `Skipping SCORM certify for registration ${row.id}: package has no section`,
      );
      return 'retry';
    }
    if (pkg?.sectionId && pkg.sectionId !== row.sectionId) {
      await this.prisma.scormRegistration.update({
        where: { id: row.id },
        data: { sectionId: pkg.sectionId },
      });
      sectionId = pkg.sectionId;
    }

    const certifySection = await this.resolveCertifySection({
      registrationId: row.id,
      userId: row.userId,
      courseId: row.courseId,
      sectionId,
    });
    if (!certifySection) {
      this.logger.warn(
        `Skipping SCORM certify for registration ${row.id}: could not resolve a certify section`,
      );
      return 'retry';
    }

    // ── Stamp exactly the gate's own denominator ────────────────────────────
    //
    // With one section per lesson, stamping a single section can no longer
    // satisfy `progressed.length < totalSections`: a learner whom Cloud reports
    // complete but who has 3 of 14 lessons decoded would never certify. So the
    // bridge asks the SAME function the gate asks — `countCompletionDenominator`
    // — and stamps precisely the section ids it returns. The stamped set IS the
    // counted set, so the check cannot fail.
    //
    // It also subsumes `resolveCertifySection`'s archived-section remapping,
    // which already resolves pinned vs live correctly.
    //
    // This is honest rather than a fudge: SCORM completion is the package's
    // verdict (`completeWith: "quiz"`), not our per-lesson tracking, and the
    // previous code already stamped one section regardless of what the learner
    // had read. This preserves that semantic at N sections.
    await this.stampCompletionDenominator(row, certifySection);

    await this.courseCompletion.checkContentCompletion(
      row.userId,
      row.courseId,
    );

    let completion = await this.prisma.courseCompletion.findUnique({
      where: {
        userId_courseId: { userId: row.userId, courseId: row.courseId },
      },
      select: { courseCompletedAt: true, isPassed: true },
    });
    if (!completion?.courseCompletedAt) {
      return 'retry';
    }

    // completeOn "completed" certifies on completion status only (not SCORM success).
    const certifyPassed =
      row.completeOn === 'passed'
        ? row.successStatus === 'passed'
        : row.completionStatus === 'completed';

    if (certifyPassed && !completion.isPassed) {
      await this.prisma.courseCompletion.update({
        where: {
          userId_courseId: { userId: row.userId, courseId: row.courseId },
        },
        data: {
          isPassed: true,
          assessmentPassedAt: new Date(),
        },
      });
      completion = await this.prisma.courseCompletion.findUnique({
        where: {
          userId_courseId: { userId: row.userId, courseId: row.courseId },
        },
        select: { courseCompletedAt: true, isPassed: true },
      });
    }

    await recordChapterAndModuleCompletionIfNeeded(
      this.prisma,
      row.userId,
      certifySection.chapterId,
      { courseId: row.courseId },
    );

    const done = !!(completion?.courseCompletedAt && completion.isPassed);
    if (done) {
      // First certification wins. A retry or a re-run must not move the date a
      // learner was certified on.
      await this.prisma.scormRegistration.updateMany({
        where: { id: row.id, completedAt: null },
        data: { completedAt: new Date() },
      });
    }
    return done ? 'done' : 'retry';
  }

  /**
   * Write a progress row for every section in the learner's curriculum.
   *
   * Before this, certification stamped one section — fine when a package
   * produced exactly one. With a lesson tree it is the difference between
   * certifying and deadlocking, so the set comes from the gate's own
   * `countCompletionDenominator` rather than from anything this file computes.
   *
   * Two things this deliberately preserves:
   *
   * - **`lessonsCompletedAtCertify`** is snapshotted FIRST. Progress rows are
   *   additive with no marker distinguishing "the learner read this" from "the
   *   bridge stamped it", so after this runs the real per-lesson figure is
   *   unrecoverable from the rows. Anyone asking "how much did they actually
   *   read" reads this column.
   * - **Idempotence.** `skipDuplicates` plus the once-only snapshot means a
   *   Cloud retry (which happens, since incomplete certification returns 5xx)
   *   re-stamps nothing and does not overwrite the snapshot with the
   *   post-stamp count.
   */
  private async stampCompletionDenominator(
    row: { id: string; userId: string; courseId: string },
    fallback: { sectionId: string; chapterId: string; moduleId: string },
  ): Promise<void> {
    const registration = await this.prisma.scormRegistration.findUnique({
      where: { id: row.id },
      select: { lessonsCompleted: true, lessonsCompletedAtCertify: true },
    });
    // Only snapshot once we actually have a figure, so null means "lesson data
    // was never decoded for this learner" and 0 means "decoded, and they had
    // completed nothing". Writing 0 for the former would assert something we do
    // not know.
    //
    // Be clear about the limit: once certification succeeds, `reconcileCron`
    // stops selecting this registration and a finished learner sends no more
    // postbacks, so a null here is usually permanent. That is the honest
    // outcome of a failed terminal pull — the alternative is a fabricated
    // number on the one column that exists to record what really happened.
    //
    // Conditional on the column still being null IN the write, not just in the
    // read above: two overlapping bridge runs (a Cloud retry racing the
    // reconcile) would otherwise both pass the check, and the second could
    // overwrite the snapshot with a figure taken after the first's stamp.
    if (
      registration &&
      registration.lessonsCompletedAtCertify == null &&
      registration.lessonsCompleted != null
    ) {
      await this.prisma.scormRegistration.updateMany({
        where: { id: row.id, lessonsCompletedAtCertify: null },
        data: {
          lessonsCompletedAtCertify: registration.lessonsCompleted,
        },
      });
    }

    const { liveSectionIds } =
      await this.courseVersionService.countCompletionDenominator(
        row.userId,
        row.courseId,
      );

    // Degenerate curriculum (no live sections resolvable) — fall back to the
    // single section we resolved, which is the pre-lesson behaviour.
    if (liveSectionIds.length === 0) {
      await this.prisma.userCourseProgress.createMany({
        data: [
          {
            userId: row.userId,
            courseId: row.courseId,
            chapterId: fallback.chapterId,
            moduleId: fallback.moduleId,
            sectionId: fallback.sectionId,
          },
        ],
        skipDuplicates: true,
      });
      return;
    }

    // chapterId/moduleId are columns on UserCourseProgress, so each section's
    // parents have to travel with it.
    //
    // `Section.moduleId` is nullable while `UserCourseProgress.moduleId` is
    // not, so a section with a null moduleId cannot be stamped as-is. Dropping
    // it silently would stamp FEWER sections than the gate counts, and
    // `progressed.length < totalSections` would then never clear — a permanent
    // 500-retry loop for a learner Cloud already considers complete. Resolve it
    // through the chapter instead, and fall back to the certify section's
    // module, so every counted section gets a row.
    const sections = await this.prisma.section.findMany({
      where: { id: { in: liveSectionIds } },
      select: {
        id: true,
        chapterId: true,
        moduleId: true,
        chapter: { select: { moduleId: true } },
      },
    });

    const data = sections
      .filter((s) => !!s.chapterId)
      .map((s) => ({
        userId: row.userId,
        courseId: row.courseId,
        chapterId: s.chapterId,
        moduleId: s.moduleId ?? s.chapter?.moduleId ?? fallback.moduleId,
        sectionId: s.id,
      }));

    if (data.length > 0) {
      await this.prisma.userCourseProgress.createMany({
        data,
        skipDuplicates: true,
      });
    }

    // The gate counts `liveSectionIds`; we can only stamp ids that resolve to a
    // real Section row with a chapter. If those sets differ the learner cannot
    // certify no matter how many times Cloud retries, so say so loudly rather
    // than letting it present as an intermittent 500.
    //
    // Checked AFTER the write and without an early return, because the worst
    // case — nothing resolvable at all — is exactly the one that used to fall
    // out above and log nothing.
    if (data.length < liveSectionIds.length) {
      const stamped = new Set(data.map((d) => d.sectionId));
      const missing = liveSectionIds.filter((id) => !stamped.has(id));
      this.logger.error(
        `Certify stamp is short for registration ${row.id}: the completion gate counts ` +
          `${liveSectionIds.length} sections but only ${data.length} could be stamped. ` +
          `Unresolvable section ids: ${missing.slice(0, 10).join(', ')}. ` +
          `This learner cannot complete until the curriculum is repaired.`,
      );
    }
  }

  /**
   * Resolve which section row to stamp for certification. When a superseded
   * package's section is archived, pinned learners keep it; unpinned floaters
   * remap to the live SCORM section so checkContentCompletion's denominator matches.
   */
  private async resolveCertifySection(args: {
    registrationId: string;
    userId: string;
    courseId: string;
    sectionId: string;
  }): Promise<{
    sectionId: string;
    chapterId: string;
    moduleId: string;
  } | null> {
    const section = await this.prisma.section.findUnique({
      where: { id: args.sectionId },
      select: { id: true, chapterId: true, moduleId: true, isArchived: true },
    });
    if (!section?.chapterId || !section.moduleId) {
      return null;
    }

    if (!section.isArchived) {
      return {
        sectionId: section.id,
        chapterId: section.chapterId,
        moduleId: section.moduleId,
      };
    }

    const enrollment = await this.prisma.userCourse.findFirst({
      where: { userId: args.userId, courseId: args.courseId },
      select: { enrolledVersionId: true },
    });
    if (enrollment?.enrolledVersionId) {
      return {
        sectionId: section.id,
        chapterId: section.chapterId,
        moduleId: section.moduleId,
      };
    }

    const live = await this.prisma.section.findFirst({
      where: {
        type: SectionType.SCORM,
        isArchived: false,
        chapter: {
          isArchived: false,
          module: { courseId: args.courseId, isArchived: false },
        },
      },
      // Deterministic: a lesson tree has N live SCORM sections and an
      // unordered findFirst would pick an arbitrary one per call, so the same
      // learner could be remapped to a different section on each retry.
      orderBy: { orderIndex: 'asc' },
      select: { id: true, chapterId: true, moduleId: true },
    });
    if (!live?.chapterId || !live.moduleId) {
      return null;
    }

    await this.prisma.scormRegistration.update({
      where: { id: args.registrationId },
      data: { sectionId: live.id },
    });

    return {
      sectionId: live.id,
      chapterId: live.chapterId,
      moduleId: live.moduleId,
    };
  }

  private async canPruneSupersededPackage(pkg: {
    id: string;
    courseId: string;
    sectionId: string | null;
    lessons?: Prisma.JsonValue | null;
    chapterId?: string | null;
  }): Promise<boolean> {
    if (!pkg.sectionId) return false;

    const inProgress = await this.prisma.scormRegistration.count({
      where: {
        packageId: pkg.id,
        completedAt: null,
        OR: [
          { firstLaunchAt: { not: null } },
          { lastPostbackAt: { not: null } },
        ],
      },
    });
    if (inProgress > 0) return false;

    const versions = await this.prisma.courseVersion.findMany({
      where: { courseId: pkg.courseId, status: 'PUBLISHED' },
      select: { id: true, manifest: true },
    });
    // Every section this package owns, not just `pkg.sectionId`. A package with
    // a lesson manifest owns N sections and `sectionId` names only the first, so
    // a single-id test would miss a version that pins the other N-1 — and the
    // backfill re-points `sectionId` to an id no pre-backfill manifest contains,
    // which would make it miss every version.
    // Every section this package produced, resolved from the ownership link the
    // sections themselves carry: `config.packageId`, written on each one at
    // import and preserved by the backfill.
    //
    // Two shapes this has to catch that a simpler test does not:
    //  - N lesson sections, where `pkg.sectionId` names only the first;
    //  - the ARCHIVED synthetic section a backfilled package used to have.
    //    The backfill overwrites `sectionId` and `lessons` with the new ids, so
    //    a version manifest published BEFORE the backfill references an id
    //    neither field mentions any more — and a learner pinned to it would
    //    not block the prune.
    //
    // Deliberately not "every SCORM section in `pkg.chapterId`" either: the
    // replacement package reuses the chapter, so that would make a superseded
    // package own the live one's sections and nothing would ever be prunable.
    const ownedSections = await this.prisma.section.findMany({
      where: {
        type: SectionType.SCORM,
        config: { path: ['packageId'], equals: pkg.id },
      },
      select: { id: true },
    });
    const ownedSectionIds = new Set<string>([pkg.sectionId]);
    for (const section of ownedSections) ownedSectionIds.add(section.id);
    for (const lesson of parsePackageLessons(pkg.lessons)) {
      ownedSectionIds.add(lesson.sectionId);
    }

    for (const version of versions) {
      // Manifest chapters carry `sectionIds: string[]`. This used to read
      // `chapter.sections[].id`, a shape the manifest has never had — so the id
      // set was always empty, every version was skipped, and this guard has
      // been silently passing every package straight through to deletion.
      const manifest = version.manifest as Record<string, unknown> | null;
      const modules =
        (manifest?.modules as Array<Record<string, unknown>>) ?? [];
      const versionSectionIds = new Set<string>();
      for (const mod of modules) {
        const chapters = (mod.chapters as Array<Record<string, unknown>>) ?? [];
        for (const chapter of chapters) {
          const ids = chapter.sectionIds;
          if (!Array.isArray(ids)) continue;
          for (const id of ids) {
            if (typeof id === 'string') versionSectionIds.add(id);
          }
        }
      }

      const referencesThisPackage = Array.from(ownedSectionIds).some((id) =>
        versionSectionIds.has(id),
      );
      if (!referencesThisPackage) continue;

      const pinned = await this.prisma.userCourse.count({
        where: { courseId: pkg.courseId, enrolledVersionId: version.id },
      });
      if (pinned > 0) return false;
    }

    return true;
  }

  private async ensureCloudRegistration(args: {
    user: User;
    courseId: string;
    packageId: string;
    scormCloudCourseId: string;
    sectionId: string;
    moduleId: string;
    chapterId: string;
    completeOn: string;
  }) {
    const existing = await this.prisma.scormRegistration.findUnique({
      where: {
        userId_packageId: {
          userId: args.user.id,
          packageId: args.packageId,
        },
      },
    });
    if (existing) {
      if (!existing.firstLaunchAt) {
        return this.prisma.scormRegistration.update({
          where: { id: existing.id },
          data: { firstLaunchAt: new Date() },
        });
      }
      return existing;
    }

    const publicApp = this.config.get<string>('PUBLIC_APP_URL');
    const postUser = this.config.get<string>('SCORM_POSTBACK_AUTH_USER');
    const postPass = this.config.get<string>('SCORM_POSTBACK_AUTH_PASSWORD');
    if (!publicApp || !postUser || !postPass) {
      throw new InternalServerErrorException(
        'SCORM postback URL or credentials are not configured',
      );
    }

    const registrationId = randomUUID();
    let cloudCreated = false;
    try {
      await this.cloud.createRegistration({
        courseId: args.scormCloudCourseId,
        registrationId,
        learner: {
          id: args.user.id,
          firstName: args.user.firstName,
          lastName: args.user.lastName,
        },
        postBack: {
          url: `${stripTrailingSlash(publicApp)}/api/v1/scorm/postback`,
          authType: 'HTTPBASIC',
          userName: postUser,
          password: postPass,
          resultsFormat: 'COURSE',
        },
      });
      cloudCreated = true;
    } catch (err) {
      if (err instanceof ScormCloudHttpError && err.cloudStatus === 409) {
        const raced = await this.prisma.scormRegistration.findUnique({
          where: {
            userId_packageId: {
              userId: args.user.id,
              packageId: args.packageId,
            },
          },
        });
        if (raced) {
          if (!raced.firstLaunchAt) {
            return this.prisma.scormRegistration.update({
              where: { id: raced.id },
              data: { firstLaunchAt: new Date() },
            });
          }
          return raced;
        }
        throw new InternalServerErrorException(
          `SCORM Cloud 409 creating registration ${registrationId} with no local row — refusing to persist an unverified id`,
        );
      }
      throw err;
    }

    try {
      return await this.prisma.scormRegistration.create({
        data: {
          id: registrationId,
          userId: args.user.id,
          courseId: args.courseId,
          packageId: args.packageId,
          sectionId: args.sectionId,
          completeOn: args.completeOn,
          scormCloudRegistrationId: registrationId,
          firstLaunchAt: new Date(),
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const raced = await this.prisma.scormRegistration.findUnique({
          where: {
            userId_packageId: {
              userId: args.user.id,
              packageId: args.packageId,
            },
          },
        });
        if (raced) {
          if (cloudCreated) {
            await compensateCloudRegistration(
              this.cloud,
              registrationId,
              this.logger,
            );
          }
          return raced;
        }
      }
      if (cloudCreated) {
        await compensateCloudRegistration(
          this.cloud,
          registrationId,
          this.logger,
        );
      }
      throw err;
    }
  }

  private async upsertLastSeen(args: {
    userId: string;
    courseId: string;
    moduleId: string;
    chapterId: string;
    sectionId: string;
    /** True when the stored pointer is missing or no longer live. */
    repairStalePointer: boolean;
  }) {
    await this.prisma.lastSeenSection.upsert({
      where: {
        userId_chapterId: {
          userId: args.userId,
          chapterId: args.chapterId,
        },
      },
      // Repair, don't rewind.
      //
      // Overwriting unconditionally resets the learner's resume position to
      // lesson 1 on every launch, undoing the bookmark `updateLastSeenLesson`
      // maintains. Never overwriting leaves a pointer stranded on a section a
      // package replace or the backfill archived, with nothing able to fix it.
      //
      // So the caller decides: it overwrites only when the existing pointer no
      // longer names a live section of this package.
      update: args.repairStalePointer ? { sectionId: args.sectionId } : {},
      create: {
        userId: args.userId,
        chapterId: args.chapterId,
        sectionId: args.sectionId,
        moduleId: args.moduleId,
        courseId: args.courseId,
      },
    });
  }

  private async resolvePinnedScormTarget(userId: string, courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, isActive: true, deliveryMode: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.deliveryMode !== CourseDeliveryMode.IMPORTED_SCORM) {
      throw new BadRequestException('Course is not an imported SCORM course');
    }

    const curriculum = await this.courseVersionService.resolveCurriculumTree(
      userId,
      courseId,
    );

    let section: {
      id: string;
      chapterId: string;
      moduleId: string | null;
      config: unknown;
    } | null = null;

    if (curriculum.mode === 'versioned') {
      const found = findScormSection(curriculum.tree);
      if (found) {
        section = {
          id: found.id,
          chapterId: found.chapterId,
          moduleId: found.moduleId,
          config: found.config,
        };
      }
    } else {
      section = await this.prisma.section.findFirst({
        where: {
          type: SectionType.SCORM,
          isArchived: false,
          chapter: {
            isArchived: false,
            module: { courseId, isArchived: false },
          },
        },
        // Same reason as resolveCertifySection: with one section per lesson
        // this must resolve to lesson 1 every time, not to whichever row the
        // planner happens to return. The launch link is per-registration and
        // the SCO resumes from its own bookmark, so the section only has to be
        // stable — but it does have to be stable.
        orderBy: { orderIndex: 'asc' },
        select: { id: true, chapterId: true, moduleId: true, config: true },
      });
    }

    if (!section) {
      throw new NotFoundException('No SCORM section on this curriculum');
    }
    if (!section.moduleId) {
      throw new InternalServerErrorException(
        'SCORM section is missing moduleId',
      );
    }

    const config = parseScormSectionConfig(section.config);
    if (!config) {
      throw new InternalServerErrorException(
        'SCORM section is missing package config',
      );
    }

    const pkg = await this.prisma.scormPackage.findUnique({
      where: { id: config.packageId },
    });
    if (!pkg) {
      throw new NotFoundException('SCORM package not found');
    }

    return {
      courseIsActive: course.isActive,
      package: pkg,
      sectionId: section.id,
      chapterId: section.chapterId,
      moduleId: section.moduleId,
      completeOn: config.completeOn,
    };
  }

  private parseProgressPayload(
    payload: unknown,
  ): ScormCloudRegistrationProgress {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new InternalServerErrorException('Postback body must be JSON');
    }
    return payload as ScormCloudRegistrationProgress;
  }
}

function findScormSection(
  tree: PinnedCurriculumTree,
): PinnedCurriculumSection | null {
  for (const mod of tree.modules) {
    for (const chapter of mod.chapters) {
      for (const section of chapter.sections) {
        if (section.type === SectionType.SCORM) return section;
      }
    }
  }
  return null;
}

/** One entry of `ScormPackage.lessons`, as written at import. */
type PackageLesson = {
  index: number;
  id: string;
  title: string;
  type: string;
  sectionId: string;
};

/**
 * Read the lesson manifest off a package.
 *
 * Defensive because this is a JSON column: a package imported before the
 * manifest existed has null, a backfill that half-ran could have partial rows,
 * and neither may take down a progress write. Anything unreadable yields `[]`,
 * which callers treat as "single-section package, binary progress".
 */
function parsePackageLessons(value: unknown): PackageLesson[] {
  if (!Array.isArray(value)) return [];
  const out: PackageLesson[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.index !== 'number' || !Number.isInteger(row.index)) continue;
    if (typeof row.id !== 'string' || !row.id) continue;
    if (typeof row.sectionId !== 'string' || !row.sectionId) continue;
    out.push({
      index: row.index,
      id: row.id,
      title: typeof row.title === 'string' ? row.title : '',
      type: typeof row.type === 'string' ? row.type : 'blocks',
      sectionId: row.sectionId,
    });
  }
  return out;
}

/**
 * Parse a Cloud timestamp, reading a zone-less one as UTC.
 *
 * `new Date('2026-09-21T07:38:33')` is LOCAL time in JS, so a zone-less string
 * would shift by the server's offset — and since these feed min/max merges, a
 * shifted value can win a comparison it should lose. Cloud documents UTC.
 */
function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const trimmed = value.trim();
  const zoneless = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(
    trimmed,
  );
  const date = new Date(zoneless ? `${trimmed.replace(' ', 'T')}Z` : trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The later of a stored stamp and a new one; the stored one may be null. */
function maxDate(stored: Date | null | undefined, incoming: Date): Date {
  return stored && stored.getTime() > incoming.getTime() ? stored : incoming;
}

/**
 * Whether a snapshot taken at `snapshotAt` is at least as new as everything the
 * row already reflects — the last postback recorded and the last pull applied.
 * Only such a snapshot may overwrite the last-write-wins fields.
 */
function isSnapshotFresh(
  row: { lastPostbackAt: Date | null; lastRuntimeAppliedAt: Date | null },
  snapshotAt: Date,
): boolean {
  const newest = Math.max(
    row.lastPostbackAt?.getTime() ?? Number.NEGATIVE_INFINITY,
    row.lastRuntimeAppliedAt?.getTime() ?? Number.NEGATIVE_INFINITY,
  );
  return snapshotAt.getTime() >= newest;
}

/** A JSON column's value as a plain object, or `{}` for anything else. */
function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * A postback was recorded that no applied runtime snapshot followed — the
 * debounce skipped its pull, or the pull failed. Null `lastPostbackAt` means
 * nothing has happened yet, which is not dirty.
 */
function isRuntimeDirty(row: {
  lastPostbackAt: Date | null;
  lastRuntimeAppliedAt: Date | null;
}): boolean {
  if (!row.lastPostbackAt) return false;
  if (!row.lastRuntimeAppliedAt) return true;
  return row.lastPostbackAt.getTime() > row.lastRuntimeAppliedAt.getTime();
}

/**
 * The import-time index-space warning, unless an admin has since verified it.
 *
 * Read from the persisted probe rather than recomputed: it is the manifest the
 * sections were BUILT from that matters. `riseIndexSpaceVerified: true` is the
 * escape hatch once someone has checked a real learner's decode by hand; set
 * by scripts/backfill-scorm-lessons.ts --verify-index-space, which must keep
 * using this exact key.
 */
function unverifiedIndexSpaceRisk(probe: unknown): string | null {
  if (!probe || typeof probe !== 'object' || Array.isArray(probe)) return null;
  const record = probe as Record<string, unknown>;
  if (record.riseIndexSpaceVerified === true) return null;
  return typeof record.riseIndexSpaceRisk === 'string' &&
    record.riseIndexSpaceRisk.length > 0
    ? record.riseIndexSpaceRisk
    : null;
}

/**
 * `Promise.all` over `items` with at most `limit` in flight. Results keep input
 * order. `fn` is expected not to throw (callers catch per item).
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

/**
 * The Cloud payload minus two things it must never persist:
 *
 * - `suspendData` — Articulate's private resume blob, rewritten on every
 *   commit, ~3KB, and Cloud is its system of record. We store what we DERIVE
 *   from it (progress rows) and never replay it.
 * - learner name fields — already on the User row we own. Copying them into a
 *   JSON column spreads personal data into a place no GDPR purge path inspects.
 */
/**
 * Fields that already have their own column. Keeping a second copy in the JSON
 * blob buys nothing and is one more thing to disagree with the columns.
 */
const METADATA_REDUNDANT_KEYS = new Set([
  'registrationCompletion',
  'registrationSuccess',
  'totalSecondsTracked',
  'firstAccessDate',
  'lastAccessDate',
  'score',
]);

/**
 * The audit remainder of a Cloud payload — deliberately NOT the whole thing.
 *
 * This column is rewritten on every pull (up to once a minute per active
 * learner) on a row the same request already updates, so a verbatim ~5KB FULL
 * payload would mean continuous TOAST churn on `scorm_registrations` for data
 * nothing reads back. What is kept is the part with no column of its own: the
 * runtime envelope minus the resume blob, and the activity summary.
 */
function buildRegistrationMetadata(
  payload: ScormCloudRegistrationProgress,
): Prisma.InputJsonValue {
  const source = (payload ?? {}) as Record<string, unknown>;
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (METADATA_REDUNDANT_KEYS.has(key)) continue;
    clone[key] = JSON.parse(JSON.stringify(value ?? null));
  }
  // Walked, not read at the root. metadata is written only for FULL payloads,
  // which is precisely the level that nests further structures (runtime,
  // previousAttempts) — a root-only scrub would leave learner names sitting one
  // level down while claiming they had been removed.
  scrubPayload(clone);
  return clone as Prisma.InputJsonValue;
}

/** Name fields Cloud attaches to learner records at any depth. */
const LEARNER_NAME_KEYS = new Set([
  'firstName',
  'lastName',
  'fullName',
  'name',
  'email',
]);

/**
 * Strip everything we must not persist, at every depth:
 *
 * - learner NAMES — already on the User row we own; copying them into a JSON
 *   column spreads personal data into a place no GDPR purge path inspects. The
 *   learner id survives: it is our own User id and is what makes the blob
 *   reconcilable.
 * - `suspendData` — Articulate's private resume blob, ~3KB rewritten on every
 *   commit, and Cloud is its system of record. The byte count survives, so
 *   "has a resume state" stays distinguishable from "decode failed".
 * - `runtimeInteractions` / `runtimeObjectives` — per-question responses. Not
 *   reachable today (we never request them), but the guarantee belongs here
 *   rather than in a query param in another file.
 */
function scrubPayload(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) scrubPayload(child);
    return;
  }
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (LEARNER_NAME_KEYS.has(key) && typeof value === 'string') {
      delete record[key];
      continue;
    }
    if (key === 'runtimeInteractions' || key === 'runtimeObjectives') {
      record[`${key}Count`] = Array.isArray(value) ? value.length : null;
      delete record[key];
      continue;
    }
    if (key === 'suspendData') {
      record.suspendDataBytes = typeof value === 'string' ? value.length : null;
      delete record[key];
      continue;
    }
    scrubPayload(value);
  }
}

/**
 * Whichever of two raw Cloud status strings maps to the higher rank.
 *
 * Used to merge a pulled snapshot with the postback that triggered it: the two
 * are instants apart and either can be the fresher one, so taking the pull
 * verbatim can lose a terminal status the postback already carried.
 */
function higherRanked(
  a: string | undefined,
  b: string | undefined,
  map: (raw: string | undefined) => string,
  rank: Record<string, number>,
): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return (rank[map(a)] ?? 0) >= (rank[map(b)] ?? 0) ? a : b;
}

/**
 * Drop the bookmark label when we fall back to binary progress.
 *
 * A stale "Lesson 6 of 14" sitting beside `progressSource: 'binary'` reads as a
 * current position we no longer stand behind — either the manifest is gone, the
 * blob is unreadable, or its fingerprint disagrees. `locationRaw` is kept: it is
 * the verbatim string Cloud gave us, which is evidence rather than an
 * interpretation.
 */
function clearLessonLabel(
  update: Prisma.ScormRegistrationUpdateInput,
  current: { lessonsCompleted: number | null },
): Prisma.ScormRegistrationUpdateInput {
  update.lessonId = null;
  update.lessonIndex = null;
  update.lessonTitle = null;
  return keepSourceIfDecoded(update, current);
}

/** The binary fallback WITHOUT clearing a bookmark label we can still trust. */
function keepSourceIfDecoded(
  update: Prisma.ScormRegistrationUpdateInput,
  current: { lessonsCompleted: number | null },
): Prisma.ScormRegistrationUpdateInput {
  // `progressSource` says how we know this learner's progress, and the lesson
  // count is cumulative and monotonic — a Rise re-attempt resets suspendData
  // but must not retract credit already earned. Downgrading to 'binary' while
  // `lessonsCompleted` stays populated would describe the row as having no
  // lesson data, next to lesson data. Once decoded, it stays 'suspend-data'.
  if (current.lessonsCompleted != null) delete update.progressSource;
  return update;
}

/** The higher of two Cloud score envelopes; either may be absent. */
function higherScore(
  a: { scaled?: number } | undefined,
  b: { scaled?: number } | undefined,
): { scaled?: number } | undefined {
  if (typeof a?.scaled !== 'number') return b;
  if (typeof b?.scaled !== 'number') return a;
  return a.scaled >= b.scaled ? a : b;
}

/**
 * An `ARRAY[...]::int[]` literal, safe for the empty case.
 *
 * Prisma binds a non-empty number[] fine, but cannot type an empty one — it can
 * arrive as `text[]` and fail the comparison. Emitting the literal (from values
 * we have already validated as integers) sidesteps the inference entirely.
 */
function intArrayLiteral(values: number[]): Prisma.Sql {
  if (values.length === 0) return Prisma.sql`ARRAY[]::int[]`;
  return Prisma.sql`ARRAY[${Prisma.join(values)}]::int[]`;
}
