import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parseUserAgent } from '../utils/user-agent';

/** Clamp n into [lo, hi]; non-finite input falls back to lo. */
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(n, lo), hi);
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
   */
  async heartbeat(
    userId: string,
    sectionId: string,
    clientActiveSeconds?: number | null,
    clientIntervalSeconds?: number | null,
  ) {
    // Resolve the section's place in the hierarchy (and validate it exists).
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
      // Orphaned section with no resolvable course — don't fabricate tracking.
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'Section is not linked to a course',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const now = new Date();
    // Read the prior ping. The WRITE below is an atomic upsert keyed on
    // (userId, sectionId), so concurrent first-pings can't collide on the
    // unique constraint — the create-race loser hits the update clause, where
    // serverGap ≈ 0 clamps its credit to ~0 (no double count across tabs).
    const existing = await this.prisma.sectionTimeSpent.findUnique({
      where: { userId_sectionId: { userId, sectionId } },
    });

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
    const serverGap = existing
      ? (now.getTime() - existing.lastHeartbeatAt.getTime()) / 1000
      : null;

    let credit: number;
    if (serverGap === null) {
      // First ping for this section: just open the books, credit nothing.
      credit = 0;
    } else if (clientActiveSeconds != null) {
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

    const row = await this.prisma.sectionTimeSpent.upsert({
      where: { userId_sectionId: { userId, sectionId } },
      create: {
        userId,
        sectionId,
        chapterId: section.chapterId,
        moduleId,
        courseId,
        totalSeconds: creditSeconds, // 0 on a genuine first ping
        lastHeartbeatAt: now,
      },
      update: {
        totalSeconds: { increment: creditSeconds },
        // ALWAYS advance, even when credit is 0 — a stale timestamp would
        // inflate the next ping's serverGap.
        lastHeartbeatAt: now,
      },
    });

    if (creditSeconds > 0) {
      await this.accrueDailyTime(userId, courseId, now, creditSeconds);
    }

    return this.heartbeatResult(row.totalSeconds);
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

  private heartbeatResult(totalSeconds: number) {
    return {
      message: 'Heartbeat recorded',
      statusCode: 200,
      data: { totalSeconds },
    };
  }
}
