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
   */
  async writeAudit(entry: {
    adminId: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    courseId?: string | null;
    userId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      // Denormalise the actor's email at write time so the audit row remains
      // attributable if the admin is later hard-deleted (adminId → null via
      // ON DELETE SET NULL).
      const actor = await this.prisma.user.findUnique({
        where: { id: entry.adminId },
        select: { email: true },
      });
      await this.prisma.adminAuditLog.create({
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
        `AdminAuditLog write failed (${entry.action}): ${
          err instanceof Error ? err.message : String(err)
        }`,
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

    const referencing: Array<{
      versionId: string;
      versionNumber: number;
      status: string;
      enrollmentCount: number;
    }> = [];
    let stillServedTo = 0;

    for (const v of versions) {
      const manifest = parseManifest(v.manifest);
      if (!manifest) continue;
      if (!isIdReferencedInManifest(manifest, table, sourceId)) continue;
      referencing.push({
        versionId: v.id,
        versionNumber: v.versionNumber,
        status: v.status,
        enrollmentCount: v._count.enrollments,
      });
      stillServedTo += v._count.enrollments;
    }

    referencing.sort((a, b) => b.versionNumber - a.versionNumber);
    return { stillServedTo, versions: referencing };
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
