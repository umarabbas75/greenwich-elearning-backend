import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { FeedbackService } from '../feedback/feedback.service';
import { CourseVersionService } from '../course-version/course-version.service';
import { CertificateService } from '../certificate/certificate.service';

/**
 * Owns the course-completion predicate and the side effects that fire the first
 * time a learner completes a course.
 *
 * Extracted from CourseService so BOTH write paths that can complete a course
 * share one implementation:
 *
 *   - a section is marked complete  → CourseService.updateUserChapterProgress
 *   - a chapter quiz is passed      → QuizService.createChapterQuizzesReport
 *
 * Before this existed, only the section path re-evaluated completion. On a
 * course where every chapter carries a quiz (and especially where the LAST
 * chapter does), the learner's final act is passing a quiz — so completion was
 * never re-checked and `courseCompletedAt` would never be stamped once the
 * predicate started requiring quizzes.
 *
 * This is a leaf module imported by both CourseModule and QuizModule. It is NOT
 * a free function in src/utils because completion has real side effects (the
 * congratulations email and the feedback request), and QuizService has neither
 * MailService nor FeedbackService — a free function would have to receive them
 * as parameters and QuizService would have to pass `undefined`, meaning
 * quiz-triggered completions would silently send no email.
 */
@Injectable()
export class CourseCompletionService {
  private static readonly logger = new Logger(CourseCompletionService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private feedbackService: FeedbackService,
    private courseVersionService: CourseVersionService,
    private certificateService: CertificateService,
  ) {}

  /**
   * Content-completion check. A course is "completed" once the learner has:
   *   1. a UserCourseProgress row for every section in their curriculum, AND
   *   2. a passing QuizProgress for every chapter in their curriculum that
   *      carries a quiz.
   *
   * (2) matches what `isChapterComplete` (src/utils/chapter-progression.ts)
   * already requires per chapter. Before it was added here, the two disagreed:
   * a chapter quiz gated ADVANCING past a chapter but not COMPLETING the
   * course, so any chapter whose quiz a learner never needed to pass — most
   * reachably the last one — was silently skippable.
   *
   * Assessment pass is tracked separately on CourseCompletion (isPassed /
   * assessmentPassedAt) and is NOT required for completion.
   *
   * Best-effort: never throws into the caller — a completion-bookkeeping
   * failure must not fail recording the learner's progress or their quiz
   * submission. Idempotent: courseCompletedAt is only stamped once, so an
   * already-completed learner can never be revoked by a later rule change.
   */
  async checkContentCompletion(
    userId: string,
    courseId: string,
  ): Promise<void> {
    try {
      const {
        total: totalSections,
        liveSectionIds,
        quizBearingChapterIds,
      } = await this.courseVersionService.countCompletionDenominator(
        userId,
        courseId,
      );
      if (totalSections === 0) return;

      const progressed = await this.prisma.userCourseProgress.findMany({
        where: { userId, courseId, sectionId: { in: liveSectionIds } },
        select: { sectionId: true },
        distinct: ['sectionId'],
      });
      if (progressed.length < totalSections) return;

      // Every quiz-bearing chapter must have a passing QuizProgress. Runs
      // AFTER the section check so the common early-exit still short-circuits
      // on the cheaper query, and is skipped entirely when the curriculum has
      // no quizzes — keeping zero-quiz courses on exactly the previous query
      // path. QuizProgress is @@unique([userId, chapterId]) so count is exact.
      if (quizBearingChapterIds.length > 0) {
        const passedCount = await this.prisma.quizProgress.count({
          where: {
            userId,
            chapterId: { in: quizBearingChapterIds },
            isPassed: true,
          },
        });
        if (passedCount < quizBearingChapterIds.length) return;
      }

      // 100% of content done — stamp it, exactly once.
      //
      // Read-then-write is not enough here: A0 added a SECOND concurrent
      // caller (the quiz-pass path), so a learner's final section-complete and
      // their final quiz submission can land together. Both would read
      // courseCompletedAt: null, both would write, and both would send the
      // congratulations email and feedback request — and the second write
      // would move courseCompletedAt, shifting the post-completion expiry
      // window that getAllAssignedCourses derives from it.
      //
      // updateMany with `courseCompletedAt: null` in the WHERE is a
      // conditional write: exactly one racer can match, and its count tells us
      // who won. Emails are sent only by that winner.
      const existing = await this.prisma.courseCompletion.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: { id: true, courseCompletedAt: true },
      });
      if (existing?.courseCompletedAt) return; // already recorded

      let justCompleted: boolean;
      if (existing) {
        const claimed = await this.prisma.courseCompletion.updateMany({
          where: { userId, courseId, courseCompletedAt: null },
          data: { courseCompletedAt: new Date() },
        });
        justCompleted = claimed.count === 1;
      } else {
        // No row yet. The unique constraint on (userId, courseId) makes the
        // loser of a create race fail rather than double-send.
        try {
          await this.prisma.courseCompletion.create({
            data: { userId, courseId, courseCompletedAt: new Date() },
          });
          justCompleted = true;
        } catch {
          // Lost the race — the winner sends the emails.
          justCompleted = false;
        }
      }
      if (!justCompleted) return;

      // Course was JUST completed (first time) — send the milestone emails.
      await this.sendCompletionEmails(userId, courseId);
      await this.feedbackService.notifyFeedbackRequiredIfNeeded(
        userId,
        courseId,
      );
      await this.certificateService.tryIssueCertificate(userId, courseId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      CourseCompletionService.logger.warn(
        `Content-completion check failed for user ${userId}, course ${courseId}: ${message}`,
      );
    }
  }

  /**
   * On first course completion: (1) a congratulations email, and (2) — if the
   * course has a feedback form the user hasn't submitted yet — a separate
   * feedback-request email. Best-effort: never throws into the completion path.
   */
  private async sendCompletionEmails(
    userId: string,
    courseId: string,
  ): Promise<void> {
    try {
      const [user, course] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { email: true, firstName: true, deletedAt: true },
        }),
        this.prisma.course.findUnique({
          where: { id: courseId },
          select: { title: true },
        }),
      ]);
      if (!user?.email || user.deletedAt || !course) return;

      // 1) Congratulations.
      await this.mail.sendCourseCompleted({
        to: user.email,
        userId,
        firstName: user.firstName ?? '',
        courseTitle: course.title,
        courseId,
      });

      // 2) Feedback request — only if an active feedback form exists for the
      //    course AND the user hasn't already submitted feedback.
      const [form, alreadySubmitted] = await Promise.all([
        this.prisma.courseFeedbackForm.findFirst({
          where: { courseId, isActive: true },
          select: { id: true },
        }),
        this.prisma.courseFeedbackSubmission.findFirst({
          where: { userId, courseId },
          select: { id: true },
        }),
      ]);
      if (form && !alreadySubmitted) {
        await this.mail.sendFeedbackRequest({
          to: user.email,
          userId,
          firstName: user.firstName ?? '',
          courseTitle: course.title,
          courseId,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      CourseCompletionService.logger.warn(
        `Completion emails failed for user ${userId}, course ${courseId}: ${message}`,
      );
    }
  }
}
