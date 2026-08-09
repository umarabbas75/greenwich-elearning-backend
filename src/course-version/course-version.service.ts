import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildManifestFromLiveTree,
  computeStructuralFingerprint,
  countSectionsInManifest,
  diffManifests,
  diffManifestsTitled,
  DiffTitledResult,
  getChapterIdsFromManifest,
  getQuizBearingChapterIdsFromManifest,
  getQuizIdsFromManifest,
  getSectionIdsFromManifest,
  isIdReferencedInManifest,
  loadManifestForVersion,
  loadPinnedCurriculum,
  loadPinnedChapterQuizzes,
  mapPinnedQuizzesForLearner,
  mapPinnedSectionsForLearner,
  parseManifest,
  PinnedCurriculumModule,
  PinnedCurriculumQuiz,
  PinnedCurriculumSection,
  PinnedCurriculumTree,
  publishManifestVersion,
  loadPinnedCurriculumForReport,
  ReportCurriculumTree,
} from './course-version.manifest';
import { computeLearnerPercentages, percentageKey } from './learner-percentage';

export type CurriculumResolveResult =
  | { mode: 'live' }
  | {
      mode: 'versioned';
      versionId: string;
      versionNumber: number;
      tree: PinnedCurriculumTree;
    };

export type ReportCurriculumResolveResult =
  | { mode: 'live' }
  | {
      mode: 'versioned';
      versionId: string;
      versionNumber: number;
      tree: ReportCurriculumTree;
    };

@Injectable()
export class CourseVersionService {
  private readonly logger = new Logger(CourseVersionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveCurriculumTree(
    userId: string,
    courseId: string,
  ): Promise<CurriculumResolveResult> {
    const enrolledVersionId = await this.resolveEnrolledVersionId(
      userId,
      courseId,
    );
    if (!enrolledVersionId) {
      return { mode: 'live' };
    }

    const tree = await loadPinnedCurriculum(this.prisma, enrolledVersionId);
    if (!tree) {
      this.logger.warn(
        `User ${userId} pinned to missing or invalid version ${enrolledVersionId}; falling back to live tree`,
      );
      return { mode: 'live' };
    }

    return {
      mode: 'versioned',
      versionId: tree.versionId,
      versionNumber: tree.versionNumber,
      tree,
    };
  }

  /** Report path: lean section metadata only (no HTML/config payloads). */
  async resolveCurriculumTreeForReport(
    userId: string,
    courseId: string,
    preloadedUc?: { id: string; enrolledVersionId: string | null } | null,
  ): Promise<ReportCurriculumResolveResult> {
    const enrolledVersionId = await this.resolveEnrolledVersionId(
      userId,
      courseId,
      preloadedUc,
    );
    if (!enrolledVersionId) {
      return { mode: 'live' };
    }

    const tree = await loadPinnedCurriculumForReport(
      this.prisma,
      enrolledVersionId,
    );
    if (!tree) {
      this.logger.warn(
        `User ${userId} pinned to missing or invalid version ${enrolledVersionId}; falling back to live tree for report`,
      );
      return { mode: 'live' };
    }

    return {
      mode: 'versioned',
      versionId: tree.versionId,
      versionNumber: tree.versionNumber,
      tree,
    };
  }

  async resolveEnrolledVersionId(
    userId: string,
    courseId: string,
    preloadedUc?: { id: string; enrolledVersionId: string | null } | null,
  ): Promise<string | null> {
    const uc =
      preloadedUc ??
      (await this.prisma.userCourse.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: { id: true, enrolledVersionId: true },
      }));

    if (!uc?.enrolledVersionId) {
      return null;
    }

    const enrolledVersionId = uc.enrolledVersionId;

    // Pure read: a learner's pin is immutable once set (pinned at activation).
    // We deliberately do NOT re-pin here — resolving a version must never mutate
    // the enrollment (it previously "bumped zero-progress" learners to latest on
    // read, which shifted the curriculum under learners who had answered quizzes
    // but recorded no section progress, and put a write on every GET).
    // Resolve the manifest (cached) and warm the shared cache for the gate and
    // quiz loader downstream. Returning null when it can't be resolved is the
    // degrade-to-live signal the quiz/gate paths depend on (getVersionQuizzes →
    // live fallback; the progression gate → live ordering). NOTE: this is NOT a
    // liveness probe — after the first hit the answer comes from the in-process
    // cache, so it does not re-check the row each call. That's fine because a
    // pinned version can't be deleted (UserCourse.enrolledVersion is onDelete:
    // Restrict); the null return only guards the manifest-unparseable/absent case.
    const manifest = await loadManifestForVersion(
      this.prisma,
      enrolledVersionId,
    );
    if (!manifest) {
      this.logger.warn(
        `User ${userId} pinned to missing/invalid version ${enrolledVersionId}; falling back to live tree`,
      );
      return null;
    }

