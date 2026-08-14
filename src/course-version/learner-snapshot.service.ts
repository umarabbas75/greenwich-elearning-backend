import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolvePassingCriteria } from '../utils/chapter-progression';
import {
  CourseVersionManifest,
  getQuizBearingChapterIdsFromManifest,
  loadManifestForVersion,
} from './course-version.manifest';
import {
  computeLearnerPercentages,
  percentageKey,
} from './learner-percentage';

/**
 * Everything the admin UI needs to answer "what is going on with this learner?"
 * in one call.
 *
 * Before this, an admin chasing a support question had to open the roster
 * (`GET /courses/:courseId/enrollments`) once per course the learner is on,
 * because that is the only surface exposing `enrolledVersionId` — and it is
 * course-scoped and paginated. `GET /users/:id` returns a course-forms view
 * with nothing version-related on it at all.
 *
 * Query budget is flat in course count: the per-course work is done by ONE
 * batched call into the percentage engine plus map lookups, never a loop of
 * queries. See `computeLearnerPercentages`, whose own header warns against
 * calling the single-learner wrapper in a loop.
 */

export type VersionStatus = 'on_latest' | 'behind' | 'not_pinned' | 'no_versions';

export type LearnerSnapshotOptions = {
  includeAudit?: boolean;
  auditLimit?: number;
  includeAssessments?: boolean;
};

const AUDIT_LIMIT_DEFAULT = 20;
const AUDIT_LIMIT_MAX = 100;

/**
 * Audit actions that describe something done TO a learner's enrollment.
 * Deliberately excludes content-level actions (ARCHIVE_*, RESTORE_ENTITY) —
 * those are course history, not this learner's history, and would drown the
 * per-learner timeline.
 */
const LEARNER_AUDIT_ACTIONS = [
  'MIGRATE_LEARNER_VERSION',
  'BULK_MIGRATE_LEARNER_VERSION',
  'UNASSIGN_COURSE',
  'UNASSIGN_COURSE_FORCE',
];

