import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  countVersionActiveSections,
  getVersionActiveSectionSourceIds,
  mapVersionQuizToLiveShape,
  mapVersionSectionToLiveShape,
  snapshotLiveTree,
  sortVersionSections,
  SNAPSHOT_TRANSACTION_OPTIONS,
} from './course-version.snapshot';

const versionInclude = {
  modules: {
    orderBy: { orderIndex: 'asc' as const },
    include: {
      chapters: {
        orderBy: { orderIndex: 'asc' as const },
        include: {
          sections: true,
          quizzes: true,
        },
      },
    },
  },
} satisfies Prisma.CourseVersionInclude;

export type CurriculumResolveResult =
  | { mode: 'live' }
  | {
      mode: 'versioned';
      versionId: string;
      versionNumber: number;
      version: Prisma.CourseVersionGetPayload<{ include: typeof versionInclude }>;
    };

@Injectable()
export class CourseVersionService {
  private readonly logger = new Logger(CourseVersionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveCurriculumTree(
    userId: string,
    courseId: string,
  ): Promise<CurriculumResolveResult> {
    await this.syncPublishedVersionWithLiveTree(
      courseId,
      null,
      'Sync before learner curriculum read',
    );

    const uc = await this.prisma.userCourse.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { id: true, enrolledVersionId: true },
    });

    if (!uc?.enrolledVersionId) {
      return { mode: 'live' };
    }

    let enrolledVersionId = uc.enrolledVersionId;

    // New assignees with no progress follow the latest published curriculum.
    const progressCount = await this.prisma.userCourseProgress.count({
      where: { userId, courseId },
    });
    if (progressCount === 0) {
      const latest = await this.getLatestPublishedVersion(courseId);
      if (latest && latest.id !== enrolledVersionId) {
        await this.prisma.userCourse.update({
          where: { id: uc.id },
          data: { enrolledVersionId: latest.id },
        });
        enrolledVersionId = latest.id;
        this.logger.log(
          `Bumped zero-progress enrollment ${uc.id} to version ${latest.versionNumber}`,
        );
      }
    }

    const version = await this.prisma.courseVersion.findUnique({
      where: { id: enrolledVersionId },
      include: versionInclude,
    });

    if (!version) {
      this.logger.warn(
        `User ${userId} pinned to missing version ${uc.enrolledVersionId}; falling back to live tree`,
      );
      return { mode: 'live' };
    }