    return enrolledVersionId;
  }

  async getVersionQuizzesForChapter(
    userId: string,
    courseId: string,
    sourceChapterId: string,
    includeAnswers = false,
    preResolvedVersionId?: string | null,
  ): Promise<Array<{
    id: string;
    question: string;
    options: string[];
    answer?: string;
  }> | null> {
    const versionId =
      preResolvedVersionId !== undefined
        ? preResolvedVersionId
        : await this.resolveEnrolledVersionId(userId, courseId);
    if (!versionId) {
      return null;
    }

    // Chapter-scoped: load only THIS chapter's quizzes from the manifest instead
    // of hydrating the entire course tree (all section bodies) just to read one
    // chapter's quiz list. Returns [] for a pinned learner whose chapter has no
    // quizzes / isn't in the version — matching the previous whole-tree result.
    return loadPinnedChapterQuizzes(
      this.prisma,
      versionId,
      sourceChapterId,
      includeAnswers,
    );
  }

  async resolveCurriculumByEnrollment(
    enrolledVersionId: string | null | undefined,
  ): Promise<CurriculumResolveResult> {
    if (!enrolledVersionId) {
      return { mode: 'live' };
    }

    const tree = await loadPinnedCurriculum(this.prisma, enrolledVersionId);
    if (!tree) {
      return { mode: 'live' };
    }

    return {
      mode: 'versioned',
      versionId: tree.versionId,
      versionNumber: tree.versionNumber,
      tree,
    };
  }

  async getLatestPublishedVersion(courseId: string) {
    return this.prisma.courseVersion.findFirst({
      where: { courseId, status: 'PUBLISHED', isLatest: true },
      select: {
        id: true,
        versionNumber: true,
        manifest: true,
        sectionCount: true,
        publishedAt: true,
      },
    });
  }

  /**
   * Pin an enrollment to the course's current latest published version, once.
   * Called at first activation. Idempotent and race-safe: the write is a
   * conditional updateMany guarded by `enrolledVersionId: null`, so if the
   * enrollment is already pinned (or a concurrent activation pinned it first)
   * this is a no-op — a pin is never overwritten once set.
   */
  async pinEnrollmentToLatest(
    userCourseId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;

    const uc = await db.userCourse.findUnique({
      where: { id: userCourseId },
      select: { id: true, courseId: true, enrolledVersionId: true },
    });
    if (!uc || uc.enrolledVersionId) return;

    const latest = await db.courseVersion.findFirst({
      where: { courseId: uc.courseId, status: 'PUBLISHED', isLatest: true },
      select: { id: true },
    });

    if (!latest) {
      this.logger.warn(
        `No published version for course ${uc.courseId}; enrollment ${userCourseId} stays unpinned`,
      );
      return;
    }

    // Conditional write: only pins while still unpinned (atomic no-op otherwise).
    await db.userCourse.updateMany({
      where: { id: userCourseId, enrolledVersionId: null },
      data: { enrolledVersionId: latest.id },
    });
  }

  async publishNewVersion(
    adminId: string | null | undefined,
    courseId: string,
    changeNotes?: string,
  ) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true },
    });
    if (!course) {
      throw new NotFoundException('Course not found');
    }

    // Everything that decides the next version — building the live manifest,
    // the structural-fingerprint dedup, the versionNumber, demoting the old
    // latest, and inserting the new row — runs inside ONE transaction guarded by
    // a per-course advisory lock. Consequences:
    //  • Concurrent publishes for the same course are serialized, so they can't
    //    collide on versionNumber (@@unique[courseId, versionNumber]) or leave
    //    two isLatest rows (the partial unique index also backstops this).
    //  • The "no structural change" dedup is authoritative: a racing publish
    //    can't slip a version in between the check and the insert.
    //  • The manifest is built ONCE and reused for the fingerprint and the
    //    stored row (it was previously built up to 3x across this path).
    // The lock is xact-scoped (pg_try_advisory_xact_lock) → safe under PgBouncer
    // transaction pooling. We use the NON-blocking try-variant: a second
    // concurrent publish for the same course fails fast with a ConflictException
    // instead of blocking on the lock and burning the interactive-tx timeout
    // (which would surface as "Transaction already closed"), and instead of
    // holding this instance's single pooled connection (connection_limit=1) idle
    // for up to 15s. Auto-publish is best-effort (the caller swallows + logs, and
    // the drift reconcile heals), so a dropped concurrent publish is safe; a
    // manual publish surfaces a clean 409. publishNewVersion already ran in an
    // interactive tx; this only adds the lock + a single manifest findMany.
    return this.prisma.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>(
          Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${courseId}, 0)) AS locked`,
        );
        if (!locked) {
          throw new ConflictException(
            `Another publish is already in progress for course ${courseId}; retry`,
          );
        }

        const built = await buildManifestFromLiveTree(tx, courseId);

        // Matched by isLatest ALONE (no status filter) on purpose: this row is
        // the one we must demote, and the partial unique index guarantees there's
        // at most one isLatest per course. Adding status: 'PUBLISHED' here could
        // skip an isLatest row of another status and leave two latest rows. Reads
        // that want the *published* latest use getLatestPublishedVersion instead.
        const currentLatest = await tx.courseVersion.findFirst({
          where: { courseId, isLatest: true },
          orderBy: { versionNumber: 'desc' },
        });

        if (currentLatest?.manifest) {
          const latestManifest = parseManifest(currentLatest.manifest);
          if (
            latestManifest &&
            computeStructuralFingerprint(latestManifest) ===
              computeStructuralFingerprint(built.manifest)
          ) {
            return {
              message: `No structural change — still on version ${currentLatest.versionNumber}`,
              statusCode: 200,
              data: {
                ...currentLatest,
                stats: {
                  modules: built.moduleCount,
                  chapters: built.chapterCount,
                  sections: built.sectionCount,
                  quizzes: built.quizCount,
                },
                skipped: true,
              },
            };
          }
        }

        // Derive the next number from MAX(versionNumber), NOT currentLatest — a
        // non-latest row can carry a higher number (e.g. prune-orphan promotes an
        // older version back to isLatest), and currentLatest+1 would then collide
        // on @@unique([courseId, versionNumber]).
        const maxAgg = await tx.courseVersion.aggregate({
          where: { courseId },
          _max: { versionNumber: true },
        });
        const nextNumber = (maxAgg._max.versionNumber ?? 0) + 1;

        if (currentLatest) {
          await tx.courseVersion.update({
            where: { id: currentLatest.id },
            data: { isLatest: false },
          });
        }

        const snapshot = await publishManifestVersion(tx, courseId, {
          versionNumber: nextNumber,
          status: 'PUBLISHED',
          isLatest: true,
          publishedAt: new Date(),
          publishedByAdminId: adminId ?? null,
          changeNotes: changeNotes ?? null,
          prebuiltManifest: built,
        });

        // Close the pinning hole: pin any ACTIVE, still-unpinned enrollment on
        // this course to the new version. Under "freeze at activation", an active
        // enrollment should always be pinned; a NULL one is the anomaly from
        // activation happening before any version existed (activatedAt was
        // stamped, so it would otherwise never pin). Conditional on
        // enrolledVersionId: null → never overwrites an existing pin. This is
        // visually a no-op for the learner: the version we just published IS the
        // live tree at this instant, and an unpinned learner was already being
        // served that live tree. Self-limiting — matches nothing after the first
        // publish. Logged so a surprising mass-pin is visible, not silent.
        const pinned = await tx.userCourse.updateMany({
          where: { courseId, isActive: true, enrolledVersionId: null },
          data: { enrolledVersionId: snapshot.versionId },
        });
        if (pinned.count > 0) {
          this.logger.log(
            `Pinned ${pinned.count} active unpinned enrollment(s) on course ${courseId} to v${nextNumber}`,
          );
        }

        const version = await tx.courseVersion.findUnique({
          where: { id: snapshot.versionId },
        });
        if (!version) {
          // Invariant: we just created this row in this transaction. Fail loudly
          // (rolls back) instead of returning `versionNumber: undefined`.
          throw new Error(
            `Published version ${snapshot.versionId} not found after create`,
          );
        }

        return {
          message: `Published version ${nextNumber} for "${course.title}"`,
          statusCode: 200,
          data: {
            ...version,
            stats: {
              modules: snapshot.moduleCount,
              chapters: snapshot.chapterCount,
              sections: snapshot.sectionCount,
              quizzes: snapshot.quizCount,
            },
          },
        };
      },
      { timeout: 15000, maxWait: 5000 },
    );
  }

  async autoPublishAfterStructuralChange(
    courseId: string,
    adminId: string | null | undefined,
    changeNotes: string,
  ): Promise<{ versionNumber: number; versionId: string } | null> {
    // The structural-fingerprint dedup and the versioning now happen
    // authoritatively inside publishNewVersion's advisory-locked transaction, so
    // we no longer pre-build the manifest / pre-check here (that was a redundant
    // build and a check outside any lock that two concurrent publishers could
    // both pass). publishNewVersion returns `skipped` when nothing changed.
    this.logger.log(`Auto-publishing ${courseId}: ${changeNotes}`);
    const result = await this.publishNewVersion(adminId, courseId, changeNotes);
    if (result.data && 'skipped' in result.data && result.data.skipped) {
      this.logger.log(
        `Skipped auto-publish for ${courseId}: no structural change (${changeNotes})`,
      );
      return null;
    }
    return {
      versionNumber: result.data.versionNumber,
      versionId: result.data.id,
    };
  }

  async listVersions(courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true },
    });
    if (!course) {
      throw new NotFoundException('Course not found');
    }

    const versions = await this.prisma.courseVersion.findMany({
      where: { courseId },
      orderBy: { versionNumber: 'desc' },
      include: {
        _count: { select: { enrollments: true } },
      },
    });

    return {
      message: 'Course versions retrieved',
      statusCode: 200,
      data: versions.map((v) => ({
        id: v.id,
        courseId: v.courseId,
        versionNumber: v.versionNumber,
        status: v.status,
        isLatest: v.isLatest,
        publishedAt: v.publishedAt,
        changeNotes: v.changeNotes,
        createdAt: v.createdAt,
        sectionCount: v.sectionCount,
        enrollmentCount: v._count.enrollments,
      })),
    };
  }

  async archiveVersion(adminId: string, courseId: string, versionId: string) {
    const version = await this.prisma.courseVersion.findFirst({
      where: { id: versionId, courseId },
      include: {
        _count: { select: { enrollments: true } },
      },
    });

    if (!version) {
      throw new NotFoundException('Version not found for this course');
    }

    if (version._count.enrollments > 0) {
      throw new ConflictException(
        `Cannot archive version ${version.versionNumber}: ${version._count.enrollments} enrollment(s) are pinned to it`,
      );
    }

    if (version.isLatest) {
      throw new ConflictException(
        'Cannot archive the current latest version. Publish a newer version first.',
      );
    }

    await this.prisma.courseVersion.update({
      where: { id: versionId },
      data: { status: 'ARCHIVED' },
    });

    // Audit trail: previously this admin action was silent (`void adminId`).
    await this.writeAudit({
      adminId,
      action: 'ARCHIVE_VERSION',
      targetType: 'CourseVersion',
      targetId: versionId,
      courseId,
      metadata: {
        versionNumber: version.versionNumber,
        priorStatus: version.status,
      },
    });

    return {
      message: `Version ${version.versionNumber} archived`,
      statusCode: 200,
      data: { versionId },
    };
  }

  async migrateLearnerToVersion(
    adminId: string,
    userCourseId: string,
    targetVersionId: string,
  ) {
    // Single-learner endpoint used by the roster row-action. Existing
    // behaviour preserved (allow migration to any PUBLISHED version, no
    // regression check on the row-action path — matches FE's PR 2 rollout
    // note: "Do not surface a regression preview from the row-action
    // until PR 5"; this IS PR 5 but the single-learner endpoint stays
    // regression-check-free because the FE row-action hasn't shipped a
    // preview UI. Bulk endpoint below adds regression checking on top).
    const uc = await this.prisma.userCourse.findUnique({
      where: { id: userCourseId },
      select: { id: true, courseId: true },
    });
    if (!uc) {
      throw new NotFoundException('Enrollment not found');
    }

    const target = await this.prisma.courseVersion.findFirst({
      where: {
        id: targetVersionId,
        courseId: uc.courseId,
        status: 'PUBLISHED',
      },
      select: { id: true, versionNumber: true },
    });
    if (!target) {
      throw new NotFoundException('Target version not found or not published');
    }

    await this._migrateOneLearner({
      userCourseId,
      targetVersionId: target.id,
      adminId,
      auditAction: 'MIGRATE_LEARNER_VERSION',
      auditFlags: { wouldRegress: false, forced: false },
    });

    return {
      message: `Enrollment pinned to version ${target.versionNumber}`,
      statusCode: 200,
      data: {
        userCourseId,
        enrolledVersionId: target.id,
        versionNumber: target.versionNumber,
      },
    };
  }

  /**
   * PR 5 shared core. Extracted from `migrateLearnerToVersion` so the
   * single-learner endpoint (row-action from PR 2's roster) and the
   * bulk endpoint (`migrateLearnersToVersionBulk`) share one code path.
   *
   * Runs in a per-learner interactive transaction so:
   * - The pin update and the audit row commit atomically (with the CC3
   *   caveat that audit write remains best-effort even inside the tx).
   * - A wedged learner (e.g. transient Prisma P2034 write conflict)
   *   rolls back its OWN transaction only — bulk callers can skip and
   *   proceed to the next learner rather than tearing down the batch.
   *
   * `{ timeout: 8000, maxWait: 3000 }`:
   * - timeout: 2 writes + 2 reads per learner. 8s covers a Neon cold
   *   start plus generous slack. Compare fixes doc §2's wipe-13-tables
   *   tx sized at 15s.
   * - maxWait: how long the caller waits to acquire the tx slot before
   *   Prisma throws. 3s keeps a stalled connection pool from starving
   *   the bulk loop.
   */
  private async _migrateOneLearner(params: {
    userCourseId: string;
    targetVersionId: string;
    adminId: string;
    auditAction: 'MIGRATE_LEARNER_VERSION' | 'BULK_MIGRATE_LEARNER_VERSION';
    auditFlags: { wouldRegress: boolean; forced: boolean };
  }): Promise<void> {
    // The transaction contains ONLY the pin update. The audit row is written
    // after commit — see the CC3 note below for why it must not share the tx.
    const audit = await this.prisma.$transaction(
      async (tx) => {
        const uc = await tx.userCourse.findUnique({
          where: { id: params.userCourseId },
          select: {
            id: true,
            courseId: true,
            userId: true,
            enrolledVersionId: true,
            enrolledVersion: { select: { versionNumber: true } },
          },
        });
        if (!uc) throw new Error('UserCourse not found');

        // Re-verify target belongs to the same course inside the tx —
        // guards against race where the version was archived / course
        // reassigned between the outer read and the tx begin.
        const target = await tx.courseVersion.findFirst({
          where: {
            id: params.targetVersionId,
            courseId: uc.courseId,
          },
          select: { id: true, versionNumber: true },
        });
        if (!target) throw new Error('target version invalid inside tx');

        await tx.userCourse.update({
          where: { id: params.userCourseId },
          data: { enrolledVersionId: target.id },
        });

        return {
          courseId: uc.courseId,
          userId: uc.userId,
          fromVersionId: uc.enrolledVersionId,
          fromVersionNumber: uc.enrolledVersion?.versionNumber ?? null,
          toVersionId: target.id,
          toVersionNumber: target.versionNumber,
        };
      },
      { timeout: 8000, maxWait: 3000 },
    );

    // Per-learner audit, AFTER the tx commits.
    //
    // This used to run inside the transaction with `writeAudit(entry, tx)`, on
    // the reasoning that the audit row and the pin should commit atomically
    // while the audit write stayed best-effort (CC3). On Postgres that
    // combination is not achievable: once any statement inside an interactive
    // transaction errors, the transaction is aborted and every subsequent
    // statement — including COMMIT — fails. writeAudit swallowing the error
    // cannot un-abort it, so an audit-insert failure silently ROLLED BACK the
    // migration. That is the exact opposite of CC3's intent ("a rolled-back
    // migration with no admin signal is strictly worse than a missing audit
    // row"), and it surfaced to the caller as a generic tx error naming the
    // abort rather than the audit.
    //
    // Writing after commit delivers what CC3 actually asks for: the migration
    // is durable, and a failed audit degrades to a logged warning. The trade is
    // a crash between commit and this write losing the audit row — strictly
    // better than losing the migration.
    await this.writeAudit({
      adminId: params.adminId,
      action: params.auditAction,
      targetType: 'UserCourse',
      targetId: params.userCourseId,
      courseId: audit.courseId,
      userId: audit.userId,
      metadata: {
        fromVersionId: audit.fromVersionId,
        fromVersionNumber: audit.fromVersionNumber,
        toVersionId: audit.toVersionId,
        toVersionNumber: audit.toVersionNumber,
        wouldRegress: params.auditFlags.wouldRegress,
        forced: params.auditFlags.forced,
      },
    });
  }

  /**
   * Best-effort audit write. Never throws — audit failures must not break the
   * underlying admin operation. Callers should still `await` so the row is
   * persisted within the same request lifecycle (Prisma buffers to the same
   * pool), but any error is swallowed and logged.
   *
   * Optional `tx` parameter: when provided, both the actor-email lookup and
   * the `adminAuditLog.create` run on that transaction client.
   *
   * ⚠️ Passing `tx` is NOT a way to get "atomic but best-effort" auditing —
   * on Postgres no such thing exists. A failed statement inside an interactive
   * transaction aborts it, and every later statement including COMMIT then
   * fails. Because this method swallows its error, the caller sees the audit
   * "succeed" and then loses its own writes when the tx rolls back — silently.
   *
   * So only pass `tx` when you genuinely want the audit row to be part of that
   * transaction AND are willing to lose the transaction if the audit fails.
   * When the business side effect matters more than the audit row (migrations,
   * archives — i.e. CC3's rationale in
   * `docs/course-versioning-admin-features-plan.md`), call this AFTER the
   * transaction commits, as `_migrateOneLearner` does.
   */
  async writeAudit(
    entry: {
      adminId: string;
      action: string;
      targetType: string;
      targetId?: string | null;
      courseId?: string | null;
      userId?: string | null;
      metadata?: Record<string, unknown> | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      // Denormalise the actor's email at write time so the audit row remains
      // attributable if the admin is later hard-deleted (adminId → null via
      // ON DELETE SET NULL).
      const actor = await client.user.findUnique({
        where: { id: entry.adminId },
        select: { email: true },
      });
      await client.adminAuditLog.create({
        data: {
          adminId: entry.adminId,
          adminEmail: actor?.email ?? null,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId ?? null,
          courseId: entry.courseId ?? null,
          userId: entry.userId ?? null,
          metadata: (entry.metadata as Prisma.InputJsonValue) ?? undefined,
        },
      });
    } catch (err) {
      this.logger.warn(
        `AdminAuditLog write failed (${entry.action}, target=${
          entry.targetType
        }:${entry.targetId ?? '-'}, course=${entry.courseId ?? '-'}, user=${
          entry.userId ?? '-'
        }): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async countCompletionDenominator(
    userId: string,
    courseId: string,
  ): Promise<{
    total: number;
    liveSectionIds: string[];
    quizBearingChapterIds: string[];
  }> {
    const liveDenominator = async () => {
      // Sections and quiz-bearing chapters resolve together so the two halves
      // of the completion predicate can never disagree about which tree they
      // describe. Quiz filter mirrors resolveChapterDenominator's live branch
      // (isArchived:false on quizzes) so course completion and the per-chapter
      // progression gate agree on what "has a quiz" means.
      const [liveSections, liveQuizChapters] = await Promise.all([
        this.prisma.section.findMany({
          where: {
            isActive: true,
            isArchived: false,
            chapter: {
              isArchived: false,
              module: { courseId, isArchived: false },
            },
          },
          select: { id: true },
        }),
        this.prisma.chapter.findMany({
          where: {
            isArchived: false,
            module: { courseId, isArchived: false },
            quizzes: { some: { isArchived: false } },
          },
          select: { id: true },
        }),
      ]);
      const liveSectionIds = liveSections.map((s) => s.id);
      return {
        total: liveSectionIds.length,
        liveSectionIds,
        quizBearingChapterIds: liveQuizChapters.map((c) => c.id),
      };
    };

    // Read the pin directly (one userCourse read) instead of via
    // resolveEnrolledVersionId — the version fetch below IS the existence check,
    // so we don't also need that method's separate existence probe.
    const uc = await this.prisma.userCourse.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { enrolledVersionId: true },
    });
    const enrolledVersionId = uc?.enrolledVersionId ?? null;
    if (!enrolledVersionId) {
      return liveDenominator();
    }

    // Pinned version gone, or its manifest unparseable → degrade to the LIVE
    // count. Previously this returned { total: 0 }, which corrupted the
    // completion denominator and is what forced the "load-bearing" existence
    // probe upstream. With this fallback that coupling is gone. Read the manifest
    // via the shared cache (this was the last path reading the manifest column
    // directly).
    const manifest = await loadManifestForVersion(
      this.prisma,
      enrolledVersionId,
    );
    if (!manifest) {
      return liveDenominator();
    }
    // Use ids.length (not the stored sectionCount) so total and liveSectionIds
    // are self-consistent by construction — they can't disagree.
    const ids = getSectionIdsFromManifest(manifest);

    // Chapter membership comes from the manifest (so a quiz ADDED after the
    // learner pinned cannot retroactively un-complete them), but the
    // requirement is confirmed against live quiz rows.
    //
    // Without that second step an archived quiz strands the learner forever:
    // the manifest still lists the chapter as quiz-bearing, while
    // resolveChapterQuizIds — which gates submission — drops archived/deleted
    // quizzes, so no passing QuizProgress can ever be created. The learner
    // finishes every section and is silently never stamped complete. Requiring
    // a quiz the learner cannot take is not a requirement, it is a deadlock.
    const manifestQuizChapterIds =
      getQuizBearingChapterIdsFromManifest(manifest);
    if (manifestQuizChapterIds.length === 0) {
      return {
        total: ids.length,
        liveSectionIds: ids,
        quizBearingChapterIds: [],
      };
    }
    const stillHasLiveQuiz = await this.prisma.chapter.findMany({
      where: {
        id: { in: manifestQuizChapterIds },
        quizzes: { some: { isArchived: false } },
      },
      select: { id: true },
    });
    return {
      total: ids.length,
      liveSectionIds: ids,
      quizBearingChapterIds: stillHasLiveQuiz.map((c) => c.id),
    };
  }

  async countVersionSectionsForCourse(versionId: string): Promise<number> {
    const version = await this.prisma.courseVersion.findUnique({
      where: { id: versionId },
      select: { sectionCount: true, manifest: true },
    });
    if (version?.sectionCount != null) {
      return version.sectionCount;
    }
    const manifest = parseManifest(version?.manifest);
    return manifest ? countSectionsInManifest(manifest) : 0;
  }

  buildUserModulesFromVersion(
    tree: PinnedCurriculumTree,
    progressByChapter: Map<string, number>,
    progressByModule: Map<string, number>,
  ) {
    return tree.modules.map((mod) => {
      let moduleSectionTotal = 0;
      let moduleProgressTotal = 0;

      const chapters = mod.chapters.map((ch) => {
        const sourceChapterId = ch.sourceChapterId;
        const sectionTotal = ch.sections.length;
        const progressCount = progressByChapter.get(sourceChapterId) ?? 0;
        moduleSectionTotal += sectionTotal;
        moduleProgressTotal += Math.min(progressCount, sectionTotal);

        return {
          id: sourceChapterId,
          title: ch.title,
          _count: {
            UserCourseProgress: Math.min(progressCount, sectionTotal),
            sections: sectionTotal,
            quizzes: ch.quizzes.length,
          },
          QuizProgress: [] as unknown[],
        };
      });

      return {
        id: mod.sourceModuleId,
        title: mod.title,
        chapters,
        _count: {
          UserCourseProgress: Math.min(
            progressByModule.get(mod.sourceModuleId) ?? moduleProgressTotal,
            moduleSectionTotal,
          ),
          sections: moduleSectionTotal,
        },
      };
    });
  }

  findVersionChapterBySourceId(
    tree: PinnedCurriculumTree,
    sourceChapterId: string,
  ): {
    module: PinnedCurriculumModule;
    chapter: PinnedCurriculumChapter;
  } | null {
    for (const mod of tree.modules) {
      const ch = mod.chapters.find(
        (c) => c.sourceChapterId === sourceChapterId,
      );
      if (ch) {
        return { module: mod, chapter: ch };
      }
    }
    return null;
  }

  mapVersionSectionsForLearner(sections: PinnedCurriculumSection[]) {
    return mapPinnedSectionsForLearner(sections);
  }

  mapVersionQuizzesForLearner(
    quizzes: PinnedCurriculumQuiz[],
    includeAnswers: boolean,
  ) {
    return mapPinnedQuizzesForLearner(quizzes, includeAnswers);
  }

  async summarizeNewSincePinnedVersion(
    userId: string,
    courseId: string,
    enrolledVersionId?: string | null,
  ): Promise<{
    newChapters: number;
    newSections: number;
    addedAt: Date | null;
  } | null> {
    let pinnedVersionId = enrolledVersionId;
    if (pinnedVersionId === undefined) {
      const uc = await this.prisma.userCourse.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: { enrolledVersionId: true },
      });
      pinnedVersionId = uc?.enrolledVersionId ?? null;
    }
    if (!pinnedVersionId) return null;

    const [pinnedVersion, latest] = await Promise.all([
      this.prisma.courseVersion.findUnique({
        where: { id: pinnedVersionId },
        select: { manifest: true, publishedAt: true },
      }),
      this.getLatestPublishedVersion(courseId),
    ]);

    if (!latest || latest.id === pinnedVersionId) return null;

    const pinnedManifest = parseManifest(pinnedVersion?.manifest);
    const latestManifest = parseManifest(latest.manifest);
    if (!pinnedManifest || !latestManifest) return null;

    const diff = diffManifests(pinnedManifest, latestManifest);
    if (diff.newSections === 0) return null;

    return {
      newChapters: diff.newChapters,
      newSections: diff.newSections,
      addedAt: latest.publishedAt ?? null,
    };
  }

  async isReferencedByAnyVersion(
    table: 'section' | 'chapter' | 'module' | 'quiz',
    sourceId: string,
    courseId?: string,
  ): Promise<boolean> {
    const versions = await this.prisma.courseVersion.findMany({
      where: courseId ? { courseId } : undefined,
      select: { manifest: true },
    });

    for (const v of versions) {
      const manifest = parseManifest(v.manifest);
      if (manifest && isIdReferencedInManifest(manifest, table, sourceId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Human-friendly summary line for a delete/archive response. Shared between
   * CourseService and QuizService so the wording is identical across all four
   * delete entry points.
   */
  buildArchiveMessage(
    entity: 'Module' | 'Chapter' | 'Section' | 'Quiz',
    stillServedTo: number,
    versions: Array<{ versionNumber: number }>,
  ): string {
    if (stillServedTo === 0) {
      return `Archived — ${entity.toLowerCase()} hidden from new users. No active enrollments are currently pinned to a version that still references it.`;
    }
    const versionList = versions.map((v) => `v${v.versionNumber}`).join(', ');
    const userWord = stillServedTo === 1 ? 'user' : 'users';
    return `Archived — hidden from new users, but still shown to ${stillServedTo} active ${userWord} pinned to ${versionList}. Use POST /courses/enrollments/migrate-version to move learners forward.`;
  }

  /**
   * For a given live row that was just archived, return every version that
   * still references it and how many active enrollments are pinned to those
   * versions. This is what powers the delete-response's `stillServedTo` field:
   * the admin needs to know that "archived" is not the same as "invisible" —
   * pinned learners on referencing versions will continue to see this row
   * until they are migrated or complete.
   *
   * Only PUBLISHED versions count. Archived versions can still have
   * enrollments pinned (via UserCourse.enrolledVersion), so those are counted
   * too — the point is "still served to a live human", not "still in
   * publish rotation".
   *
   * `enrollmentCount` counts **active** enrollments only (UserCourse.isActive
   * true). Deactivated and historical enrollments are not being served — the
   * learner cannot open the course — so inflating stillServedTo with them
   * would recreate the exact "how many is that really?" confusion this field
   * was built to end.
   */
  async getReferencingVersionsWithEnrollments(
    table: 'section' | 'chapter' | 'module' | 'quiz',
    sourceId: string,
    courseId?: string,
  ): Promise<{
    stillServedTo: number;
    versions: Array<{
      versionId: string;
      versionNumber: number;
      status: string;
      enrollmentCount: number;
    }>;
  }> {
    // Delegate to the batched implementation with a one-element array. Kept
    // as a thin wrapper so existing single-ID call sites (deleteModule,
    // deleteChapter, deleteSection, deleteQuiz, unAssignQuiz) don't need to
    // change shape in this PR — inventory (the O(N) caller that motivated
    // batching) is the only one paying the map-unwrap cost.
    const map = await this.getReferencingVersionsWithEnrollmentsBatch(
      table,
      [sourceId],
      courseId,
    );
    return map.get(sourceId) ?? { stillServedTo: 0, versions: [] };
  }

  /**
   * Batch variant of `getReferencingVersionsWithEnrollments`. Given N source
   * ids of the same entity type, scans every version's manifest **once** and
   * returns a `Map<sourceId, {stillServedTo, versions}>` covering all N ids.
   *
   * The archive inventory endpoint calls this once per entity type (module,
   * chapter, section, quiz) for the full page of archived rows, so a page
   * of 50 archived sections costs 1 manifest scan instead of 50.
   *
   * Semantics identical to the single-ID method: enrollmentCount is scoped
   * to `UserCourse.isActive: true`, both PUBLISHED and archived versions are
   * counted (an archived version can still pin learners via
   * `UserCourse.enrolledVersionId`), and each entry's `versions` is sorted
   * by versionNumber descending.
   */
  async getReferencingVersionsWithEnrollmentsBatch(
    table: 'section' | 'chapter' | 'module' | 'quiz',
    sourceIds: string[],
    courseId?: string,
  ): Promise<
    Map<
      string,
      {
        stillServedTo: number;
        versions: Array<{
          versionId: string;
          versionNumber: number;
          status: string;
          enrollmentCount: number;
        }>;
      }
    >
  > {
    // Pre-seed the map with empty entries for every requested id so callers
    // can `map.get(id) ?? empty` without a nullish branch.
    const result = new Map<
      string,
      {
        stillServedTo: number;
        versions: Array<{
          versionId: string;
          versionNumber: number;
          status: string;
          enrollmentCount: number;
        }>;
      }
    >();
    for (const id of sourceIds) {
      result.set(id, { stillServedTo: 0, versions: [] });
    }
    if (sourceIds.length === 0) return result;

    const versions = await this.prisma.courseVersion.findMany({
      where: courseId ? { courseId } : undefined,
      select: {
        id: true,
        versionNumber: true,
        status: true,
        manifest: true,
        _count: {
          select: { enrollments: { where: { isActive: true } } },
        },
      },
    });

    const idSet = new Set(sourceIds);

    for (const v of versions) {
      const manifest = parseManifest(v.manifest);
      if (!manifest) continue;
      // For each id, check membership in this manifest. isIdReferencedInManifest
      // is O(modules × chapters × ids-per-chapter) per call, so ideally we'd
      // walk the manifest once and collect membership for all ids in one pass.
      // But: manifest membership sets are tiny (rarely > ~500 ids total), and
      // idSet.has() is O(1), so the current shape stays readable at a
      // negligible cost. Revisit if this becomes a hot spot.
      for (const id of idSet) {
        if (!isIdReferencedInManifest(manifest, table, id)) continue;
        const entry = result.get(id)!;
        entry.versions.push({
          versionId: v.id,
          versionNumber: v.versionNumber,
          status: v.status,
          enrollmentCount: v._count.enrollments,
        });
        entry.stillServedTo += v._count.enrollments;
      }
    }

    for (const entry of result.values()) {
      entry.versions.sort((a, b) => b.versionNumber - a.versionNumber);
    }
    return result;
  }

  /**
   * Human-friendly note attached to a successful restore response. The FE
   * renders it as a secondary line beneath the "Restored" toast so the admin
   * understands whether the newly-restored row is actually visible to new
   * learners yet.
   *
   * A restore only flips `isArchived: false` — it does NOT publish a new
   * version. Until the admin publishes, new enrollments still pin to the
   * latest published version, which does not reference the restored row.
   * The note is only omitted when the latest published version already
   * references this row (i.e. the row was archived after publishing and
   * survived in the pinned manifest anyway).
   */
  buildRestoreNote(latestVersionNumber: number | null | undefined): string {
    if (!latestVersionNumber) {
      return 'Restored to the live tree. No published versions exist yet — publish a new version to make this row visible to new enrollments.';
    }
    return `Restored to the live tree. Latest published version (v${latestVersionNumber}) does not reference this row; new enrollments will not see it until you publish a new version.`;
  }

  // ────────────────────────────────────────────────────────────────────
  // PR 2 — Roster
  //
  // Answers "who is on which version of this course, how far along, are
  // they behind latest?". Single biggest admin-visibility gap identified
  // in the pre-PR-1 sweep — before this, `GET /courses/report/:courseId/:userId`
  // returned per-learner data but there was no way to enumerate learners.
  //
  // Query budget: 5 per request regardless of pageSize. Latest version
  // (1), page rows + count in parallel (2), progress groupBy (1),
  // completion findMany (1). No per-row queries.
  //
  // Percentage-sort branch overfetches all matching rows because we don't
  // (yet) have a materialized `UserCourse.percentage` column. Acceptable
  // at current scale (largest course ~2k learners); the materialized-
  // column escape hatch is a scale followup, tracked in PR 2 risks in
  // docs/course-versioning-admin-features-plan.md.
  // ────────────────────────────────────────────────────────────────────

  async getRoster(
    courseId: string,
    opts: {
      page?: number;
      pageSize?: number;
      sort?: string;
      search?: string;
      versionFilter?: string;
    },
  ): Promise<{
    message: string;
    statusCode: number;
    data: {
      latestPublishedVersionId: string | null;
      latestPublishedVersionNumber: number | null;
      rows: Array<{
        userId: string;
        userLabel: string;
        email: string;
        enrolledVersionId: string | null;
        enrolledVersionNumber: number | null;
        percentage: number;
        isCompleted: boolean;
        isActive: boolean;
        isPaid: boolean;
      }>;
      total: number;
      page: number;
      pageSize: number;
    };
  }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const sort = opts.sort || 'percentage:desc';
    const search = opts.search?.trim() || undefined;

    // Phase 1: latest published version. Single query. Used for the
    // top-level `latestPublishedVersionId` field — FE derives per-row
    // "is on latest?" from that top-level field, not a per-row flag, so a
    // publish landing mid-page never produces inconsistent rows.
    const latest = await this.prisma.courseVersion.findFirst({
      where: { courseId, status: 'PUBLISHED' },
      orderBy: { versionNumber: 'desc' },
      select: { id: true, versionNumber: true },
    });

    // Phase 2: rows + count. `sortIsPercentage` decides whether we can
    // paginate in the DB (fast, bounded) or must overfetch and sort in
    // memory (slow at scale; tolerable at current scale).
    const sortIsPercentage =
      sort === 'percentage:desc' || sort === 'percentage:asc';

    // Whitelist: any unknown non-percentage sort falls back to email:asc
    // rather than injecting untrusted strings into orderBy.
    const orderBy = this._buildRosterOrderBy(sort);

    const searchWhere = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            {
              firstName: {
                contains: search,
                mode: 'insensitive' as const,
              },
            },
            {
              lastName: { contains: search, mode: 'insensitive' as const },
            },
          ],
        }
      : undefined;

    // Soft-deleted users don't appear in the roster — per decision 6, an
    // admin should not see rows for accounts that have been anonymised or
    // deleted. Sub-select the `user` filter so the join enforces it.
    const userFilter = searchWhere
      ? { deletedAt: null, ...searchWhere }
      : { deletedAt: null };

    const whereClause: Prisma.UserCourseWhereInput = {
      courseId,
      user: userFilter,
      ...(opts.versionFilter ? { enrolledVersionId: opts.versionFilter } : {}),
    };

    // Select shape as a const so both branches (paginated in DB /
    // overfetched for percentage sort) produce the same Prisma payload
    // type. Without the `as const` narrowing, Prisma's return type
    // widens to the full UserCourse row and TS loses the joined
    // user/enrolledVersion fields.
    const rosterSelect = {
      userId: true,
      isActive: true,
      isPaid: true,
      enrolledVersionId: true,
      user: { select: { email: true, firstName: true, lastName: true } },
      enrolledVersion: {
        select: { versionNumber: true, sectionCount: true },
      },
    } as const;

    const [rowsRaw, total] = await Promise.all([
      sortIsPercentage
        ? this.prisma.userCourse.findMany({
            where: whereClause,
            select: rosterSelect,
          })
        : this.prisma.userCourse.findMany({
            where: whereClause,
            select: rosterSelect,
            orderBy,
            take: pageSize,
            skip: (page - 1) * pageSize,
          }),
      this.prisma.userCourse.count({ where: whereClause }),
    ]);

    // Phase 3: percentages via the shared engine.
    //
    // This used to assemble the ratio here: a numerator from a groupBy
    // filtered to LIVE sections, over a denominator taken from the pinned
    // version's frozen `sectionCount`. Those two describe different trees,
    // so a learner who completed all 12 sections of v3 read 92% once one of
    // them was archived — while the completion gate, deriving both halves
    // from the manifest, considered them done. computeLearnerPercentages
    // derives both halves from one view, so that mismatch cannot recur here.
    // Pins are already on the paginated rows, so pass them through rather
    // than making the engine re-query userCourse.
    const percentages = await computeLearnerPercentages(
      this.prisma,
      rowsRaw.map((r) => ({
        userId: r.userId,
        courseId,
        enrolledVersionId: r.enrolledVersionId ?? null,
      })),
    );

    // Phase 4: build typed rows.
    const rows = rowsRaw.map((r) => {
      const p = percentages.get(percentageKey(r.userId, courseId));
      const userLabel =
        [r.user.firstName, r.user.lastName].filter(Boolean).join(' ') ||
        r.user.email;
      return {
        userId: r.userId,
        userLabel,
        email: r.user.email,
        enrolledVersionId: r.enrolledVersionId,
        enrolledVersionNumber: r.enrolledVersion?.versionNumber ?? null,
        percentage: p?.percentage ?? 0,
        isCompleted: p?.isCompleted ?? false,
        isActive: r.isActive,
        isPaid: r.isPaid,
      };
    });

    // Percentage-sort branch: sort the overfetched N in memory, then
    // slice. Secondary sort by email for a deterministic order on ties
    // (many learners at 100% is common; without a tiebreaker the page
    // shuffles between requests).
    let paged: typeof rows;
    if (sortIsPercentage) {
      const dir = sort === 'percentage:asc' ? 1 : -1;
      rows.sort((a, b) => {
        const d = (a.percentage - b.percentage) * dir;
        return d !== 0 ? d : a.email.localeCompare(b.email);
      });
      paged = rows.slice((page - 1) * pageSize, page * pageSize);
    } else {
      paged = rows;
    }

    return {
      message: 'OK',
      statusCode: 200,
      data: {
        latestPublishedVersionId: latest?.id ?? null,
        latestPublishedVersionNumber: latest?.versionNumber ?? null,
        rows: paged,
        total,
        page,
        pageSize,
      },
    };
  }

  /**
   * Translate the roster's `sort` query param into a Prisma orderBy. Any
   * unknown sort key falls back to email:asc — an admin passing a typo
   * gets a stable order instead of a 500.
   */
  private _buildRosterOrderBy(
    sort: string,
  ): Prisma.UserCourseOrderByWithRelationInput {
    switch (sort) {
      case 'email:asc':
        return { user: { email: 'asc' } };
      case 'email:desc':
        return { user: { email: 'desc' } };
      case 'enrolledVersionNumber:asc':
        return { enrolledVersion: { versionNumber: 'asc' } };
      case 'enrolledVersionNumber:desc':
        return { enrolledVersion: { versionNumber: 'desc' } };
      // isCompleted is derived (join to CourseCompletion) — can't
      // orderBy it directly. Fall back to createdAt for now; PR 5 or a
      // schema change can materialise `isCompleted` on UserCourse if
      // this becomes a common admin sort.
      case 'isCompleted:asc':
      case 'isCompleted:desc':
        return { createdAt: sort === 'isCompleted:desc' ? 'desc' : 'asc' };
      default:
        return { user: { email: 'asc' } };
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // PR 3 — Version tree + diff
  //
  // getVersionTree: titled Module → Chapter → { Sections, Quizzes } tree
  // for one specific version. `listVersions` (already exists) omits the
  // manifest entirely, so without this endpoint the admin has no way to
  // see what's inside a version.
  //
  // diffVersionsTitled: added/removed/moved/renamed lists between two
  // versions. Renames are always empty in the current schema (titles
  // aren't snapshotted per version); the bucket stays in the response
  // shape so a future manifest-title snapshot lights it up without a
  // contract change.
  // ────────────────────────────────────────────────────────────────────

  async getVersionTree(
    courseId: string,
    versionId: string,
  ): Promise<{
    message: string;
    statusCode: number;
    data: {
      versionId: string;
      versionNumber: number;
      status: string;
      publishedAt: Date | null;
      modules: Array<{
        id: string;
        sourceId: string;
        title: string;
        orderIndex: number;
        chapters: Array<{
          id: string;
          sourceId: string;
          title: string;
          orderIndex: number;
          hasQuiz: boolean;
          sections: Array<{
            id: string;
            sourceId: string;
            title: string;
            type: string;
            orderIndex: number | null;
          }>;
          quizzes: Array<{
            id: string;
            sourceId: string;
            question: string;
            orderIndex: number | null;
          }>;
        }>;
      }>;
    };
  }> {
    // Scope by courseId AND id so an admin can't peek at a version from a
    // different course by guessing its uuid.
    const version = await this.prisma.courseVersion.findFirst({
      where: { id: versionId, courseId },
      select: {
        id: true,
        versionNumber: true,
        status: true,
        publishedAt: true,
      },
    });
    if (!version) {
      throw new NotFoundException(
        `Version ${versionId} not found for course ${courseId}`,
      );
    }

    // loadPinnedCurriculum hydrates the manifest into titled tree via
    // live-table lookups. Includes section body/config which is heavier
    // than we strictly need — acceptable for an admin-only endpoint that
    // fires at most once per admin tree-view.
    const tree = await loadPinnedCurriculum(this.prisma, versionId);
    if (!tree) {
      // Version row exists but manifest is unparseable / missing. Treat
      // as an empty tree rather than a 500 so the FE can render a
      // clear "empty version" state.
      return {
        message: 'OK',
        statusCode: 200,
        data: {
          versionId: version.id,
          versionNumber: version.versionNumber,
          status: version.status,
          publishedAt: version.publishedAt,
          modules: [],
        },
      };
    }

    // Manifest-only schema note: there is no separate `CourseVersionModule`
    // frozen-row-id — `id` and `sourceId` are the same value. The FE spec
    // ships both fields for future compatibility with a normalised-version
    // schema; here they are identical by construction.
    return {
      message: 'OK',
      statusCode: 200,
      data: {
        versionId: version.id,
        versionNumber: version.versionNumber,
        status: version.status,
        publishedAt: version.publishedAt,
        modules: tree.modules.map((m) => ({
          id: m.sourceModuleId,
          sourceId: m.sourceModuleId,
          title: m.title,
          orderIndex: m.orderIndex,
          chapters: m.chapters.map((c) => ({
            id: c.sourceChapterId,
            sourceId: c.sourceChapterId,
            title: c.title,
            orderIndex: c.orderIndex,
            hasQuiz: c.quizzes.length > 0,
            sections: c.sections.map((s) => ({
              id: s.id,
              sourceId: s.id,
              title: s.title,
              type: s.type,
              orderIndex: s.orderIndex,
            })),
            quizzes: c.quizzes.map((q) => ({
              id: q.id,
              sourceId: q.id,
              question: q.question,
              orderIndex: null, // Quiz.orderIndex isn't on the pinned type;
              // pull from live if needed by the FE.
            })),
          })),
        })),
      },
    };
  }

  async diffVersionsTitled(
    courseId: string,
    fromVersionId: string,
    toVersionId: string,
  ): Promise<{
    message: string;
    statusCode: number;
    data: {
      fromVersionNumber: number;
      toVersionNumber: number;
    } & DiffTitledResult;
  }> {
    const [from, to] = await Promise.all([
      this.prisma.courseVersion.findFirst({
        where: { id: fromVersionId, courseId },
        select: { versionNumber: true, manifest: true },
      }),
      this.prisma.courseVersion.findFirst({
        where: { id: toVersionId, courseId },
        select: { versionNumber: true, manifest: true },
      }),
    ]);
    if (!from) {
      throw new NotFoundException(
        `Version ${fromVersionId} not found for course ${courseId}`,
      );
    }
    if (!to) {
      throw new NotFoundException(
        `Version ${toVersionId} not found for course ${courseId}`,
      );
    }

    const fromManifest = parseManifest(from.manifest);
    const toManifest = parseManifest(to.manifest);
    if (!fromManifest || !toManifest) {
      // At least one manifest failed to parse — return an empty diff
      // with the version numbers so the FE can render a clear "cannot
      // diff, one side has an invalid manifest" state.
      return {
        message: 'OK',
        statusCode: 200,
        data: {
          fromVersionNumber: from.versionNumber,
          toVersionNumber: to.versionNumber,
          added: [],
          removed: [],
          moved: [],
          renamed: [],
        },
      };
    }

    // Union of all sourceIds appearing in either manifest — this is the
    // set of ids we need titles for. Fetched with 4 batched findMany
    // calls (one per entity type) so the diff endpoint's DB budget is
    // fixed regardless of how many entities appear in the manifests.
    const moduleIds = new Set<string>();
    const chapterIds = new Set<string>();
    const sectionIds = new Set<string>();
    const quizIds = new Set<string>();
    for (const m of [...fromManifest.modules, ...toManifest.modules]) {
      moduleIds.add(m.sourceId);
      for (const ch of m.chapters) {
        chapterIds.add(ch.sourceId);
        for (const sid of ch.sectionIds) sectionIds.add(sid);
        for (const qid of ch.quizIds) quizIds.add(qid);
      }
    }

    const [modules, chapters, sections, quizzes] = await Promise.all([
      moduleIds.size > 0
        ? this.prisma.module.findMany({
            where: { id: { in: Array.from(moduleIds) } },
            select: { id: true, title: true },
          })
        : Promise.resolve([] as Array<{ id: string; title: string }>),
      chapterIds.size > 0
        ? this.prisma.chapter.findMany({
            where: { id: { in: Array.from(chapterIds) } },
            select: { id: true, title: true },
          })
        : Promise.resolve([] as Array<{ id: string; title: string }>),
      sectionIds.size > 0
        ? this.prisma.section.findMany({
            where: { id: { in: Array.from(sectionIds) } },
            select: { id: true, title: true },
          })
        : Promise.resolve([] as Array<{ id: string; title: string }>),
      quizIds.size > 0
        ? this.prisma.quiz.findMany({
            where: { id: { in: Array.from(quizIds) } },
            select: { id: true, question: true },
          })
        : Promise.resolve([] as Array<{ id: string; question: string }>),
    ]);

    const titles = new Map<string, string>();
    for (const m of modules) titles.set(m.id, m.title);
    for (const c of chapters) titles.set(c.id, c.title);
    for (const s of sections) titles.set(s.id, s.title);
    for (const q of quizzes) {
      // Quiz's "title" is the question text — trim to a reasonable snippet
      // so the diff response doesn't balloon with essay-length questions.
      const snippet =
        q.question.length > 120 ? q.question.slice(0, 120) + '…' : q.question;
      titles.set(q.id, snippet);
    }

    const diff = diffManifestsTitled(fromManifest, toManifest, titles);

    return {
      message: 'OK',
      statusCode: 200,
      data: {
        fromVersionNumber: from.versionNumber,
        toVersionNumber: to.versionNumber,
        ...diff,
      },
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // PR 4 — Coverage + Drift
  //
  // Two read-only endpoints, both thin wrappers over existing logic:
  // - getCoverage: ports scripts/_audit-version-coverage.ts to an admin
  //   GET endpoint. Surfaces active enrollments with a null pin (the
  //   "unpinned learner" bug signal) + courses missing v1 snapshot.
  // - getDrift: ports the reconcile CLI's fingerprint compare to a
  //   read-only admin GET. Reports hasDrift + a 4-bucket changeCount
  //   using the same diff logic as PR 3.
  //
  // Reconcile itself (POST /versions/reconcile) stays CLI-only per
  // decisions §7 — a mutation this consequential shouldn't be a click
  // away from the admin roster.
  // ────────────────────────────────────────────────────────────────────

  async getCoverage(): Promise<{
    message: string;
    statusCode: number;
    data: {
      rows: Array<{
        courseId: string;
        courseTitle: string;
        activeEnrollmentsWithNullPin: number;
      }>;
      coursesWithoutV1: Array<{ courseId: string; courseTitle: string }>;
    };
  }> {
    // Two signals in parallel:
    // 1) UserCourse rows that are isActive: true but pinned to no
    //    version — the "unpinned active learner" bug (see
    //    scripts/_audit-version-coverage.ts). Should be zero in a
    //    healthy system; nonzero rows indicate learners activated
    //    before their course had a v1 snapshot.
    // 2) Courses that have never had a v1 published — a course can
    //    exist in the DB without any published version, in which case
    //    all its enrollments are unpinned by construction. Cross-check
    //    to help admins prioritise which unpinned rows are structural
    //    vs. learner-specific.
    const [unpinnedGroups, coursesWithoutV1] = await Promise.all([
      this.prisma.userCourse.groupBy({
        by: ['courseId'],
        where: { isActive: true, enrolledVersionId: null },
        _count: { _all: true },
      }),
      // A course has no v1 if none of its versions carry versionNumber=1.
      // (Version numbering is dense from 1 per course, so absence of a
      // v1 row is definitive.)
      this.prisma.course.findMany({
        where: {
          courseVersions: {
            none: { versionNumber: 1 },
          },
        },
        select: { id: true, title: true },
        orderBy: { title: 'asc' },
      }),
    ]);

    // Resolve course titles for the unpinned groups in one batch.
    const courseIds = unpinnedGroups.map((u) => u.courseId);
    const titles = courseIds.length
      ? await this.prisma.course.findMany({
          where: { id: { in: courseIds } },
          select: { id: true, title: true },
        })
      : [];
    const titleById = new Map(titles.map((c) => [c.id, c.title]));

    const rows = unpinnedGroups
      .map((u) => ({
        courseId: u.courseId,
        courseTitle: titleById.get(u.courseId) ?? '(unknown)',
        activeEnrollmentsWithNullPin: u._count._all,
      }))
      // Highest count first so admin triages the worst offender first.
      .sort(
        (a, b) =>
          b.activeEnrollmentsWithNullPin - a.activeEnrollmentsWithNullPin,
      );

    return {
      message: 'OK',
      statusCode: 200,
      data: {
        rows,
        coursesWithoutV1: coursesWithoutV1.map((c) => ({
          courseId: c.id,
          courseTitle: c.title,
        })),
      },
    };
  }

  async getDrift(courseId: string): Promise<{
    message: string;
    statusCode: number;
    data: {
      hasDrift: boolean;
      changeCount: {
        added: number;
        removed: number;
        moved: number;
        renamed: number;
      };
      latestPublishedVersionId: string | null;
      latestPublishedVersionNumber: number | null;
      latestPublishedAt: Date | null;
      liveFingerprint: string;
      publishedFingerprint: string | null;
    };
  }> {
    const [latest, liveManifest] = await Promise.all([
      this.prisma.courseVersion.findFirst({
        where: { courseId, status: 'PUBLISHED' },
        orderBy: { versionNumber: 'desc' },
        select: {
          id: true,
          versionNumber: true,
          publishedAt: true,
          manifest: true,
        },
      }),
      buildManifestFromLiveTree(this.prisma, courseId),
    ]);

    const liveFingerprint = computeStructuralFingerprint(liveManifest.manifest);

    // No published versions yet — everything in the live tree is "added"
    // relative to an empty published side. changeCount reflects that.
    // Titles map intentionally empty: the drift endpoint only cares about
    // bucket lengths, not the display strings inside each bucket entry.
    // Callers that want titled per-entry lists use PR 3's diff endpoint.
    const emptyTitles = new Map<string, string>();
    if (!latest) {
      const emptyManifest = { modules: [] };
      const { added, removed, moved, renamed } = diffManifestsTitled(
        emptyManifest,
        liveManifest.manifest,
        emptyTitles,
      );
      return {
        message: 'OK',
        statusCode: 200,
        data: {
          hasDrift: liveManifest.manifest.modules.length > 0,
          changeCount: {
            added: added.length,
            removed: removed.length,
            moved: moved.length,
            renamed: renamed.length,
          },
          latestPublishedVersionId: null,
          latestPublishedVersionNumber: null,
          latestPublishedAt: null,
          liveFingerprint,
          publishedFingerprint: null,
        },
      };
    }

    const publishedManifest = parseManifest(latest.manifest);
    if (!publishedManifest) {
      // Latest published row exists but its manifest is unparseable.
      // Emit an explicit drift signal so an admin surfaces this as a
      // data-integrity issue rather than getting a silent 500.
      return {
        message: 'OK',
        statusCode: 200,
        data: {
          hasDrift: true,
          changeCount: { added: 0, removed: 0, moved: 0, renamed: 0 },
          latestPublishedVersionId: latest.id,
          latestPublishedVersionNumber: latest.versionNumber,
          latestPublishedAt: latest.publishedAt,
          liveFingerprint,
          publishedFingerprint: null,
        },
      };
    }

    const publishedFingerprint =
      computeStructuralFingerprint(publishedManifest);
    const { added, removed, moved, renamed } = diffManifestsTitled(
      publishedManifest,
      liveManifest.manifest,
      emptyTitles,
    );
    const changeCount = {
      added: added.length,
      removed: removed.length,
      moved: moved.length,
      renamed: renamed.length,
    };

    // Invariant: hasDrift derives from the fingerprint compare (fast
    // path — no diff-tree walk) but MUST match sum(changeCount) > 0.
    // Both are computed from the same manifest pair, so they can only
    // diverge if `computeStructuralFingerprint` and `diffManifestsTitled`
    // disagree about what counts as structural — which would itself be a
    // bug we want to surface. Pinned in the getDrift invariant test.
    const hasDrift = liveFingerprint !== publishedFingerprint;

    return {
      message: 'OK',
      statusCode: 200,
      data: {
        hasDrift,
        changeCount,
        latestPublishedVersionId: latest.id,
        latestPublishedVersionNumber: latest.versionNumber,
        latestPublishedAt: latest.publishedAt,
        liveFingerprint,
        publishedFingerprint,
      },
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // PR 5 — Bulk migration
  //
  // Migrate many learners to a target version in one API call, with a
  // dry-run preview showing each learner's before/after percentage and
  // whether they would regress.
  //
  // Design goals:
  // - Regression preview: default deny, opt-in via acceptRegressionFor.
  //   A migration that drops a certified learner from 100% to 66% is
  //   the exact bug versioning exists to prevent — surface it, don't
  //   apply it silently.
  // - Per-learner mini-transactions: one wedged learner rolls back
  //   ITS OWN tx only. Other N-1 proceed. Bulk endpoint returns a
  //   skipped[] entry with errorMessage for the failure and continues.
  // - Best-effort audit per learner (CC3 + FE review #3): audit write
  //   inside the tx, but audit failures don't roll back migrations.
  //
  // Guardrails:
  // - Batch ceiling: 500 learners per call. Multi-batch to migrate
  //   larger sets. Configurable if real usage shows friction.
  // - Dry-run summary counts wouldRegress and certifiedAndWouldRegress
  //   so admin can spot the "100% learner about to drop" cases up front.
  // ────────────────────────────────────────────────────────────────────

  async migrateLearnersToVersionBulk(
    adminId: string,
    courseId: string,
    params: {
      userIds: string[];
      targetVersionId: string;
      dryRun: boolean;
      acceptRegressionFor?: string[];
    },
  ): Promise<{
    message: string;
    statusCode: number;
    data:
      | {
          dryRun: true;
          targetVersionNumber: number;
          results: Array<{
            userId: string;
            userLabel: string;
            email: string;
            fromVersionId: string | null;
            fromVersionNumber: number | null;
            fromSectionCount: number | null;
            toSectionCount: number | null;
            currentPercentage: number;
            projectedPercentage: number;
            wouldRegress: boolean;
            isCertified: boolean;
          }>;
          summary: {
            total: number;
            wouldRegress: number;
            certifiedAndWouldRegress: number;
            notEnrolled: number;
            alreadyOnTarget: number;
          };
        }
      | {
          dryRun: false;
          migrated: string[];
          skipped: Array<{
            userId: string;
            reason:
              | 'would_regress_not_accepted'
              | 'migration_failed'
              | 'user_not_enrolled'
              | 'already_on_target_version';
            errorMessage?: string;
          }>;
        };
  }> {
    const CEILING = 500;
    // Dedupe up front so a duplicate userId isn't attempted twice (which
    // would produce a duplicate audit row + a spurious
    // already_on_target_version on the second pass).
    const userIds = Array.from(new Set(params.userIds));
    if (userIds.length > CEILING) {
      throw new HttpException(
        {
          status: 400,
          error: 'Batch size exceeds ceiling',
          details: { ceiling: CEILING, requested: userIds.length },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Resolve target version + validate it belongs to courseId. Allow
    // both PUBLISHED and ARCHIVED targets — migrating to an archived
    // version is a legit ops motion (backwards migrate a learner to an
    // older frozen curriculum for compliance/appeals).
    const target = await this.prisma.courseVersion.findFirst({
      where: { id: params.targetVersionId, courseId },
      select: { id: true, versionNumber: true, sectionCount: true },
    });
    if (!target) {
      throw new NotFoundException(
        `Target version ${params.targetVersionId} not found for course ${courseId}`,
      );
    }

    // Preload everything needed for per-learner projection in three
    // batched queries. Fixed cost regardless of userIds.length within
    // the CEILING.
    const [enrollments, completions] = await Promise.all([
      userIds.length
        ? this.prisma.userCourse.findMany({
            where: { courseId, userId: { in: userIds } },
            select: {
              id: true,
              userId: true,
              enrolledVersionId: true,
              user: {
                select: {
                  email: true,
                  firstName: true,
                  lastName: true,
                  deletedAt: true,
                },
              },
              enrolledVersion: {
                select: { versionNumber: true, sectionCount: true },
              },
            },
          })
        : Promise.resolve([] as any[]),
      userIds.length
        ? this.prisma.courseCompletion.findMany({
            where: {
              courseId,
              userId: { in: userIds },
              courseCompletedAt: { not: null },
            },
            select: { userId: true },
          })
        : Promise.resolve([] as Array<{ userId: string }>),
    ]);

    // Current percentages come from the shared engine so `currentPercentage`
    // is scoped exactly like the roster and the completion gate. This is not
    // cosmetic: an understated current percentage makes
    // `projectedPct < currentPct` LESS likely to fire, so the default-deny
    // regression guard silently under-triggers and a migration that really
    // does regress a learner can slip through.
    //
    // Runs after the enrollment fetch so the pins can be passed through
    // instead of re-queried.
    const percentages = await computeLearnerPercentages(
      this.prisma,
      enrollments.map((e: any) => ({
        userId: e.userId,
        courseId,
        enrolledVersionId: e.enrolledVersionId ?? null,
      })),
    );

    // Projected percentage is measured against the TARGET version's section
    // ids — the curriculum the learner would land on. Loaded once for the
    // batch (immutable + cached), then intersected with each learner's
    // progress, so the projection is scoped the same way the current
    // percentage is rather than dividing by a bare count.
    const targetManifest = await loadManifestForVersion(
      this.prisma,
      params.targetVersionId,
    );
    const targetSectionIds = targetManifest
      ? getSectionIdsFromManifest(targetManifest)
      : null;
    const targetSectionIdSet = targetSectionIds
      ? new Set(targetSectionIds)
      : null;

    const progressedByUser = new Map<string, Set<string>>();
    if (userIds.length && targetSectionIdSet) {
      const rows = await this.prisma.userCourseProgress.findMany({
        where: {
          courseId,
          userId: { in: userIds },
          sectionId: { in: Array.from(targetSectionIdSet) },
        },
        select: { userId: true, sectionId: true },
        distinct: ['userId', 'sectionId'],
      });
      for (const row of rows) {
        const set = progressedByUser.get(row.userId) ?? new Set<string>();
        set.add(row.sectionId);
        progressedByUser.set(row.userId, set);
      }
    }

    const enrollmentByUserId = new Map(
      enrollments.map((e: any) => [e.userId, e]),
    );
    const certifiedSet = new Set(completions.map((c) => c.userId));

    // Per-learner decision + projection. `decision` drives whether the
    // real-run path attempts a migration for this learner.
    type ProjectedRow = {
      decision: 'projected';
      userId: string;
      userCourseId: string;
      userLabel: string;
      email: string;
      fromVersionId: string | null;
      fromVersionNumber: number | null;
      fromSectionCount: number | null;
      toSectionCount: number | null;
      currentPercentage: number;
      projectedPercentage: number;
      wouldRegress: boolean;
      isCertified: boolean;
    };
    // Split into two SkipRow variants (one per discriminator) so TS
    // narrows to ProjectedRow correctly after the two continues in the
    // real-run loop. A single SkipRow with a union `decision` field
    // leaves the union un-narrowable — Prisma's clientExtension typing
    // has the same shape and the same workaround.
    type SkipRowNotEnrolled = {
      decision: 'user_not_enrolled';
      userId: string;
    };
    type SkipRowAlreadyOnTarget = {
      decision: 'already_on_target_version';
      userId: string;
    };
    type Projection =
      | ProjectedRow
      | SkipRowNotEnrolled
      | SkipRowAlreadyOnTarget;

    const projections: Projection[] = userIds.map((uid): Projection => {
      const e = enrollmentByUserId.get(uid);
      // Missing enrollment OR soft-deleted user → skip. deletedAt users
      // don't appear in the roster (PR 2), so getting one here likely
      // means the FE passed a stale id.
      if (!e || e.user.deletedAt) {
        return { decision: 'user_not_enrolled', userId: uid };
      }
      if (e.enrolledVersionId === params.targetVersionId) {
        return { decision: 'already_on_target_version', userId: uid };
      }

      const isCertified = certifiedSet.has(uid);
      const current = percentages.get(percentageKey(uid, courseId));

      // Current: from the shared engine (numerator and denominator both from
      // the learner's own curriculum). Reported denominator mirrors it, so
      // fromSectionCount and currentPercentage can't describe different trees.
      const fromDenom = current?.denominator ?? null;
      const currentPct = current?.percentage ?? 0;

      // Projected: the learner's progress intersected with the TARGET
      // version's section ids, over that version's section count. Falls back
      // to the stored sectionCount only when the target manifest is
      // unresolvable, which also makes the projection unmeasurable — in that
      // case we report the current percentage rather than inventing a drop.
      const toDenom = targetSectionIds
        ? targetSectionIds.length
        : target.sectionCount ?? null;
      const done = progressedByUser.get(uid);
      const projectedNumer = targetSectionIds
        ? targetSectionIds.reduce((n, id) => (done?.has(id) ? n + 1 : n), 0)
        : 0;

      // Completers clamp to 100 in both current and projected. Matches
      // roster/completion-gate semantics — a certified learner never
      // shows <100 no matter what the raw numerator says.
      const projectedPct = isCertified
        ? 100
        : !targetSectionIds
          ? currentPct
          : toDenom && toDenom > 0
            ? Math.min(100, Math.round((projectedNumer * 100) / toDenom))
            : 0;

      const wouldRegress = projectedPct < currentPct;

      return {
        decision: 'projected',
        userId: uid,
        userCourseId: e.id,
        userLabel:
          [e.user.firstName, e.user.lastName].filter(Boolean).join(' ') ||
          e.user.email,
        email: e.user.email,
        fromVersionId: e.enrolledVersionId,
        fromVersionNumber: e.enrolledVersion?.versionNumber ?? null,
        fromSectionCount: fromDenom,
        toSectionCount: toDenom,
        currentPercentage: currentPct,
        projectedPercentage: projectedPct,
        wouldRegress,
        isCertified,
      };
    });

    // Dry run — return the projection table + summary. No mutation, no
    // audit row. This is what powers the FE's confirmation modal
    // BEFORE the admin clicks "Migrate N learners".
    if (params.dryRun) {
      const projected = projections.filter(
        (p): p is ProjectedRow => p.decision === 'projected',
      );
      const results = projected.map((p) => ({
        userId: p.userId,
        userLabel: p.userLabel,
        email: p.email,
        fromVersionId: p.fromVersionId,
        fromVersionNumber: p.fromVersionNumber,
        fromSectionCount: p.fromSectionCount,
        toSectionCount: p.toSectionCount,
        currentPercentage: p.currentPercentage,
        projectedPercentage: p.projectedPercentage,
        wouldRegress: p.wouldRegress,
        isCertified: p.isCertified,
      }));
      return {
        message: 'Dry run',
        statusCode: 200,
        data: {
          dryRun: true,
          targetVersionNumber: target.versionNumber,
          results,
          summary: {
            total: userIds.length,
            wouldRegress: results.filter((r) => r.wouldRegress).length,
            certifiedAndWouldRegress: results.filter(
              (r) => r.wouldRegress && r.isCertified,
            ).length,
            notEnrolled: projections.filter(
              (p) => p.decision === 'user_not_enrolled',
            ).length,
            alreadyOnTarget: projections.filter(
              (p) => p.decision === 'already_on_target_version',
            ).length,
          },
        },
      };
    }

    // Real run — one interactive tx per learner via _migrateOneLearner.
    // Accepted regressions come from acceptRegressionFor; anything not
    // in that set that would regress is skipped rather than silently
    // applying the percentage drop.
    const accepted = new Set(params.acceptRegressionFor ?? []);
    const migrated: string[] = [];
    const skipped: Array<{
      userId: string;
      reason:
        | 'would_regress_not_accepted'
        | 'migration_failed'
        | 'user_not_enrolled'
        | 'already_on_target_version';
      errorMessage?: string;
    }> = [];

    for (const p of projections) {
      if (p.decision === 'user_not_enrolled') {
        skipped.push({ userId: p.userId, reason: 'user_not_enrolled' });
        continue;
      }
      if (p.decision === 'already_on_target_version') {
        skipped.push({
          userId: p.userId,
          reason: 'already_on_target_version',
        });
        continue;
      }
      // p.decision === 'projected'
      if (p.wouldRegress && !accepted.has(p.userId)) {
        skipped.push({
          userId: p.userId,
          reason: 'would_regress_not_accepted',
        });
        continue;
      }

      try {
        await this._migrateOneLearner({
          userCourseId: p.userCourseId,
          targetVersionId: params.targetVersionId,
          adminId,
          auditAction: 'BULK_MIGRATE_LEARNER_VERSION',
          auditFlags: {
            wouldRegress: p.wouldRegress,
            forced: p.wouldRegress && accepted.has(p.userId),
          },
        });
        migrated.push(p.userId);
      } catch (err) {
        skipped.push({
          userId: p.userId,
          reason: 'migration_failed',
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      message: 'Bulk migration complete',
      statusCode: 200,
      data: {
        dryRun: false,
        migrated,
        skipped,
      },
    };
  }

  async pruneOrphanVersions(courseId?: string): Promise<{
    message: string;
    statusCode: number;
    data: { deleted: number; versionNumbers: number[] };
  }> {
    const versions = await this.prisma.courseVersion.findMany({
      where: courseId ? { courseId } : undefined,
      orderBy: { versionNumber: 'asc' },
      include: { _count: { select: { enrollments: true } } },
    });

    const toDelete = versions.filter(
      (v) => v._count.enrollments === 0 && !v.isLatest,
    );

    for (const v of toDelete) {
      await this.prisma.courseVersion.delete({ where: { id: v.id } });
    }

    return {
      message: `Pruned ${toDelete.length} orphan version(s)`,
      statusCode: 200,
      data: {
        deleted: toDelete.length,
        versionNumbers: toDelete.map((v) => v.versionNumber),
      },
    };
  }

  /** Manifest helpers exposed for chapter progression. */
  async getManifestForVersion(versionId: string) {
    const version = await this.prisma.courseVersion.findUnique({
      where: { id: versionId },
      select: { manifest: true, sectionCount: true },
    });
    return version ? parseManifest(version.manifest) : null;
  }

  getChapterIdsFromManifest = getChapterIdsFromManifest;
  getSectionIdsFromManifest = getSectionIdsFromManifest;
  getQuizIdsFromManifest = getQuizIdsFromManifest;
}

type PinnedCurriculumChapter = PinnedCurriculumModule['chapters'][number];
