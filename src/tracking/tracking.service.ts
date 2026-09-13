import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isInteractiveSectionType } from '../utils/interactive-section-types';
import { parseUserAgent } from '../utils/user-agent';

/** Clamp n into [lo, hi]; non-finite input falls back to lo. */
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(n, lo), hi);
}

type SectionPlace = {
  chapterId: string;
  moduleId: string | null;
  courseId: string;
};

type TtlEntry<T> = { value: T; expiresAt: number };

/** Insert/refresh an LRU entry; drop the oldest when over `max`. */
function lruSet<V>(
  map: Map<string, V>,
  key: string,
  value: V,
  max: number,
): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

/**
 * Platform tracking reads/writes for time-spent. Login events are written in
 * AuthService (on the login path); this service owns the heartbeat accrual and
 * the reporting roll-ups.
 *
 * Heartbeat model: the FE pings every ~HEARTBEAT_INTERVAL while a section is
 * open. Each ping adds the elapsed time since the previous ping, but capped at
 * MAX_ACCRUAL_SECONDS — so a long gap (idle, tab closed then reopened, sleep)
 * contributes at most one interval, never the whole gap. This counts active
 * viewing time, not wall-clock-since-open.
 */
@Injectable()
export class TrackingService {
  /** Bounds for the client-reported ping cadence (seconds). */
  static readonly MIN_INTERVAL = 5;
  static readonly MAX_INTERVAL = 60;
  /** Per-ping cap = interval * CAP_FACTOR (clamped to ABSOLUTE_CAP). */
  static readonly CAP_FACTOR = 3;
  /** Old-client fallback ceiling: interval * GRACE_FACTOR. */
  static readonly GRACE_FACTOR = 1.5;
  /** Final backstop on any single ping's credit (seconds). */
  static readonly ABSOLUTE_CAP = 90;

  /** Section → course mapping is stable; a short TTL covers rare moves. */
  static readonly SECTION_PLACE_TTL_MS = 5 * 60 * 1000;
  /** Negative completion cache: pick up a just-issued certificate within this. */
  static readonly NOT_FROZEN_TTL_MS = 10_000;
  static readonly SECTION_PLACE_CACHE_MAX = 2048;
  static readonly FROZEN_CACHE_MAX = 4096;

