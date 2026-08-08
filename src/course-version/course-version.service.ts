import {
  ConflictException,
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
    const uc = await this.prisma.userCourse.findUnique({
      where: { id: userCourseId },
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
    });
    if (!target) {
      throw new NotFoundException('Target version not found or not published');
    }

    // Snapshot the prior pin BEFORE the update so the audit row captures the
    // migration delta (from → to). Re-pinning a learner's curriculum silently
    // changes their progress denominator; this leaves a trace.
    const priorVersion = uc.enrolledVersionId
      ? await this.prisma.courseVersion.findUnique({
          where: { id: uc.enrolledVersionId },
          select: { id: true, versionNumber: true },
        })
      : null;

    await this.prisma.userCourse.update({
      where: { id: userCourseId },
      data: { enrolledVersionId: target.id },
    });

    await this.writeAudit({
      adminId,
      action: 'MIGRATE_LEARNER_VERSION',
      targetType: 'UserCourse',
      targetId: userCourseId,
      courseId: uc.courseId,
      userId: uc.userId,
      metadata: {
        fromVersionId: priorVersion?.id ?? null,
        fromVersionNumber: priorVersion?.versionNumber ?? null,
        toVersionId: target.id,
        toVersionNumber: target.versionNumber,
      },
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
   * Best-effort audit write. Never throws — audit failures must not break the
   * underlying admin operation. Callers should still `await` so the row is
   * persisted within the same request lifecycle (Prisma buffers to the same
   * pool), but any error is swallowed and logged.
   *
   * Optional `tx` parameter: when provided, both the actor-email lookup and
   * the `adminAuditLog.create` run on that transaction client. This lets a
   * caller emit an audit row *inside* an interactive transaction — required
   * by PR 5's `_migrateOneLearner` so a caller cannot observe a migrated
   * UserCourse with no corresponding audit row (or vice versa on rollback).
   *
   * Important atomicity note: the audit write stays **best-effort even
   * inside a tx**. On failure we log a structured warning and return —
   * we do NOT rethrow. Rationale: the caller's business side effect (the
   * migration, archive, etc.) is more valuable than a guaranteed audit row.
   * Losing an audit row is a lesser bad than rolling back a bulk migration
   * that leaves the admin with no idea which learners actually moved. See
   * CC3 in `docs/course-versioning-admin-features-plan.md` for the FE-vs-BE
   * agreement on this.
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
  ): Promise<{ total: number; liveSectionIds: string[] }> {
    const liveDenominator = async () => {
      const liveSectionIds = (
        await this.prisma.section.findMany({
          where: {
            isActive: true,
            isArchived: false,
            chapter: {
              isArchived: false,
              module: { courseId, isArchived: false },
            },
          },
          select: { id: true },
        })
      ).map((s) => s.id);
      return { total: liveSectionIds.length, liveSectionIds };
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
    return { total: ids.length, liveSectionIds: ids };
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

    // Phase 3: batch-load the two per-user aggregates needed for percentage
    // and isCompleted. groupBy on UserCourseProgress keeps this to one
    // round-trip regardless of pageSize (or overfetched N in the
    // percentage-sort case).
    //
    // The `Section` filter (isArchived: false, isActive: true) is what
    // keeps the numerator consistent with countCompletionDenominator's
    // live path. Without it, an unpinned learner's percentage in the
    // roster would count progress on archived/inactive sections while the
    // completion gate does not — reproducing the exact "roster shows 92%,
    // completion says 100%" bug the pre-PR-1 fixes closed.
    const userIds = rowsRaw.map((r) => r.userId);
    const [progressCounts, completions, liveSectionCount] = await Promise.all([
      userIds.length
        ? this.prisma.userCourseProgress.groupBy({
            by: ['userId'],
            where: {
              courseId,
              userId: { in: userIds },
              Section: { isArchived: false, isActive: true },
            },
            _count: { _all: true },
          })
        : Promise.resolve(
            [] as Array<{ userId: string; _count: { _all: number } }>,
          ),
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
      // Live denominator: only queried when the page has any unpinned
      // learner. Small cost regardless; keeping it unconditional lets
      // us skip a "does this page need it?" branch and avoids a follow-
      // up round-trip if the answer flips.
      this.prisma.section.count({
        where: {
          isActive: true,
          isArchived: false,
          chapter: {
            isArchived: false,
            module: { courseId, isArchived: false },
          },
        },
      }),
    ]);

    const progressByUser = new Map(
      progressCounts.map((p) => [p.userId, p._count._all]),
    );
    const completedSet = new Set(completions.map((c) => c.userId));

    // Phase 4: build typed rows.
    const rows = rowsRaw.map((r) => {
      const isCompleted = completedSet.has(r.userId);
      // Pinned learners: denominator is the version's sectionCount (the
      // count captured at publish time). Unpinned learners: denominator
      // is the current live section count. sectionCount can be null on
      // very old rows that pre-date the column — fall back to live.
      const denom = r.enrolledVersion?.sectionCount ?? liveSectionCount;
      const numer = progressByUser.get(r.userId) ?? 0;
      const percentage = isCompleted
        ? 100
        : denom > 0
          ? Math.min(100, Math.round((numer * 100) / denom) / 1)
          : 0;
      // Clamp completers to 100. This is the counterpart to the
      // completion-freeze in the learner UI: an admin looking at the
      // roster right after a learner completed should never see 98.7%.
      const userLabel =
        [r.user.firstName, r.user.lastName].filter(Boolean).join(' ') ||
        r.user.email;
      return {
        userId: r.userId,
        userLabel,
        email: r.user.email,
        enrolledVersionId: r.enrolledVersionId,
        enrolledVersionNumber: r.enrolledVersion?.versionNumber ?? null,
        percentage,
        isCompleted,
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