@Injectable()
export class LearnerSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async getLearnerVersioningSnapshot(
    userId: string,
    options: LearnerSnapshotOptions = {},
  ) {
    const includeAudit = options.includeAudit !== false;
    const includeAssessments = options.includeAssessments !== false;
    const auditLimit = Math.min(
      Math.max(1, options.auditLimit ?? AUDIT_LIMIT_DEFAULT),
      AUDIT_LIMIT_MAX,
    );

    // Deliberately NOT filtered on `deletedAt: null`. An admin reaching this
    // page from the Deleted tab needs the history most, and 404ing there would
    // make the soft-delete flow a dead end. `deletedAt` is returned so the UI
    // can badge it.
    const learner = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        timezone: true,
        createdAt: true,
        deletedAt: true,
        mustChangePassword: true,
      },
    });
    if (!learner) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    // One query yields the enrollment fields AND the pinned version's metadata.
    const enrollments = await this.prisma.userCourse.findMany({
      where: { userId },
      include: {
        course: { select: { id: true, title: true, image: true } },
        enrolledVersion: {
          select: {
            id: true,
            versionNumber: true,
            status: true,
            isLatest: true,
            publishedAt: true,
            changeNotes: true,
            sectionCount: true,
            manifest: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const courseIds = enrollments.map((e) => e.courseId);

    if (courseIds.length === 0) {
      return this.emptySnapshot(learner, includeAudit ? [] : undefined);
    }

    const [percentages, completions, latestVersions, timeByCourse] =
      await Promise.all([
        // ONE call for every course — passing enrolledVersionId through skips
        // the engine's own enrollment lookup, as getRoster does.
        computeLearnerPercentages(
          this.prisma,
          enrollments.map((e) => ({
            userId,
            courseId: e.courseId,
            enrolledVersionId: e.enrolledVersionId,
          })),
        ),
        // The engine reports `isCompleted` but discards the timestamps, so the
        // completion rows are read separately for courseCompletedAt et al.
        this.prisma.courseCompletion.findMany({
          where: { userId, courseId: { in: courseIds } },
        }),
        this.prisma.courseVersion.findMany({
          where: {
            courseId: { in: courseIds },
            status: 'PUBLISHED',
            isLatest: true,
          },
          select: {
            id: true,
            courseId: true,
            versionNumber: true,
            publishedAt: true,
            sectionCount: true,
          },
        }),
        this.prisma.sectionTimeSpent.groupBy({
          by: ['courseId'],
          where: { userId, courseId: { in: courseIds } },
          _sum: { totalSeconds: true },
          _min: { firstAttemptAt: true },
          _max: { lastAttemptAt: true },
        }),
      ]);

    const completionByCourse = new Map(completions.map((c) => [c.courseId, c]));
    const latestByCourse = new Map(latestVersions.map((v) => [v.courseId, v]));
    const timeMap = new Map(timeByCourse.map((t) => [t.courseId, t]));

    const quizGates = await this.buildQuizGates(userId, enrollments);

    const courses = enrollments.map((enrollment) => {
      const key = percentageKey(userId, enrollment.courseId);
      const pct = percentages.get(key);
      const completion = completionByCourse.get(enrollment.courseId);
      const latest = latestByCourse.get(enrollment.courseId);
      const pinned = enrollment.enrolledVersion;
      const time = timeMap.get(enrollment.courseId);

      const versionStatus: VersionStatus = !latest
        ? 'no_versions'
        : !pinned
        ? 'not_pinned'
        : pinned.id === latest.id
        ? 'on_latest'
        : 'behind';

      return {
        courseId: enrollment.courseId,
        courseTitle: enrollment.course?.title ?? '(unknown course)',
        courseImage: enrollment.course?.image ?? null,

        enrollment: {
          // Returned because the single-learner migrate endpoint keys on this
          // and the roster does not expose it.
          userCourseId: enrollment.id,
          isActive: enrollment.isActive,
          isPaid: enrollment.isPaid,
          activatedAt: enrollment.activatedAt,
          enrolledAt: enrollment.createdAt,
        },

        pinnedVersion: pinned
          ? {
              versionId: pinned.id,
              versionNumber: pinned.versionNumber,
              status: pinned.status,
              isLatest: pinned.isLatest,
              publishedAt: pinned.publishedAt,
              changeNotes: pinned.changeNotes,
              sectionCount: pinned.sectionCount,
            }
          : null,

        latestPublishedVersion: latest
          ? {
              versionId: latest.id,
              versionNumber: latest.versionNumber,
              publishedAt: latest.publishedAt,
              sectionCount: latest.sectionCount,
            }
          : null,

        // Computed server-side on purpose: the comparison is per-course, so a
        // client cannot derive it from a single top-level field the way the
        // roster allows.
        versionStatus,
        versionsBehind:
          pinned && latest
            ? Math.max(0, latest.versionNumber - pinned.versionNumber)
            : null,

        progress: {
          percentage: pct?.percentage ?? 0,
          numerator: pct?.numerator ?? 0,
          denominator: pct?.denominator ?? 0,
          denominatorSource: pct?.denominatorSource ?? 'live',
          isCompleted: pct?.isCompleted ?? false,
          courseCompletedAt: completion?.courseCompletedAt ?? null,
          assessmentPassedAt: completion?.assessmentPassedAt ?? null,
          isPassed: completion?.isPassed ?? false,
          certificateUrl: completion?.certificateUrl ?? null,
        },

        quizGate: quizGates.get(enrollment.courseId) ?? null,

        activity: {
          timeSpentSeconds: time?._sum?.totalSeconds ?? 0,
          firstActivityAt: time?._min?.firstAttemptAt ?? null,
          lastActivityAt: time?._max?.lastAttemptAt ?? null,
        },
      };
    });

    const [auditTrail, assessments] = await Promise.all([
      includeAudit ? this.buildAuditTrail(userId, courseIds, auditLimit) : null,
      includeAssessments ? this.buildAssessments(userId, courseIds) : null,
    ]);

    return {
      message: 'Learner versioning snapshot retrieved',
      statusCode: 200,
      data: {
        learner,
        summary: this.buildSummary(courses),
        courses,
        ...(auditTrail ? { auditTrail } : {}),
        ...(assessments ? { assessments } : {}),
      },
    };
  }

  /**
   * The full curriculum tree for ONE course, as this learner sees it, with
   * their state on every lesson and their actual quiz answers.
   *
   * The snapshot above says "11/11 quizzes passed"; this says which questions
   * they were asked, what they picked, and what was correct. Nothing in the
   * app exposed that for an admin before — the only endpoint returning
   * `QuizAnswer` rows (`GET /quizzes/user/getQuizAnswers/:chapterId`) is
   * scoped to the caller's own token, so support could not see a learner's
   * answers at all.
   *
   * Structure comes from the learner's PINNED version where they have one, so
   * this shows the curriculum they actually studied rather than today's live
   * tree.
   */
  async getLearnerCourseDetail(userId: string, courseId: string) {
    const enrollment = await this.prisma.userCourse.findUnique({
      where: { userId_courseId: { userId, courseId } },
      include: {
        course: { select: { id: true, title: true } },
        enrolledVersion: {
          select: { id: true, versionNumber: true, status: true, manifest: true },
        },
      },
    });
    if (!enrollment) {
      throw new NotFoundException(
        `User ${userId} is not enrolled in course ${courseId}`,
      );
    }

    const manifest = enrollment.enrolledVersionId
      ? await loadManifestForVersion(this.prisma, enrollment.enrolledVersionId)
      : null;

    const structure = manifest
      ? await this.buildTreeFromManifest(courseId, manifest)
      : await this.buildLiveTree(courseId);

    const chapterIds = structure.flatMap((m) =>
      m.chapters.map((c: any) => c.chapterId),
    );
    const sectionIds = structure.flatMap((m) =>
      m.chapters.flatMap((c: any) => c.sections.map((s: any) => s.sectionId)),
    );
    const quizIds = structure.flatMap((m) =>
      m.chapters.flatMap((c: any) => c.quizIds),
    );

    const [
      progressRows,
      timeRows,
      lastSeenRows,
      chapterCompletions,
      moduleCompletions,
      quizProgressRows,
      quizzes,
      quizAnswers,
    ] = await Promise.all([
      this.prisma.userCourseProgress.findMany({
        where: { userId, courseId },
        select: { sectionId: true, createdAt: true },
      }),
      this.prisma.sectionTimeSpent.findMany({
        where: { userId, sectionId: { in: sectionIds } },
        select: {
          sectionId: true,
          totalSeconds: true,
          totalAttempts: true,
          firstAttemptAt: true,
          lastAttemptAt: true,
        },
      }),
      this.prisma.lastSeenSection.findMany({
        where: { userId, chapterId: { in: chapterIds } },
        select: { chapterId: true, sectionId: true, updatedAt: true },
      }),
      this.prisma.userChapterCompletion.findMany({
        where: { userId, chapterId: { in: chapterIds } },
        select: { chapterId: true, completedAt: true },
      }),
      this.prisma.userModuleCompletion.findMany({
        where: { userId, courseId },
        select: { moduleId: true, completedAt: true },
      }),
      this.prisma.quizProgress.findMany({
        where: { userId, chapterId: { in: chapterIds } },
      }),
      this.prisma.quiz.findMany({
        where: { id: { in: quizIds } },
        select: {
          id: true,
          question: true,
          options: true,
          answer: true,
          chapterId: true,
          orderIndex: true,
        },
      }),
      this.prisma.quizAnswer.findMany({
        where: { userId, quizId: { in: quizIds } },
        select: {
          quizId: true,
          answer: true,
          isAnswerCorrect: true,
          updatedAt: true,
        },
      }),
    ]);

    const completedAtBySection = new Map(
      progressRows.map((p) => [p.sectionId, p.createdAt]),
    );
    const timeBySection = new Map(timeRows.map((t) => [t.sectionId, t]));
    const lastSeenByChapter = new Map(
      lastSeenRows.map((l) => [l.chapterId, l]),
    );
    const chapterCompletedAt = new Map(
      chapterCompletions.map((c) => [c.chapterId, c.completedAt]),
    );
    const moduleCompletedAt = new Map(
      moduleCompletions.map((m) => [m.moduleId, m.completedAt]),
    );
    const quizProgressByChapter = new Map(
      quizProgressRows.map((q) => [q.chapterId, q]),
    );
    const answerByQuiz = new Map(quizAnswers.map((a) => [a.quizId, a]));
    const quizzesByChapter = new Map<string, typeof quizzes>();
    for (const quiz of quizzes) {
      if (!quiz.chapterId) continue;
      const list = quizzesByChapter.get(quiz.chapterId) ?? [];
      list.push(quiz);
      quizzesByChapter.set(quiz.chapterId, list);
    }

    const modules = structure.map((mod) => {
      const chapters = mod.chapters.map((chapter: any) => {
        const sections = chapter.sections.map((section: any) => {
          const completedAt = completedAtBySection.get(section.sectionId) ?? null;
          const time = timeBySection.get(section.sectionId);
          const isLastSeen =
            lastSeenByChapter.get(chapter.chapterId)?.sectionId ===
            section.sectionId;
          return {
            sectionId: section.sectionId,
            title: section.title,
            type: section.type,
            orderIndex: section.orderIndex,
            // A UserCourseProgress row IS the completion record; there is no
            // separate flag. `opened` is only knowable for the one section per
            // chapter that LastSeenSection points at (it is unique per chapter).
            status: completedAt ? 'completed' : isLastSeen ? 'opened' : 'not_opened',
            completedAt,
            isLastSeen,
            timeSpentSeconds: time?.totalSeconds ?? 0,
            attempts: time?.totalAttempts ?? 0,
            firstAttemptAt: time?.firstAttemptAt ?? null,
            lastAttemptAt: time?.lastAttemptAt ?? null,
          };
        });

        const chapterQuizzes = (quizzesByChapter.get(chapter.chapterId) ?? [])
          .slice()
          .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
          .map((quiz) => {
            const given = answerByQuiz.get(quiz.id);
            return {
              quizId: quiz.id,
              question: quiz.question,
              // Plain option strings — there are no option ids. The learner's
              // answer and the correct answer are both option TEXT, so the UI
              // highlights by string equality.
              options: quiz.options,
              correctAnswer: quiz.answer,
              givenAnswer: given?.answer ?? null,
              isCorrect: given?.isAnswerCorrect ?? null,
              answeredAt: given?.updatedAt ?? null,
            };
          });

        const quizProgress = quizProgressByChapter.get(chapter.chapterId);
        const sectionsCompleted = sections.filter(
          (s: any) => s.status === 'completed',
        ).length;

        return {
          chapterId: chapter.chapterId,
          title: chapter.title,
          completedAt: chapterCompletedAt.get(chapter.chapterId) ?? null,
          sectionsTotal: sections.length,
          sectionsCompleted,
          timeSpentSeconds: sections.reduce(
            (sum: number, s: any) => sum + s.timeSpentSeconds,
            0,
          ),
          sections,
          quiz: chapterQuizzes.length
            ? {
                totalQuestions: chapterQuizzes.length,
                answered: chapterQuizzes.filter((q) => q.givenAnswer != null)
                  .length,
                correct: chapterQuizzes.filter((q) => q.isCorrect === true)
                  .length,
                attempts: quizProgress?.totalAttempts ?? 0,
                score: quizProgress?.score ?? null,
                // Stored criteria is 0 on older rows; the grader falls back to
                // the same default, so resolve it rather than showing "0%".
                passingCriteria: resolvePassingCriteria(
                  quizProgress?.passingCriteria,
                ),
                isPassed: quizProgress?.isPassed ?? false,
                questions: chapterQuizzes,
              }
            : null,
        };
      });

      return {
        moduleId: mod.moduleId,
        title: mod.title,
        completedAt: moduleCompletedAt.get(mod.moduleId) ?? null,
        chaptersTotal: chapters.length,
        chaptersCompleted: chapters.filter((c: any) => c.completedAt).length,
        chapters,
      };
    });

    return {
      message: 'Learner course detail retrieved',
      statusCode: 200,
      data: {
        courseId,
        courseTitle: enrollment.course?.title ?? '(unknown course)',
        curriculumSource: manifest ? 'pinned' : 'live',
        pinnedVersion: enrollment.enrolledVersion
          ? {
              versionId: enrollment.enrolledVersion.id,
              versionNumber: enrollment.enrolledVersion.versionNumber,
              status: enrollment.enrolledVersion.status,
            }
          : null,
        /**
         * Retaking a chapter quiz deletes the learner's previous answers, and
         * answering again overwrites in place — so what follows is the LATEST
         * attempt only. There is no answer history to show.
         */
        answersAreLatestAttemptOnly: true,
        modules,
      },
    };
  }

  /** Curriculum as the learner's pinned version froze it. */
  private async buildTreeFromManifest(
    courseId: string,
    manifest: CourseVersionManifest,
  ) {
    const moduleIds = manifest.modules.map((m) => m.sourceId);
    const chapterIds = manifest.modules.flatMap((m) =>
      m.chapters.map((c) => c.sourceId),
    );
    const sectionIds = manifest.modules.flatMap((m) =>
      m.chapters.flatMap((c) => c.sectionIds),
    );

    const [modules, chapters, sections] = await Promise.all([
      this.prisma.module.findMany({
        where: { id: { in: moduleIds } },
        select: { id: true, title: true },
      }),
      this.prisma.chapter.findMany({
        where: { id: { in: chapterIds } },
        select: { id: true, title: true },
      }),
      this.prisma.section.findMany({
        where: { id: { in: sectionIds } },
        select: { id: true, title: true, type: true, orderIndex: true },
      }),
    ]);

    const moduleById = new Map(modules.map((m) => [m.id, m]));
    const chapterById = new Map(chapters.map((c) => [c.id, c]));
    const sectionById = new Map(sections.map((s) => [s.id, s]));

    // Manifest order is the source of truth — Module and Chapter have no
    // orderIndex column, so the frozen order is the only ordering there is.
    return manifest.modules
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((mod) => ({
        moduleId: mod.sourceId,
        title: moduleById.get(mod.sourceId)?.title ?? '(removed unit)',
        chapters: mod.chapters
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((chapter) => ({
            chapterId: chapter.sourceId,
            title: chapterById.get(chapter.sourceId)?.title ?? '(removed chapter)',
            quizIds: chapter.quizIds,
            sections: chapter.sectionIds.map((sectionId) => {
              const section = sectionById.get(sectionId);
              return {
                sectionId,
                title: section?.title ?? '(removed lesson)',
                type: section?.type ?? null,
                orderIndex: section?.orderIndex ?? null,
              };
            }),
          })),
      }));
  }

  /** Curriculum as it stands now, for learners with no pinned version. */
  private async buildLiveTree(courseId: string) {
    const modules = await this.prisma.module.findMany({
      where: { courseId, isArchived: false },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        chapters: {
          where: { isArchived: false },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            title: true,
            quizzes: {
              where: { isArchived: false },
              select: { id: true },
              orderBy: { orderIndex: 'asc' },
            },
            sections: {
              where: { isArchived: false, isActive: true },
              orderBy: { orderIndex: 'asc' },
              select: { id: true, title: true, type: true, orderIndex: true },
            },
          },
        },
      },
    });

    return modules.map((mod) => ({
      moduleId: mod.id,
      title: mod.title,
      chapters: mod.chapters.map((chapter) => ({
        chapterId: chapter.id,
        title: chapter.title,
        quizIds: chapter.quizzes.map((q) => q.id),
        sections: chapter.sections.map((section) => ({
          sectionId: section.id,
          title: section.title,
          type: section.type,
          orderIndex: section.orderIndex,
        })),
      })),
    }));
  }

  /**
   * "All sections done" is not the same as "complete": since A0, completion
   * also requires passing every quiz-bearing chapter, so a learner can sit at
   * 100% and legitimately not be done. That is the top support question and
   * nothing else in the admin UI answers it.
   *
   * The quiz-bearing chapter set comes from the learner's PINNED manifest where
   * one exists, so the gate is evaluated against the curriculum they are
   * actually on rather than today's live tree. Manifests are LRU-cached, so
   * this is cache reads rather than queries after the first load of each
   * distinct version.
   */
  private async buildQuizGates(
    userId: string,
    enrollments: Array<{ courseId: string; enrolledVersionId: string | null }>,
  ) {
    const gates = new Map<string, any>();

    // Resolve each course's quiz-bearing chapter set first, so the QuizProgress
    // read below is a single query across every course.
    const chaptersByCourse = new Map<string, string[]>();
    for (const enrollment of enrollments) {
      try {
        let chapterIds: string[] = [];
        if (enrollment.enrolledVersionId) {
          const manifest = await loadManifestForVersion(
            this.prisma,
            enrollment.enrolledVersionId,
          );
          if (manifest) {
            chapterIds = getQuizBearingChapterIdsFromManifest(manifest);
          }
        } else {
          // Unpinned learners float to the live tree, so the gate is whatever
          // currently has a quiz attached.
          const live = await this.prisma.chapter.findMany({
            where: {
              module: { courseId: enrollment.courseId, isArchived: false },
              isArchived: false,
              quizzes: { some: { isArchived: false } },
            },
            select: { id: true },
          });
          chapterIds = live.map((c) => c.id);
        }
        chaptersByCourse.set(enrollment.courseId, chapterIds);
      } catch {
        // A version whose manifest will not parse should not fail the whole
        // snapshot — the rest of this course's data is still worth returning.
        chaptersByCourse.set(enrollment.courseId, []);
      }
    }

    const allChapterIds = Array.from(chaptersByCourse.values()).flat();
    if (allChapterIds.length === 0) return gates;

    const [progressRows, chapterTitles] = await Promise.all([
      this.prisma.quizProgress.findMany({
        where: { userId, chapterId: { in: allChapterIds } },
      }),
      this.prisma.chapter.findMany({
        where: { id: { in: allChapterIds } },
        select: { id: true, title: true },
      }),
    ]);

    const progressByChapter = new Map(progressRows.map((p) => [p.chapterId, p]));
    const titleByChapter = new Map(chapterTitles.map((c) => [c.id, c.title]));

    for (const [courseId, chapterIds] of chaptersByCourse) {
      if (chapterIds.length === 0) {
        gates.set(courseId, {
          quizBearingChapters: 0,
          quizChaptersPassed: 0,
          outstandingChapters: [],
        });
        continue;
      }

      const outstanding = chapterIds
        .filter((id) => progressByChapter.get(id)?.isPassed !== true)
        .map((id) => {
          const progress = progressByChapter.get(id);
          return {
            chapterId: id,
            chapterTitle: titleByChapter.get(id) ?? '(untitled chapter)',
            attempts: progress?.totalAttempts ?? 0,
            bestScore: progress?.score ?? null,
            passingCriteria: progress?.passingCriteria ?? null,
          };
        });

      gates.set(courseId, {
        quizBearingChapters: chapterIds.length,
        quizChaptersPassed: chapterIds.length - outstanding.length,
        outstandingChapters: outstanding,
      });
    }

    return gates;
  }

  /**
   * `AdminAuditLog.userId` is the AFFECTED learner; `adminId` is the actor.
   * Both are matched so an admin's own account shows actions they performed as
   * well as actions performed on them — otherwise a learner who is themselves
   * an admin has a silently incomplete timeline.
   */
  private async buildAuditTrail(
    userId: string,
    courseIds: string[],
    take: number,
  ) {
    const rows = await this.prisma.adminAuditLog.findMany({
      where: {
        action: { in: LEARNER_AUDIT_ACTIONS },
        OR: [{ userId }, { adminId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    if (rows.length === 0) return [];

    // Titles resolved here so the client can render a sentence without a
    // second call. Includes course ids outside this learner's current
    // enrolments — an unassign leaves audit rows for a course they no longer
    // hold, and hiding those would make the timeline lie.
    const auditCourseIds = Array.from(
      new Set(rows.map((r) => r.courseId).filter((id): id is string => !!id)),
    );
    const courses = auditCourseIds.length
      ? await this.prisma.course.findMany({
          where: { id: { in: auditCourseIds } },
          select: { id: true, title: true },
        })
      : [];
    const titleById = new Map(courses.map((c) => [c.id, c.title]));

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      actorEmail: row.adminEmail,
      courseId: row.courseId,
      courseTitle: row.courseId ? titleById.get(row.courseId) ?? null : null,
      /** True when this row is the learner acting, not being acted upon. */
      isActor: row.adminId === userId && row.userId !== userId,
      metadata: row.metadata,
      createdAt: row.createdAt,
    }));
  }

  private async buildAssessments(userId: string, courseIds: string[]) {
    // AssessmentAttempt carries no courseId — the join goes through Assessment.
    const attempts = await this.prisma.assessmentAttempt.findMany({
      where: { userId, assessment: { courseId: { in: courseIds } } },
      select: {
        id: true,
        assessmentId: true,
        status: true,
        percentage: true,
        isPassed: true,
        startedAt: true,
        submittedAt: true,
        finalizedAt: true,
        snapshotTitle: true,
        snapshotPassingPct: true,
        assessment: { select: { courseId: true } },
      },
      orderBy: { startedAt: 'desc' },
    });

    // Rolled up per assessment: an admin wants "2 attempts, best 78%, passed",
    // not a raw attempt log.
    const byAssessment = new Map<string, any>();
    for (const attempt of attempts) {
      const existing = byAssessment.get(attempt.assessmentId);
      if (!existing) {
        byAssessment.set(attempt.assessmentId, {
          courseId: attempt.assessment.courseId,
          assessmentId: attempt.assessmentId,
          title: attempt.snapshotTitle,
          passingPercentage: attempt.snapshotPassingPct,
          attempts: 1,
          bestPercentage: attempt.percentage,
          isPassed: attempt.isPassed === true,
          lastAttemptAt: attempt.startedAt,
          status: attempt.status,
        });
        continue;
      }
      existing.attempts += 1;
      existing.isPassed = existing.isPassed || attempt.isPassed === true;
      if (
        attempt.percentage != null &&
        (existing.bestPercentage == null ||
          attempt.percentage > existing.bestPercentage)
      ) {
        existing.bestPercentage = attempt.percentage;
      }
    }

    return Array.from(byAssessment.values());
  }

  private buildSummary(courses: any[]) {
    return {
      totalCourses: courses.length,
      activeCourses: courses.filter((c) => c.enrollment.isActive).length,
      completedCourses: courses.filter((c) => c.progress.isCompleted).length,
      coursesOnLatestVersion: courses.filter(
        (c) => c.versionStatus === 'on_latest',
      ).length,
      coursesBehindLatest: courses.filter((c) => c.versionStatus === 'behind')
        .length,
      coursesNotPinned: courses.filter((c) => c.versionStatus === 'not_pinned')
        .length,
      // Sections consumed but a quiz still outstanding — the population that
      // reads "100%" to a learner while the completion gate correctly holds.
      coursesAwaitingQuiz: courses.filter(
        (c) =>
          !c.progress.isCompleted &&
          c.progress.percentage >= 100 &&
          (c.quizGate?.outstandingChapters?.length ?? 0) > 0,
      ).length,
      totalTimeSpentSeconds: courses.reduce(
        (sum, c) => sum + (c.activity.timeSpentSeconds ?? 0),
        0,
      ),
    };
  }

  private emptySnapshot(learner: any, auditTrail?: any[]) {
    return {
      message: 'Learner versioning snapshot retrieved',
      statusCode: 200,
      data: {
        learner,
        summary: {
          totalCourses: 0,
          activeCourses: 0,
          completedCourses: 0,
          coursesOnLatestVersion: 0,
          coursesBehindLatest: 0,
          coursesNotPinned: 0,
          coursesAwaitingQuiz: 0,
          totalTimeSpentSeconds: 0,
        },
        courses: [],
        ...(auditTrail ? { auditTrail } : {}),
      },
    };
  }
}