  private readonly logger = new Logger(TrackingService.name);
  private readonly sectionPlaceCache = new Map<
    string,
    TtlEntry<SectionPlace>
  >();
  /** Completed courses never un-freeze; remember the last reported total. */
  private readonly frozenTotals = new Map<string, number>();
  private readonly notFrozenUntil = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Accrue ACTIVE time for (user, section) from a heartbeat.
   *
   * Duration is NOT derived from the beep-arrival gap (that billed away-time
   * onto the first beep after return). Instead the client reports the active
   * time it measured since its last successful ping (`clientActiveSeconds`),
   * and the server credits `min(clientActive, serverGap, perPingCap)` — so a
   * client can never claim more than real elapsed server time, and an idle /
   * hidden-tab gap credits ~0 because the client's measured active time is ~0.
   *
   * Old clients that send only { sectionId } hit a conservative gap-rejection
   * fallback (never the original min(gap, 90) rule), so the bug can't persist
   * for un-upgraded clients during rollout.
   *
   * lastHeartbeatAt is ALWAYS advanced to the server receive time, even when
   * credit is 0 — a stale timestamp would inflate the next ping.
   *
   * COMPLETED COURSES DO NOT ACCRUE. Once `CourseCompletion.courseCompletedAt`
   * is set, revisiting a lesson credits nothing: the learner's recorded study
   * time is evidence attached to a certificate that has already been issued, so
   * it must not keep moving afterwards. The response carries `frozen: true` so
   * the client can stop pinging instead of sending requests we will ignore.
   *
   * CONCURRENCY: the read below is not authoritative on its own. The write is a
   * compare-and-set guarded on the `lastHeartbeatAt` this call read, so two
   * overlapping pings (two tabs, or a retry racing the original) can never
   * credit the same wall-clock window twice. The CAS loser credits 0 — which is
   * correct, because the winner already recorded that window.
   */
  async heartbeat(
    userId: string,
    sectionId: string,
    clientActiveSeconds?: number | null,
    clientIntervalSeconds?: number | null,
  ) {
    const place = await this.resolveSectionPlace(sectionId);

    // Completed courses never un-freeze. After the first ping we can answer
    // from memory and skip every DB round-trip on this path.
    const frozenTotal = this.getFrozenTotal(userId, place.courseId);
    if (frozenTotal !== undefined) {
      return this.heartbeatResult(frozenTotal, 0, true);
    }

    const skipCompletionLookup = this.isKnownNotFrozen(userId, place.courseId);

    // Completion + current total in one round-trip (independent reads).
    const [completion, existing] = await Promise.all([
      skipCompletionLookup
        ? Promise.resolve(null)
        : this.prisma.courseCompletion.findUnique({
            where: { userId_courseId: { userId, courseId: place.courseId } },
            select: { courseCompletedAt: true },
          }),
      this.prisma.sectionTimeSpent.findUnique({
        where: { userId_sectionId: { userId, sectionId } },
        select: { totalSeconds: true, lastHeartbeatAt: true },
      }),
    ]);

    if (completion?.courseCompletedAt) {
      this.rememberFrozen(userId, place.courseId, existing?.totalSeconds ?? 0);
      return this.heartbeatResult(existing?.totalSeconds ?? 0, 0, true);
    }
    if (!skipCompletionLookup) {
      this.rememberNotFrozen(userId, place.courseId);
    }

    const now = new Date();

    if (!existing) {
      // First ping for this section: open the books, credit nothing. `upsert`
      // keeps the create race safe — the loser falls through to `update`, which
      // only advances the timestamp and still credits 0.
      const opened = await this.prisma.sectionTimeSpent.upsert({
        where: { userId_sectionId: { userId, sectionId } },
        create: {
          userId,
          sectionId,
          chapterId: place.chapterId,
          moduleId: place.moduleId,
          courseId: place.courseId,
          totalSeconds: 0,
          lastHeartbeatAt: now,
        },
        update: { lastHeartbeatAt: now },
      });
      return this.heartbeatResult(opened.totalSeconds, 0);
    }

    // Clamp the client-reported cadence; derive the per-ping cap from it.
    const interval = clamp(
      clientIntervalSeconds ?? TrackingService.MAX_INTERVAL,
      TrackingService.MIN_INTERVAL,
      TrackingService.MAX_INTERVAL,
    );
    const perPingCap = clamp(
      interval * TrackingService.CAP_FACTOR,
      TrackingService.MIN_INTERVAL,
      TrackingService.ABSOLUTE_CAP,
    );

    // serverGap uses the server receive-clock only — never a client timestamp.
    const serverGap =
      (now.getTime() - existing.lastHeartbeatAt.getTime()) / 1000;

    let credit: number;
    if (clientActiveSeconds != null) {
      // New client (preferred): the client can never claim more than real
      // elapsed server time — min(clientActive, serverGap) is the security
      // property — and a single ping is capped at perPingCap.
      credit = Math.max(
        0,
        Math.min(clientActiveSeconds, serverGap, perPingCap),
      );
    } else {
      // Old client (only { sectionId }): conservative gap-rejection fallback.
      // NOT the legacy min(gap, ABSOLUTE_CAP) rule — that would let a 5s-cadence
      // client over-count an away gap by up to ~18×. Ceiling at interval*GRACE.
      credit = Math.max(
        0,
        Math.min(serverGap, interval * TrackingService.GRACE_FACTOR),
      );
    }

    // Round to whole seconds for storage; the int column holds seconds.
    const creditSeconds = Math.round(credit);

    // Compare-and-set on the timestamp we read. `lastHeartbeatAt` doubles as the
    // row's version: if a concurrent ping advanced it, this matches 0 rows and
    // we credit nothing rather than applying the same window twice.
    const applied = await this.prisma.sectionTimeSpent.updateMany({
      where: { userId, sectionId, lastHeartbeatAt: existing.lastHeartbeatAt },
      data: {
        totalSeconds: { increment: creditSeconds },
        // ALWAYS advance, even when credit is 0 — a stale timestamp would
        // inflate the next ping's serverGap.
        lastHeartbeatAt: now,
      },
    });

    if (applied.count === 0) {
      // Lost the race: another ping already credited this window. Report the
      // current total without adding to it.
      const current = await this.prisma.sectionTimeSpent.findUnique({
        where: { userId_sectionId: { userId, sectionId } },
        select: { totalSeconds: true },
      });
      return this.heartbeatResult(
        current?.totalSeconds ?? existing.totalSeconds,
        0,
      );
    }

    // Winning the CAS proves no other write landed between the read and the
    // update, so the new total is exactly what we read plus what we added.
    const totalSeconds = existing.totalSeconds + creditSeconds;

    if (creditSeconds > 0) {
      // Daily roll-up is not on the response path — don't hold the ping for it.
      void this.accrueDailyTime(
        userId,
        place.courseId,
        now,
        creditSeconds,
      ).catch((err) =>
        this.logger.warn(
          `Daily time roll-up failed for user ${userId} course ${place.courseId}: ${err}`,
        ),
      );
    }

    return this.heartbeatResult(totalSeconds, creditSeconds);
  }

