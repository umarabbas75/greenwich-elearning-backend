import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
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