    return {
      mode: 'versioned',
      versionId: version.id,
      versionNumber: version.versionNumber,
      version,
    };
  }

  async resolveCurriculumByEnrollment(
    enrolledVersionId: string | null | undefined,
  ): Promise<CurriculumResolveResult> {
    if (!enrolledVersionId) {
      return { mode: 'live' };
    }

    const version = await this.prisma.courseVersion.findUnique({
      where: { id: enrolledVersionId },
      include: versionInclude,
    });

    if (!version) {
      return { mode: 'live' };
    }

    return {
      mode: 'versioned',
      versionId: version.id,
      versionNumber: version.versionNumber,
      version,
    };
  }

  async getLatestPublishedVersion(courseId: string) {
    return this.prisma.courseVersion.findFirst({
      where: { courseId, status: 'PUBLISHED', isLatest: true },
    });
  }

  private async countLiveTreeStats(
    courseId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const [modules, chapters, sections, quizzes] = await Promise.all([
      db.module.count({ where: { courseId, isArchived: false } }),
      db.chapter.count({
        where: {
          isArchived: false,
          module: { courseId, isArchived: false },
        },
      }),
      db.section.count({
        where: {
          isArchived: false,
          chapter: { isArchived: false, module: { courseId, isArchived: false } },
        },
      }),
      db.quiz.count({
        where: {
          isArchived: false,
          chapter: { isArchived: false, module: { courseId, isArchived: false } },
        },
      }),
    ]);
    return { modules, chapters, sections, quizzes };
  }

  private async countVersionStats(
    versionId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const [modules, chapters, sections, quizzes] = await Promise.all([
      db.courseVersionModule.count({ where: { versionId } }),
      db.courseVersionChapter.count({ where: { versionId } }),
      db.courseVersionSection.count({ where: { versionId } }),
      db.courseVersionQuiz.count({ where: { versionId } }),
    ]);
    return { modules, chapters, sections, quizzes };
  }

  /** True when the live tree differs from the latest published snapshot. */
  async isLiveTreeDriftedFromLatest(courseId: string): Promise<boolean> {
    const live = await this.countLiveTreeStats(courseId);
    const latest = await this.getLatestPublishedVersion(courseId);
    if (!latest) {
      return live.sections > 0 || live.quizzes > 0;
    }
    const published = await this.countVersionStats(latest.id);
    return (
      live.modules !== published.modules ||
      live.chapters !== published.chapters ||
      live.sections !== published.sections ||
      live.quizzes !== published.quizzes
    );
  }

  /**
   * Publishes a new version when the live tree has drifted from the latest snapshot.
   * Safety net for structural edits that never triggered auto-publish.
   */
  async syncPublishedVersionWithLiveTree(
    courseId: string,
    adminId?: string | null,
    changeNotes?: string,
  ): Promise<{ versionNumber: number; versionId: string } | null> {
    const drifted = await this.isLiveTreeDriftedFromLatest(courseId);
    if (!drifted) {
      return null;
    }
    this.logger.log(
      `Live tree drift detected for course ${courseId}; publishing new version`,
    );
    return this.autoPublishAfterStructuralChange(
      courseId,
      adminId,
      changeNotes ?? 'Auto-publish: live curriculum differs from latest version',
    );
  }

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
    });

    if (!latest) {
      this.logger.warn(
        `No published version for course ${uc.courseId}; enrollment ${userCourseId} stays unpinned`,
      );
      return;
    }

    await db.userCourse.update({
      where: { id: userCourseId },
      data: { enrolledVersionId: latest.id },
    });
  }

  /**
   * Mirrors a live section's editable fields into the latest published
   * snapshot row matched by sourceSectionId. Used for content edits and
   * reorders that do not change the section count — no new version is
   * needed because progress denominators are unaffected.
   */
  async syncSectionToLatestVersion(sectionId: string): Promise<void> {
    const section = await this.prisma.section.findUnique({
      where: { id: sectionId },
      include: {
        chapter: { select: { module: { select: { courseId: true } } } },
      },
    });
    if (!section) return;

    const latest = await this.getLatestPublishedVersion(
      section.chapter.module.courseId,
    );
    if (!latest) return;

    try {
      await this.prisma.courseVersionSection.updateMany({
        where: { versionId: latest.id, sourceSectionId: section.id },
        data: {
          title: section.title,
          description: section.description,
          shortDescription: section.shortDescription,
          type: section.type,
          orderIndex: section.orderIndex,
          itemLabel: section.itemLabel,
          categoryLabel: section.categoryLabel,
          categories: section.categories,
          maxPerCategory: section.maxPerCategory,
          isActive: section.isActive,
          questionText: section.questionText,
          imageUrl: section.imageUrl,
          allowMultipleSelection: section.allowMultipleSelection,
          items: (section.items ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          options: (section.options ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          config: (section.config ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to sync section ${sectionId} into latest version: ${error?.message ?? error}`,
      );
    }
  }

  /** Mirrors current live orderIndex for every section in a chapter into the latest snapshot. */
  async syncChapterSectionOrderToLatestVersion(
    chapterId: string,
  ): Promise<void> {
    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: {
        sections: { select: { id: true, orderIndex: true } },
        module: { select: { courseId: true } },
      },
    });
    if (!chapter) return;

    const latest = await this.getLatestPublishedVersion(chapter.module.courseId);
    if (!latest) return;

    try {
      await this.prisma.$transaction(
        chapter.sections.map((sec) =>
          this.prisma.courseVersionSection.updateMany({
            where: { versionId: latest.id, sourceSectionId: sec.id },
            data: { orderIndex: sec.orderIndex },
          }),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to sync section order for chapter ${chapterId}: ${error?.message ?? error}`,
      );
    }
  }

  /** Mirrors a live module's title/description into the latest snapshot. */
  async syncModuleToLatestVersion(moduleId: string): Promise<void> {
    const mod = await this.prisma.module.findUnique({
      where: { id: moduleId },
      select: { id: true, title: true, description: true, courseId: true },
    });
    if (!mod) return;

    const latest = await this.getLatestPublishedVersion(mod.courseId);
    if (!latest) return;

    try {
      await this.prisma.courseVersionModule.updateMany({
        where: { versionId: latest.id, sourceModuleId: mod.id },
        data: { title: mod.title, description: mod.description },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to sync module ${moduleId}: ${error?.message ?? error}`,
      );
    }
  }

  /** Mirrors a live quiz's question/answer/options into the latest snapshot. */
  async syncQuizToLatestVersion(quizId: string): Promise<void> {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        chapter: { include: { module: { select: { courseId: true } } } },
      },
    });
    if (!quiz?.chapter?.module?.courseId) return;

    const latest = await this.getLatestPublishedVersion(
      quiz.chapter.module.courseId,
    );
    if (!latest) return;

    try {
      await this.prisma.courseVersionQuiz.updateMany({
        where: { versionId: latest.id, sourceQuizId: quiz.id },
        data: {
          question: quiz.question,
          answer: quiz.answer,
          options: quiz.options,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to sync quiz ${quizId}: ${error?.message ?? error}`,
      );
    }
  }

  /** Mirrors a live chapter's title/description/pdfFile into the latest snapshot. */
  async syncChapterToLatestVersion(chapterId: string): Promise<void> {
    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { module: { select: { courseId: true } } },
    });
    if (!chapter) return;

    const latest = await this.getLatestPublishedVersion(chapter.module.courseId);
    if (!latest) return;

    try {
      await this.prisma.courseVersionChapter.updateMany({
        where: { versionId: latest.id, sourceChapterId: chapter.id },
        data: {
          title: chapter.title,
          description: chapter.description,
          pdfFile: chapter.pdfFile,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to sync chapter ${chapterId}: ${error?.message ?? error}`,
      );
    }
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

    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.courseVersion.findFirst({
        where: { courseId, isLatest: true },
        orderBy: { versionNumber: 'desc' },
      });

      const nextNumber = (latest?.versionNumber ?? 0) + 1;

      if (latest) {
        await tx.courseVersion.update({
          where: { id: latest.id },
          data: { isLatest: false },
        });
      }

      const snapshot = await snapshotLiveTree(tx, courseId, {
        versionNumber: nextNumber,
        status: 'PUBLISHED',
        isLatest: true,
        publishedAt: new Date(),
        publishedByAdminId: adminId ?? null,
        changeNotes: changeNotes ?? null,
      });

      const version = await tx.courseVersion.findUnique({
        where: { id: snapshot.versionId },
      });

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
    }, SNAPSHOT_TRANSACTION_OPTIONS);
  }

  /**
   * Called after admin structural edits (add/remove module/chapter/section).
   * Publishes a new version so newly activated enrollments pick up the change
   * without any manual Postman step.
   */
  async autoPublishAfterStructuralChange(
    courseId: string,
    adminId: string | null | undefined,
    changeNotes: string,
  ): Promise<{ versionNumber: number; versionId: string }> {
    this.logger.log(`Auto-publishing ${courseId}: ${changeNotes}`);
    const result = await this.publishNewVersion(adminId, courseId, changeNotes);
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
        _count: {
          select: {
            modules: true,
            sections: true,
            enrollments: true,
          },
        },
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
        moduleCount: v._count.modules,
        sectionCount: v._count.sections,
        enrollmentCount: v._count.enrollments,
      })),
    };
  }

  async archiveVersion(adminId: string, courseId: string, versionId: string) {
    void adminId;

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
    void adminId;

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

    await this.prisma.userCourse.update({
      where: { id: userCourseId },
      data: { enrolledVersionId: target.id },
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

  /** Version-aware content completion denominator check. */
  async countCompletionDenominator(
    userId: string,
    courseId: string,
  ): Promise<{ total: number; liveSectionIds: string[] }> {
    const resolved = await this.resolveCurriculumTree(userId, courseId);

    if (resolved.mode === 'live') {
      const liveSectionIds = (
        await this.prisma.section.findMany({
          where: {
            isActive: true,
            isArchived: false,
            chapter: { isArchived: false, module: { courseId, isArchived: false } },
          },
          select: { id: true },
        })
      ).map((s) => s.id);
      return { total: liveSectionIds.length, liveSectionIds };
    }

    const ids = await getVersionActiveSectionSourceIds(
      this.prisma,
      resolved.versionId,
    );
    return { total: ids.length, liveSectionIds: ids };
  }

  async countVersionSectionsForCourse(versionId: string): Promise<number> {
    return countVersionActiveSections(this.prisma, versionId);
  }

  /**
   * Build module tree for getAllUserModules from a pinned version.
   */
  buildUserModulesFromVersion(
    version: Prisma.CourseVersionGetPayload<{ include: typeof versionInclude }>,
    userId: string,
    progressByChapter: Map<string, number>,
    progressByModule: Map<string, number>,
  ) {
    return version.modules.map((mod) => {
      let moduleSectionTotal = 0;
      let moduleProgressTotal = 0;

      const chapters = mod.chapters.map((ch) => {
        const sourceChapterId = ch.sourceChapterId ?? ch.id;
        const sectionTotal = ch.sections.filter((s) => s.isActive).length;
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
        id: mod.sourceModuleId ?? mod.id,
        title: mod.title,
        chapters,
        _count: {
          UserCourseProgress: Math.min(
            progressByModule.get(mod.sourceModuleId ?? mod.id) ?? moduleProgressTotal,
            moduleSectionTotal,
          ),
          sections: moduleSectionTotal,
        },
      };
    });
  }

  findVersionChapterBySourceId(
    version: Prisma.CourseVersionGetPayload<{ include: typeof versionInclude }>,
    sourceChapterId: string,
  ) {
    for (const mod of version.modules) {
      const ch = mod.chapters.find((c) => c.sourceChapterId === sourceChapterId);
      if (ch) return { module: mod, chapter: ch };
    }
    return null;
  }

  mapVersionSectionsForLearner(
    sections: Prisma.CourseVersionSectionGetPayload<object>[],
  ) {
    return sortVersionSections(sections).map(mapVersionSectionToLiveShape);
  }

  mapVersionQuizzesForLearner(
    quizzes: Prisma.CourseVersionQuizGetPayload<object>[],
    includeAnswers: boolean,
  ) {
    return quizzes.map((q) => {
      const mapped = mapVersionQuizToLiveShape(q);
      if (!includeAnswers) {
        const { answer: _a, ...rest } = mapped;
        return rest;
      }
      return mapped;
    });
  }

  /**
   * Pattern C: sections in latest version but not in pinned version.
   */
  async summarizeNewSincePinnedVersion(
    userId: string,
    courseId: string,
  ): Promise<{
    newChapters: number;
    newSections: number;
    addedAt: Date | null;
  } | null> {
    const uc = await this.prisma.userCourse.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { enrolledVersionId: true },
    });
    if (!uc?.enrolledVersionId) return null;

    const latest = await this.getLatestPublishedVersion(courseId);
    if (!latest || latest.id === uc.enrolledVersionId) return null;

    const [pinnedSectionIds, pinnedChapterIds, latestSections, latestChapters] =
      await Promise.all([
        this.prisma.courseVersionSection
          .findMany({
            where: { versionId: uc.enrolledVersionId, isActive: true },
            select: { sourceSectionId: true },
          })
          .then((rows) =>
            new Set(rows.map((s) => s.sourceSectionId).filter(Boolean)),
          ),
        this.prisma.courseVersionChapter
          .findMany({
            where: { versionId: uc.enrolledVersionId },
            select: { sourceChapterId: true },
          })
          .then((rows) =>
            new Set(rows.map((c) => c.sourceChapterId).filter(Boolean)),
          ),
        this.prisma.courseVersionSection.findMany({
          where: { versionId: latest.id, isActive: true },
          select: { sourceSectionId: true, versionChapterId: true, createdAt: true },
        }),
        this.prisma.courseVersionChapter.findMany({
          where: { versionId: latest.id },
          select: { id: true, sourceChapterId: true },
        }),
      ]);

    const latestChapterByVersionId = new Map(
      latestChapters.map((c) => [c.id, c.sourceChapterId]),
    );

    const newSections = latestSections.filter(
      (s) => s.sourceSectionId && !pinnedSectionIds.has(s.sourceSectionId),
    );
    if (newSections.length === 0) return null;

    const newChapterSourceIds = new Set<string>();
    for (const s of newSections) {
      const sourceChapterId = latestChapterByVersionId.get(s.versionChapterId);
      if (sourceChapterId && !pinnedChapterIds.has(sourceChapterId)) {
        newChapterSourceIds.add(sourceChapterId);
      }
    }

    const addedAt = newSections.reduce<Date | null>((max, s) => {
      if (!max || s.createdAt > max) return s.createdAt;
      return max;
    }, null);

    return {
      newChapters: newChapterSourceIds.size,
      newSections: newSections.length,
      addedAt,
    };
  }

  async isReferencedByAnyVersion(
    table: 'section' | 'chapter' | 'module' | 'quiz',
    sourceId: string,
  ): Promise<boolean> {
    switch (table) {
      case 'section':
        return (
          (await this.prisma.courseVersionSection.count({
            where: { sourceSectionId: sourceId },
          })) > 0
        );
      case 'chapter':
        return (
          (await this.prisma.courseVersionChapter.count({
            where: { sourceChapterId: sourceId },
          })) > 0
        );
      case 'module':
        return (
          (await this.prisma.courseVersionModule.count({
            where: { sourceModuleId: sourceId },
          })) > 0
        );
      case 'quiz':
        return (
          (await this.prisma.courseVersionQuiz.count({
            where: { sourceQuizId: sourceId },
          })) > 0
        );
    }
  }
}