  /**
   * Record one interactive-section verification attempt (Check / auto-verify).
   * Increments the aggregate counter on the existing section_time_spent row
   * (or creates one with totalSeconds = 0).
   */
  async recordSectionAttempt(
    userId: string,
    sectionId: string,
    _isCorrect: boolean,
  ) {
    const section = await this.prisma.section.findUnique({
      where: { id: sectionId },
      select: {
        id: true,
        type: true,
        chapterId: true,
        moduleId: true,
        chapter: {
          select: { moduleId: true, module: { select: { courseId: true } } },
        },
      },
    });
    if (!section) {
      throw new HttpException(
        { status: HttpStatus.NOT_FOUND, error: 'Section not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    if (!isInteractiveSectionType(section.type)) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error:
            'Section attempts are only tracked for interactive section types',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const moduleId = section.moduleId ?? section.chapter?.moduleId ?? null;
    const courseId = section.chapter?.module?.courseId;
    if (!courseId) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Section is not linked to a course',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const enrollment = await this.prisma.userCourse.findFirst({
      where: { userId, courseId, isActive: true },
      select: { id: true },
    });
    if (!enrollment) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error:
            'You are not assigned to this course, or the enrolment is inactive',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    const now = new Date();
    const row = await this.prisma.sectionTimeSpent.upsert({
      where: { userId_sectionId: { userId, sectionId } },
      create: {
        userId,
        sectionId,
        chapterId: section.chapterId,
        moduleId,
        courseId,
        totalSeconds: 0,
        totalAttempts: 1,
        firstAttemptAt: now,
        lastAttemptAt: now,
        lastHeartbeatAt: now,
      },
      update: {
        totalAttempts: { increment: 1 },
        lastAttemptAt: now,
      },
    });

    return {
      message: 'Section attempt recorded',
      statusCode: 200,
      data: {
        totalAttempts: row.totalAttempts,
        lastAttemptAt: row.lastAttemptAt,
      },
    };
  }

  private frozenKey(userId: string, courseId: string): string {
    return `${userId}:${courseId}`;
  }

  /**
   * Section → course/chapter/module. Cached because the hierarchy is stable
   * and every ping used to re-join it. A short TTL covers rare admin moves.
   */
  private async resolveSectionPlace(sectionId: string): Promise<SectionPlace> {
    const cached = this.sectionPlaceCache.get(sectionId);
    if (cached && cached.expiresAt > Date.now()) {
      lruSet(
        this.sectionPlaceCache,
        sectionId,
        cached,
        TrackingService.SECTION_PLACE_CACHE_MAX,
      );
      return cached.value;
    }

    const section = await this.prisma.section.findUnique({
      where: { id: sectionId },
      select: {
        id: true,
        chapterId: true,
        moduleId: true,
        chapter: {
          select: { moduleId: true, module: { select: { courseId: true } } },
        },
      },
    });
    if (!section) {
      throw new HttpException(
        { status: HttpStatus.NOT_FOUND, error: 'Section not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    const moduleId = section.moduleId ?? section.chapter?.moduleId ?? null;
    const courseId = section.chapter?.module?.courseId;
    if (!courseId) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Section is not linked to a course',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const place: SectionPlace = {
      chapterId: section.chapterId,
      moduleId,
      courseId,
    };
    lruSet(
      this.sectionPlaceCache,
      sectionId,
      {
        value: place,
        expiresAt: Date.now() + TrackingService.SECTION_PLACE_TTL_MS,
      },
      TrackingService.SECTION_PLACE_CACHE_MAX,
    );
    return place;
  }

  private getFrozenTotal(userId: string, courseId: string): number | undefined {
    return this.frozenTotals.get(this.frozenKey(userId, courseId));
  }

  private isKnownNotFrozen(userId: string, courseId: string): boolean {
    const until = this.notFrozenUntil.get(this.frozenKey(userId, courseId));
    if (until === undefined) return false;
    if (until < Date.now()) {
      this.notFrozenUntil.delete(this.frozenKey(userId, courseId));
      return false;
    }
    return true;
  }

  private rememberFrozen(
    userId: string,
    courseId: string,
    totalSeconds: number,
  ): void {
    const key = this.frozenKey(userId, courseId);
    this.notFrozenUntil.delete(key);
    lruSet(
      this.frozenTotals,
      key,
      totalSeconds,
      TrackingService.FROZEN_CACHE_MAX,
    );
  }

  private rememberNotFrozen(userId: string, courseId: string): void {
    lruSet(
      this.notFrozenUntil,
      this.frozenKey(userId, courseId),
      Date.now() + TrackingService.NOT_FROZEN_TTL_MS,
      TrackingService.FROZEN_CACHE_MAX,
    );
  }

  /** UTC calendar-day bucket for daily time roll-ups. */
  private utcDay(d: Date): Date {
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
  }

  private async accrueDailyTime(
    userId: string,
    courseId: string,
    at: Date,
    seconds: number,
  ): Promise<void> {
    const day = this.utcDay(at);
    await this.prisma.sectionTimeSpentDaily.upsert({
      where: { userId_courseId_day: { userId, courseId, day } },
      create: { userId, courseId, day, totalSeconds: seconds },
      update: { totalSeconds: { increment: seconds } },
    });
  }

  // ── Reports ──────────────────────────────────────────────────────────────

  /** A user's login history, newest first (paginated). */
  async getLoginHistory(userId: string, limit = 50) {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const events = await this.prisma.loginEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
      select: { id: true, ipAddress: true, userAgent: true, createdAt: true },
    });
    // Parse the raw UA into friendly labels server-side so the FE doesn't have
    // to. Raw userAgent is still returned for anyone who wants finer detail.
    const data = events.map((e) => {
      const parsed = parseUserAgent(e.userAgent);
      return {
        ...e,
        device: parsed?.label ?? 'Unknown device',
        browser: parsed?.browser ?? 'Unknown',
        os: parsed?.os ?? 'Unknown',
        deviceType: parsed?.deviceType ?? 'desktop',
      };
    });
    return {
      message: 'Login history fetched successfully',
      statusCode: 200,
      data,
    };
  }

  /**
   * Time-spent for a user in a course as a NAMED, NESTED tree:
   * modules → chapters → sections, each with its title and totalSeconds, plus
   * the course total. Titles are resolved in batched queries so the FE can
   * render the full drill-down without extra per-id lookups.
   */
  async getUserCourseTimeSpent(userId: string, courseId: string) {
    const rows = await this.prisma.sectionTimeSpent.findMany({
      where: { userId, courseId },
      select: {
        sectionId: true,
        chapterId: true,
        moduleId: true,
        totalSeconds: true,
      },
    });

    // Resolve titles in three batched lookups (only the ids that have time).
    const sectionIds = [...new Set(rows.map((r) => r.sectionId))];
    const chapterIds = [...new Set(rows.map((r) => r.chapterId))];
    const moduleIds = [
      ...new Set(rows.map((r) => r.moduleId).filter((m): m is string => !!m)),
    ];
    const [sections, chapters, modules] = [
      await this.prisma.section.findMany({
        where: { id: { in: sectionIds } },
        select: { id: true, title: true },
      }),
      await this.prisma.chapter.findMany({
        where: { id: { in: chapterIds } },
        select: { id: true, title: true },
      }),
      await this.prisma.module.findMany({
        where: { id: { in: moduleIds } },
        select: { id: true, title: true },
      }),
    ];
    const sectionTitle = new Map(sections.map((s) => [s.id, s.title]));
    const chapterTitle = new Map(chapters.map((c) => [c.id, c.title]));
    const moduleTitle = new Map(modules.map((m) => [m.id, m.title]));

    const UNKNOWN_MODULE = 'unassigned';

    // Build module → chapter → section tree with roll-up totals.
    type SectionNode = {
      sectionId: string;
      title: string;
      totalSeconds: number;
    };
    type ChapterNode = {
      chapterId: string;
      title: string;
      totalSeconds: number;
      sections: SectionNode[];
    };
    type ModuleNode = {
      moduleId: string | null;
      title: string;
      totalSeconds: number;
      chapters: ChapterNode[];
    };

    const moduleMap = new Map<string, ModuleNode>();
    const chapterMap = new Map<string, ChapterNode>();
    let courseTotal = 0;

    for (const r of rows) {
      courseTotal += r.totalSeconds;
      const mKey = r.moduleId ?? UNKNOWN_MODULE;

      let mod = moduleMap.get(mKey);
      if (!mod) {
        mod = {
          moduleId: r.moduleId ?? null,
          title: r.moduleId
            ? moduleTitle.get(r.moduleId) ?? 'Untitled module'
            : 'Unassigned',
          totalSeconds: 0,
          chapters: [],
        };
        moduleMap.set(mKey, mod);
      }
      mod.totalSeconds += r.totalSeconds;

      const cKey = `${mKey}:${r.chapterId}`;
      let ch = chapterMap.get(cKey);
      if (!ch) {
        ch = {
          chapterId: r.chapterId,
          title: chapterTitle.get(r.chapterId) ?? 'Untitled chapter',
          totalSeconds: 0,
          sections: [],
        };
        chapterMap.set(cKey, ch);
        mod.chapters.push(ch);
      }
      ch.totalSeconds += r.totalSeconds;

      ch.sections.push({
        sectionId: r.sectionId,
        title: sectionTitle.get(r.sectionId) ?? 'Untitled lesson',
        totalSeconds: r.totalSeconds,
      });
    }

    const modulesTree = [...moduleMap.values()];

    return {
      message: 'Time spent fetched successfully',
      statusCode: 200,
      data: {
        courseId,
        totalSeconds: courseTotal,
        // Nested, named tree — preferred for the report UI.
        modules: modulesTree,
        // Flat, named lists — convenient for tables / backward compat.
        perSection: rows.map((r) => ({
          ...r,
          title: sectionTitle.get(r.sectionId) ?? 'Untitled lesson',
        })),
      },
    };
  }

  /**
   * `creditedSeconds` is TELEMETRY ONLY. Clients must not subtract it from a
   * local accumulator and retry the remainder: the clamp adjudicates between
   * concurrent clients, so an uncredited remainder has usually already been
   * recorded by another tab. Retrying it double-counts.
   */
  private heartbeatResult(
    totalSeconds: number,
    creditedSeconds: number,
    frozen = false,
  ) {
    return {
      message: 'Heartbeat recorded',
      statusCode: 200,
      data: { totalSeconds, creditedSeconds, frozen },
    };
  }
}
