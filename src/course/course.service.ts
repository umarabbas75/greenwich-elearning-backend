import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Course, Module, Chapter, Section, Prisma, Role, NotificationType } from '@prisma/client';
import {
  // AssignCourseDto,
  CourseDto,
  ModuleDto,
  ResponseDto,
  UpdateCourseDto,
  CreateSectionDto,
  CreateMatchAndLearnSectionDto,
  CreateVisualActivitySectionDto,
  CreateOrderingSectionDto,
  CreateMatchingSectionDto,
  CreateFlashcardsSectionDto,
  UpdateSectionDto,
  UpdateMatchAndLearnSectionDto,
  UpdateVisualActivitySectionDto,
  UpdateOrderingSectionDto,
  UpdateMatchingSectionDto,
  UpdateFlashcardsSectionDto,
  UpdateSectionOrderDto,
  SectionType,
} from '../dto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertChapterAccessible,
  recordChapterAndModuleCompletionIfNeeded,
} from '../utils/chapter-progression';
import {
  applyModuleRollup,
  buildChapterActivityMaps,
  buildChapterReportRow,
  SectionReportMeta,
} from '../utils/course-report';
import { assertNoInlineBase64 } from '../utils/reject-inline-base64';
import { buildFlashcardsConfig, FlashcardsConfig } from '../utils/flashcards-section';
import { promoteFormPhotoToUserIfMissing } from '../utils/promote-form-photo-to-user';
import { promoteFormAddressToUserIfMissing } from '../utils/promote-form-address-to-user';
import { assertValidAdvisorReviewMetadata, evaluateRegistrationAccess, getAdvisorComments, getAdvisorRegistrationStatus, isV2BookingMetadata } from '../utils/advisor-review-metadata';
import { MailService } from '../mail/mail.service';
import { ADMIN_EMAIL } from '../mail/templates/mail-layout';
import { FeedbackService } from '../feedback/feedback.service';
import { CourseVersionService } from '../course-version/course-version.service';
import {
  parseManifest,
  isIdReferencedInManifest,
} from '../course-version/course-version.manifest';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { NotificationService } from '../notifications/notification.service';
import {
  computeLearnerPercentages,
  percentageKey,
} from '../course-version/learner-percentage';
@Injectable()
export class CourseService {
  private static readonly completionLogger = new Logger(CourseService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private mail: MailService,
    private feedbackService: FeedbackService,
    private courseVersionService: CourseVersionService,
    private courseCompletion: CourseCompletionService,
    private notifications: NotificationService,
  ) {}

  /** True iff the learner has been certified-complete on this course. */
  private async isCourseFrozen(
    userId: string,
    courseId: string,
  ): Promise<boolean> {
    const completion = await this.prisma.courseCompletion.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { courseCompletedAt: true },
    });
    return !!completion?.courseCompletedAt;
  }

  private shuffleArray<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Publishes a new version after admin structural edits (add/remove module/chapter/section). */
  private async autoPublishAfterStructureChange(
    courseId: string,
    adminId: string | null | undefined,
    changeNotes: string,
  ): Promise<{ versionNumber: number; versionId: string } | null> {
    try {
      const published =
        await this.courseVersionService.autoPublishAfterStructuralChange(
          courseId,
          adminId,
          changeNotes,
        );
      // `published` is null when nothing structural changed (dedup skip) — guard
      // the deref so a skipped publish doesn't throw here and get logged as a
      // spurious "Auto-publish failed".
      if (published) {
        CourseService.completionLogger.log(
          `Auto-published v${published.versionNumber} for course ${courseId}`,
        );
      }
      return published;
    } catch (error) {
      CourseService.completionLogger.error(
        `Auto-publish failed for course ${courseId}: ${
          error?.message ?? error
        }`,
      );
      return null;
    }
  }

  private async resolveCourseIdFromModuleId(moduleId: string): Promise<string> {
    const mod = await this.prisma.module.findUnique({
      where: { id: moduleId },
      select: { courseId: true },
    });
    if (!mod) {
      throw new Error('Module not found');
    }
    return mod.courseId;
  }

  private async resolveCourseIdFromChapterId(
    chapterId: string,
  ): Promise<string> {
    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { module: { select: { courseId: true } } },
    });
    if (!chapter) {
      throw new Error('Chapter not found');
    }
    return chapter.module.courseId;
  }

  /**
   * Enumerates every learner-state table keyed by (userId, courseId, …) that
   * needs to be cleaned up when an enrollment is destroyed. This is the shared
   * source of truth for both:
   *
   *   - unAssignCourse's "hasResidualState" refusal (the 409 guard)
   *   - resetUserCourseProgress's transaction body (via wipeUserCourseState)
   *
   * Keeping both paths driven by this single enumeration prevents the failure
   * mode Claude's review caught: unassign shipped with 6 tables checked while
   * reset already deleted 13, so a learner with quiz answers and an assessment
   * attempt but no section progress passed as "clean" and the loophole was
   * only narrowed, not closed.
   *
   * Returns per-table row counts (so the 409 body can tell the admin exactly
   * what would be wiped) plus a rolled-up `hasAny` boolean.
   */
  private async probeUserCourseResidualState(
    userId: string,
    courseId: string,
  ): Promise<{
    hasAny: boolean;
    counts: {
      progressRows: number;
      chapterCompletions: number;
      moduleCompletions: number;
      courseCompleted: boolean;
      certified: boolean;
      timeSpentRows: number;
      lastSeenRows: number;
      quizProgressRows: number;
      quizAnswerRows: number;
      formCompletionRows: number;
      policyCompletionRows: number;
      policyItemCompletionRows: number;
      feedbackSubmissionRows: number;
      assessmentAttemptRows: number;
    };
    // Returned so the caller can forward them to wipeUserCourseState and avoid
    // the same two findMany round-trips being made twice per force-unassign.
    chapterIds: string[];
    assessmentIds: string[];
  }> {
    // QuizProgress / QuizAnswer / AssessmentAttempt aren't keyed by courseId;
    // they scope by chapterId / assessmentId. Resolve those ID sets first so
    // the counts are course-bounded and match what wipeUserCourseState will
    // actually delete.
    const [chapters, assessments] = await Promise.all([
      this.prisma.chapter.findMany({
        where: { module: { courseId } },
        select: { id: true },
      }),
      this.prisma.assessment.findMany({
        where: { courseId },
        select: { id: true },
      }),
    ]);
    const chapterIds = chapters.map((c) => c.id);
    const assessmentIds = assessments.map((a) => a.id);

    const [
      progressRows,
      chapterCompletions,
      moduleCompletions,
      courseCompletion,
      timeSpentRows,
      lastSeenRows,
      quizProgressRows,
      quizAnswerRows,
      formCompletionRows,
      policyCompletionRows,
      policyItemCompletionRows,
      feedbackSubmissionRows,
      assessmentAttemptRows,
    ] = await Promise.all([
      this.prisma.userCourseProgress.count({ where: { userId, courseId } }),
      this.prisma.userChapterCompletion.count({ where: { userId, courseId } }),
      this.prisma.userModuleCompletion.count({ where: { userId, courseId } }),
      this.prisma.courseCompletion.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: { id: true, isPassed: true, courseCompletedAt: true },
      }),
      this.prisma.sectionTimeSpent.count({ where: { userId, courseId } }),
      this.prisma.lastSeenSection.count({ where: { userId, courseId } }),
      chapterIds.length > 0
        ? this.prisma.quizProgress.count({
            where: { userId, chapterId: { in: chapterIds } },
          })
        : Promise.resolve(0),
      chapterIds.length > 0
        ? this.prisma.quizAnswer.count({
            where: { userId, chapterId: { in: chapterIds } },
          })
        : Promise.resolve(0),
      this.prisma.userFormCompletion.count({ where: { userId, courseId } }),
      this.prisma.userPolicyCompletion.count({ where: { userId, courseId } }),
      this.prisma.userPolicyItemCompletion.count({
        where: { userId, item: { policy: { courseId } } },
      }),
      this.prisma.courseFeedbackSubmission.count({
        where: { userId, courseId },
      }),
      assessmentIds.length > 0
        ? this.prisma.assessmentAttempt.count({
            where: { userId, assessmentId: { in: assessmentIds } },
          })
        : Promise.resolve(0),
    ]);

    const counts = {
      progressRows,
      chapterCompletions,
      moduleCompletions,
      courseCompleted: !!courseCompletion?.courseCompletedAt,
      certified: !!courseCompletion?.isPassed,
      timeSpentRows,
      lastSeenRows,
      quizProgressRows,
      quizAnswerRows,
      formCompletionRows,
      policyCompletionRows,
      policyItemCompletionRows,
      feedbackSubmissionRows,
      assessmentAttemptRows,
    };

    const hasAny =
      progressRows > 0 ||
      chapterCompletions > 0 ||
      moduleCompletions > 0 ||
      !!courseCompletion ||
      timeSpentRows > 0 ||
      lastSeenRows > 0 ||
      quizProgressRows > 0 ||
      quizAnswerRows > 0 ||
      formCompletionRows > 0 ||
      policyCompletionRows > 0 ||
      policyItemCompletionRows > 0 ||
      feedbackSubmissionRows > 0 ||
      assessmentAttemptRows > 0;

    return { hasAny, counts, chapterIds, assessmentIds };
  }

  /**
   * Deletes every learner-state row scoped to (userId, courseId) inside the
   * supplied transaction. Shared between unAssignCourse (force path) and
   * resetUserCourseProgress so the two enumerations cannot drift.
   *
   * `options.deleteSectionTimeSpent`:
   *   - true → hard-delete SectionTimeSpent rows (unassign: enrollment gone).
   *   - false → only reset attempt counters, preserving totalSeconds
   *     (resetUserCourseProgress: the enrollment survives).
   */
  private async wipeUserCourseState(
    tx: Prisma.TransactionClient,
    userId: string,
    courseId: string,
    options: {
      deleteSectionTimeSpent: boolean;
      // Pre-resolved by probeUserCourseResidualState in the force-unassign
      // path so the same findMany pair isn't run again inside the interactive
      // transaction. Callers that don't have them (resetUserCourseProgress)
      // can omit and we'll resolve here.
      chapterIds?: string[];
      assessmentIds?: string[];
    },
  ): Promise<{
    sectionProgress: number;
    lastSeen: number;
    quizProgress: number;
    quizAnswers: number;
    formCompletions: number;
    policyCompletions: number;
    policyItemCompletions: number;
    feedbackSubmissions: number;
    courseCompletions: number;
    chapterCompletions: number;
    moduleCompletions: number;
    sectionTimeSpent: number;
    assessmentAttempts: number;
  }> {
    let chapterIds = options.chapterIds;
    let assessmentIds = options.assessmentIds;
    if (!chapterIds || !assessmentIds) {
      const [chapters, assessments] = await Promise.all([
        tx.chapter.findMany({
          where: { module: { courseId } },
          select: { id: true },
        }),
        tx.assessment.findMany({
          where: { courseId },
          select: { id: true },
        }),
      ]);
      chapterIds = chapters.map((c) => c.id);
      assessmentIds = assessments.map((a) => a.id);
    }

    const sectionProgress = await tx.userCourseProgress.deleteMany({
      where: { userId, courseId },
    });
    const lastSeen = await tx.lastSeenSection.deleteMany({
      where: { userId, courseId },
    });
    const quizProgress =
      chapterIds.length > 0
        ? await tx.quizProgress.deleteMany({
            where: { userId, chapterId: { in: chapterIds } },
          })
        : { count: 0 };
    const quizAnswers =
      chapterIds.length > 0
        ? await tx.quizAnswer.deleteMany({
            where: { userId, chapterId: { in: chapterIds } },
          })
        : { count: 0 };
    const formCompletions = await tx.userFormCompletion.deleteMany({
      where: { userId, courseId },
    });
    const policyCompletions = await tx.userPolicyCompletion.deleteMany({
      where: { userId, courseId },
    });
    const policyItemCompletions = await tx.userPolicyItemCompletion.deleteMany({
      where: { userId, item: { policy: { courseId } } },
    });
    const feedbackSubmissions = await tx.courseFeedbackSubmission.deleteMany({
      where: { userId, courseId },
    });
    const courseCompletions = await tx.courseCompletion.deleteMany({
      where: { userId, courseId },
    });
    const chapterCompletions = await tx.userChapterCompletion.deleteMany({
      where: { userId, courseId },
    });
    const moduleCompletions = await tx.userModuleCompletion.deleteMany({
      where: { userId, courseId },
    });
    let sectionTimeSpentCount = 0;
    if (options.deleteSectionTimeSpent) {
      const res = await tx.sectionTimeSpent.deleteMany({
        where: { userId, courseId },
      });
      sectionTimeSpentCount = res.count;
    } else {
      // resetUserCourseProgress semantics: keep the row (preserve totalSeconds
      // as an engagement metric) but reset the attempt counters.
      const res = await tx.sectionTimeSpent.updateMany({
        where: { userId, courseId },
        data: {
          totalAttempts: 0,
          firstAttemptAt: null,
          lastAttemptAt: null,
        },
      });
      sectionTimeSpentCount = res.count;
    }
    const assessmentAttempts =
      assessmentIds.length > 0
        ? await tx.assessmentAttempt.deleteMany({
            where: { userId, assessmentId: { in: assessmentIds } },
          })
        : { count: 0 };

    return {
      sectionProgress: sectionProgress.count,
      lastSeen: lastSeen.count,
      quizProgress: quizProgress.count,
      quizAnswers: quizAnswers.count,
      formCompletions: formCompletions.count,
      policyCompletions: policyCompletions.count,
      policyItemCompletions: policyItemCompletions.count,
      feedbackSubmissions: feedbackSubmissions.count,
      courseCompletions: courseCompletions.count,
      chapterCompletions: chapterCompletions.count,
      moduleCompletions: moduleCompletions.count,
      sectionTimeSpent: sectionTimeSpentCount,
      assessmentAttempts: assessmentAttempts.count,
    };
  }

  /**
   * Builds the delete-response `message` string when a live row was archived
   * instead of hard-deleted (because it is referenced by a published version).
   * The response now carries `outcome`, `stillServedTo`, and
   * `versionsReferencing` in structured form for the FE; this string is the
   * human-friendly summary the admin sees in a toast.
   *
   * Example:
   *   "Archived — hidden from new users, but still shown to 12 active users
   *    on Version 3, 2."
   */
  private buildArchiveMessage(
    entity: 'Module' | 'Chapter' | 'Section' | 'Quiz',
    stillServedTo: number,
    versions: Array<{ versionNumber: number }>,
  ): string {
    // Delegates to CourseVersionService.buildArchiveMessage so QuizService and
    // CourseService produce identical wording.
    return this.courseVersionService.buildArchiveMessage(
      entity,
      stillServedTo,
      versions,
    );
  }

  /**
   * Archiving a module/chapter/section/quiz is the highest-consequence
   * structural action an admin takes — a section referenced by v3 is still
   * shown to every learner pinned to v3 even though it "disappeared" from
   * the admin list. Prior to this audit write, that action left no trace at
   * all; only the follow-up auto-publish (which the admin doesn't attribute
   * to their own click) hit the log.
   *
   * Best-effort — never throws — delegates to CourseVersionService.writeAudit
   * so all admin audit rows go through the same denormalisation and
   * failure-swallow path.
   */
  private async writeArchiveAudit(params: {
    adminId?: string;
    entity: 'Module' | 'Chapter' | 'Section' | 'Quiz';
    targetId: string;
    courseId: string;
    title?: string | null;
    stillServedTo: number;
    versions: Array<{
      versionId: string;
      versionNumber: number;
      status: string;
      enrollmentCount: number;
    }>;
  }): Promise<void> {
    if (!params.adminId) return;
    await this.courseVersionService.writeAudit({
      adminId: params.adminId,
      action: `ARCHIVE_${params.entity.toUpperCase()}`,
      targetType: params.entity,
      targetId: params.targetId,
      courseId: params.courseId,
      metadata: {
        title: params.title ?? null,
        stillServedTo: params.stillServedTo,
        versions: params.versions.map((v) => ({
          versionNumber: v.versionNumber,
          status: v.status,
          enrollmentCount: v.enrollmentCount,
        })),
      },
    });
  }

  private assertValidOrderingItems(
    items: { id: string }[],
    correctOrder: string[],
  ): void {
    const ids = new Set(items.map((i) => i.id));
    if (ids.size !== items.length) {
      throw new Error('Ordering items must have unique ids');
    }
    if (correctOrder.length !== ids.size) {
      throw new Error('correctOrder must list each item id exactly once');
    }
    for (const id of correctOrder) {
      if (!ids.has(id)) {
        throw new Error(`correctOrder references unknown id: ${id}`);
      }
    }
  }

  private sanitizeLessonSectionForStudent(
    section: Record<string, unknown>,
  ): void {
    if (section.type === SectionType.ORDERING) {
      section.config = null;
    } else if (section.type === SectionType.MATCHING) {
      const cfg = section.config as {
        pairs?: Array<{ id: string; left: string; right: string }>;
      } | null;
      if (cfg?.pairs?.length) {
        const categories = this.shuffleArray(
          cfg.pairs.map((p) => ({ id: p.id, text: p.right })),
        );
        section.config = {
          pairs: cfg.pairs.map((p) => ({ id: p.id, left: p.left })),
          categories,
        };
      }
    }
  }

  async markFormComplete(
    userId: string,
    userRole: Role,
    courseId: string,
    formId: string,
    metadata: Record<string, unknown> | undefined,
    courseFormId: string,
  ): Promise<any> {
    const courseForm = await this.prisma.courseForm.findUnique({
      where: { id: courseFormId },
    });
    if (!courseForm) {
      throw new BadRequestException({
        detail:
          'Invalid courseFormId: that course form assignment was not found',
      });
    }
    if (courseForm.courseId !== courseId || courseForm.formId !== formId) {
      throw new BadRequestException({
        detail: 'courseFormId does not match the given courseId and formId',
      });
    }

    await this._assertEnrollmentUsable(userId, courseId, userRole);

    const existing = await this.prisma.userFormCompletion.findUnique({
      where: {
        userId_courseId_formId: { userId, courseId, formId },
      },
    });
    if (existing?.isComplete) {
      return {
        alreadyCompleted: true,
        id: existing.id,
        courseFormId: existing.courseFormId,
        formId: existing.formId,
        completedAt: existing.completedAt,
        metadata: existing.metadata,
      };
    }

    const completion = await this.prisma.userFormCompletion.upsert({
      where: {
        userId_courseId_formId: {
          userId,
          courseId,
          formId,
        },
      },
      create: {
        userId,
        courseId,
        formId,
        courseFormId,
        isComplete: true,
        completedAt: new Date(),
        metadata: (metadata ?? {}) as Prisma.InputJsonValue,
      },
      update: {
        isComplete: true,
        completedAt: new Date(),
        metadata: (metadata ?? {}) as Prisma.InputJsonValue,
        courseFormId,
      },
    });

    try {
      await promoteFormPhotoToUserIfMissing(this.prisma, userId, metadata);
    } catch (photoErr) {
      const msg =
        photoErr instanceof Error ? photoErr.message : String(photoErr);
      CourseService.completionLogger.warn(
        `Form photo promotion failed for user ${userId}: ${msg}`,
      );
    }

    try {
      await promoteFormAddressToUserIfMissing(this.prisma, userId, metadata);
    } catch (addressErr) {
      const msg =
        addressErr instanceof Error ? addressErr.message : String(addressErr);
      CourseService.completionLogger.warn(
        `Form address promotion failed for user ${userId}: ${msg}`,
      );
    }

    try {
      await this.notifyRegistrationSubmittedIfV2({
        learnerUserId: userId,
        courseId,
        formId,
        courseFormId,
        metadata,
      });
    } catch (notifyErr) {
      const msg =
        notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
      CourseService.completionLogger.warn(
        `Registration submit notify failed for user ${userId}: ${msg}`,
      );
    }

    return completion;
  }

  /**
   * Admin-only advisor review of a v2 registration form.
   * Overwrites `metadata` only — completion flags and side effects stay untouched.
   */
  async updateFormMetadata(
    _adminId: string,
    adminRole: Role,
    learnerUserId: string,
    courseId: string,
    formId: string,
    courseFormId: string,
    metaData: Record<string, unknown>,
  ): Promise<{
    success: true;
    form: {
      id: string;
      userId: string;
      courseId: string;
      formId: string;
      courseFormId: string;
      isComplete: boolean;
      completedAt: Date | null;
      metadata: Prisma.JsonValue;
    };
  }> {
    if (adminRole !== Role.admin) {
      throw new ForbiddenException({
        detail: 'Only admins can review registration forms',
      });
    }

    if (formId !== 'registration-form') {
      throw new BadRequestException({
        detail: 'Advisor review is only supported for registration-form',
      });
    }

    assertValidAdvisorReviewMetadata(metaData);

    const courseForm = await this.prisma.courseForm.findUnique({
      where: { id: courseFormId },
    });
    if (!courseForm) {
      throw new BadRequestException({
        detail:
          'Invalid courseFormId: that course form assignment was not found',
      });
    }
    if (courseForm.courseId !== courseId || courseForm.formId !== formId) {
      throw new BadRequestException({
        detail: 'courseFormId does not match the given courseId and formId',
      });
    }

    const existing = await this.prisma.userFormCompletion.findUnique({
      where: {
        userId_courseId_formId: {
          userId: learnerUserId,
          courseId,
          formId,
        },
      },
    });
    if (!existing) {
      throw new BadRequestException({
        detail: 'No registration form submission was found for this user',
      });
    }
    if (existing.courseFormId !== courseFormId) {
      throw new BadRequestException({
        detail:
          'courseFormId does not match this user\'s registration form submission',
      });
    }

    const updated = await this.prisma.userFormCompletion.update({
      where: { id: existing.id },
      data: {
        metadata: metaData as Prisma.InputJsonValue,
      },
    });

    try {
      await this.notifyRegistrationReviewed({
        learnerUserId,
        courseId,
        metadata: metaData,
      });
    } catch (notifyErr) {
      const msg =
        notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
      CourseService.completionLogger.warn(
        `Registration review notify failed for user ${learnerUserId}: ${msg}`,
      );
    }

    return {
      success: true,
      form: {
        id: updated.id,
        userId: updated.userId,
        courseId: updated.courseId,
        formId: updated.formId,
        courseFormId: updated.courseFormId,
        isComplete: updated.isComplete,
        completedAt: updated.completedAt,
        metadata: updated.metadata,
      },
    };
  }

  private async notifyRegistrationSubmittedIfV2(args: {
    learnerUserId: string;
    courseId: string;
    formId: string;
    courseFormId: string;
    metadata: Record<string, unknown> | undefined;
  }): Promise<void> {
    if (args.formId !== 'registration-form' || !isV2BookingMetadata(args.metadata)) {
      return;
    }

    const [learner, course, admins] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: args.learnerUserId },
        select: { id: true, email: true, firstName: true, lastName: true },
      }),
      this.prisma.course.findUnique({
        where: { id: args.courseId },
        select: { title: true },
      }),
      this.prisma.user.findMany({
        where: { role: Role.admin, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!learner || !course) {
      return;
    }

    const studentName =
      `${learner.firstName ?? ''} ${learner.lastName ?? ''}`.trim() ||
      'A learner';
    const adminIds = admins.map((a) => a.id);

    if (adminIds.length > 0) {
      await this.notifications.createNotificationForMany({
        userIds: adminIds,
        emailCcAddresses: [ADMIN_EMAIL],
        type: NotificationType.REGISTRATION_SUBMITTED,
        message: `${studentName} submitted a registration form for ${course.title}`,
        payload: {
          userId: learner.id,
          courseId: args.courseId,
          courseTitle: course.title,
          formId: args.formId,
          courseFormId: args.courseFormId,
          studentFirstName: learner.firstName,
          studentLastName: learner.lastName,
        },
        groupKey: `registration-submitted:${args.courseId}`,
        dedupeKeyFor: (adminId) =>
          `registration-submitted:${args.courseFormId}:${learner.id}:${adminId}`,
        referenceId: args.courseId,
        commenterId: learner.id,
        email: {
          excludeUserId: learner.id,
          build: (recipient) => ({
            kind: 'REGISTRATION_SUBMITTED',
            to: recipient.email,
            userId: recipient.id,
            recipientFirstName: recipient.firstName,
            studentName,
            courseTitle: course.title,
            learnerUserId: learner.id,
            courseId: args.courseId,
            courseFormId: args.courseFormId,
          }),
        },
      });
    } else {
      await this.mail.sendNotificationEmail({
        kind: 'REGISTRATION_SUBMITTED',
        to: ADMIN_EMAIL,
        userId: null,
        recipientFirstName: 'there',
        studentName,
        courseTitle: course.title,
        learnerUserId: learner.id,
        courseId: args.courseId,
        courseFormId: args.courseFormId,
      });
    }

    if (learner.email) {
      await this.mail.sendRegistrationReceived({
        to: learner.email,
        userId: learner.id,
        firstName: learner.firstName,
        courseTitle: course.title,
        courseId: args.courseId,
      });
    }
  }

  private async notifyRegistrationReviewed(args: {
    learnerUserId: string;
    courseId: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    const status = getAdvisorRegistrationStatus(args.metadata);
    if (!status) {
      return;
    }
    const comments = getAdvisorComments(args.metadata);

    const [learner, course] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: args.learnerUserId },
        select: { id: true, firstName: true },
      }),
      this.prisma.course.findUnique({
        where: { id: args.courseId },
        select: { title: true },
      }),
    ]);
    if (!learner || !course) {
      return;
    }

    await this.notifications.createNotification({
      userId: learner.id,
      type: NotificationType.REGISTRATION_REVIEWED,
      message: `Your registration for ${course.title} is ${status}`,
      payload: {
        courseId: args.courseId,
        courseTitle: course.title,
        registrationStatus: status,
        comments,
      },
      groupKey: `registration-reviewed:${args.courseId}`,
      dedupeKey: `registration-reviewed:${args.courseId}:${learner.id}:${status}:${
        comments ?? ''
      }`,
      referenceId: args.courseId,
      email: {
        build: (recipient) => ({
          kind: 'REGISTRATION_REVIEWED',
          to: recipient.email,
          userId: recipient.id,
          recipientFirstName: recipient.firstName,
          courseTitle: course.title,
          courseId: args.courseId,
          registrationStatus: status,
          comments,
        }),
      },
    });
  }

  /** Which requirement forms exist for the course and whether the current user completed them. */
  async getStudentCourseFormsStatus(
    userId: string,
    userRole: Role,
    courseId: string,
  ): Promise<{
    courseId: string;
    forms: Array<{
      courseFormId: string;
      formId: string;
      formName: string;
      isRequired: boolean;
      isComplete: boolean;
      completedAt: Date | null;
    }>;
  }> {
    await this._assertEnrollmentUsable(userId, courseId, userRole);

    const forms = await this.prisma.courseForm.findMany({
      where: { courseId },
      orderBy: { createdAt: 'asc' },
      include: {
        userFormCompletions: {
          where: { userId },
          take: 1,
        },
      },
    });

    return {
      courseId,
      forms: forms.map((f) => {
        const c = f.userFormCompletions[0];
        return {
          courseFormId: f.id,
          formId: f.formId,
          formName: f.formName,
          isRequired: f.isRequired,
          isComplete: c?.isComplete ?? false,
          completedAt: c?.completedAt ?? null,
        };
      }),
    };
  }

  /** Course forms for a user, including submitted answers (e.g. registration form metadata). */
  private async getCourseFormsWithMetadataForUser(
    userId: string,
    courseId: string,
  ): Promise<
    Array<{
      courseFormId: string;
      formId: string;
      formName: string;
      isRequired: boolean;
      isComplete: boolean;
      completedAt: Date | null;
      metadata: Prisma.JsonValue | null;
    }>
  > {
    const forms = await this.prisma.courseForm.findMany({
      where: { courseId },
      orderBy: { createdAt: 'asc' },
      include: {
        userFormCompletions: {
          where: { userId },
          take: 1,
          select: {
            isComplete: true,
            completedAt: true,
            metadata: true,
          },
        },
      },
    });

    return forms.map((f) => {
      const c = f.userFormCompletions[0];
      return {
        courseFormId: f.id,
        formId: f.formId,
        formName: f.formName,
        isRequired: f.isRequired,
        isComplete: c?.isComplete ?? false,
        completedAt: c?.completedAt ?? null,
        metadata: c?.metadata ?? null,
      };
    });
  }

  /** Course completion feedback form + this learner's submission (if any). */
  private async getCourseFeedbackForUserReport(
    userId: string,
    courseId: string,
  ): Promise<{
    formName: string;
    isRequired: boolean;
    isActive: boolean;
    isSubmitted: boolean;
    submittedAt: Date | null;
    formVersion: string | null;
    meanRating: number | null;
    overallRating: string | null;
    learnerEmail: string | null;
    responses: Prisma.JsonValue | null;
  } | null> {
    const [form, submission] = await Promise.all([
      this.prisma.courseFeedbackForm.findUnique({
        where: { courseId },
        select: { formName: true, isRequired: true, isActive: true },
      }),
      this.prisma.courseFeedbackSubmission.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: {
          submittedAt: true,
          formVersion: true,
          meanRating: true,
          overallRating: true,
          learnerEmail: true,
          responses: true,
        },
      }),
    ]);

    if (!form) return null;

    return {
      formName: form.formName,
      isRequired: form.isRequired,
      isActive: form.isActive,
      isSubmitted: !!submission,
      submittedAt: submission?.submittedAt ?? null,
      formVersion: submission?.formVersion ?? null,
      meanRating:
        submission?.meanRating != null ? Number(submission.meanRating) : null,
      overallRating: submission?.overallRating ?? null,
      learnerEmail: submission?.learnerEmail ?? null,
      responses: submission?.responses ?? null,
    };
  }

  private async fetchReportActivityData(
    userId: string,
    courseId: string,
    chapterIds: string[],
  ) {
    const [
      progressRows,
      quizAnswerRows,
      lastSeenRows,
      quizProgressRows,
      timeSpentRows,
    ] = await Promise.all([
      this.prisma.userCourseProgress.findMany({
        where: { userId, courseId },
        select: { sectionId: true, chapterId: true, createdAt: true },
      }),
      chapterIds.length === 0
        ? Promise.resolve([] as { chapterId: string | null }[])
        : this.prisma.quizAnswer.findMany({
            where: {
              userId,
              isAnswerCorrect: true,
              chapterId: { in: chapterIds },
            },
            select: { chapterId: true },
          }),
      chapterIds.length === 0
        ? Promise.resolve(
            [] as Array<{
              chapterId: string;
              sectionId: string;
              createdAt: Date;
              updatedAt: Date;
            }>,
          )
        : this.prisma.lastSeenSection.findMany({
            where: { userId, chapterId: { in: chapterIds } },
            select: {
              chapterId: true,
              sectionId: true,
              createdAt: true,
              updatedAt: true,
            },
          }),
      chapterIds.length === 0
        ? Promise.resolve([])
        : this.prisma.quizProgress.findMany({
            where: { userId, chapterId: { in: chapterIds } },
          }),
      this.prisma.sectionTimeSpent.findMany({
        where: { userId, courseId },
        select: { sectionId: true, totalSeconds: true, totalAttempts: true },
      }),
    ]);

    return buildChapterActivityMaps({
      progressRows,
      quizAnswerRows,
      lastSeenRows,
      quizProgressRows,
      timeSpentRows,
    });
  }

  async markPolicyItemAsComplete({
    userId,
    courseId,
    policyId,
    policyItemId,
  }: {
    userId: string;
    courseId: string;
    policyId: string;
    policyItemId: string;
  }): Promise<ResponseDto> {
    try {
      // Execute all operations in a single transaction
      const [itemCompletion, requiredItems, completedItems] =
        await this.prisma.$transaction([
          // 1. Mark the individual Policy Item as completed
          this.prisma.userPolicyItemCompletion.upsert({
            where: {
              userId_itemId: {
                userId,
                itemId: policyItemId,
              },
            },
            update: {
              isComplete: true,
              completedAt: new Date(),
            },
            create: {
              userId,
              itemId: policyItemId,
              isComplete: true,
              completedAt: new Date(),
            },
          }),

          // 2. Get all required items for this policy
          this.prisma.policyItem.findMany({
            where: {
              policyId,
              isRequired: true,
            },
            select: { id: true },
          }),

          // 3. Get completed items (including the one we just marked)
          this.prisma.userPolicyItemCompletion.findMany({
            where: {
              userId,
              itemId: {
                in: await this.prisma.policyItem
                  .findMany({
                    where: { policyId, isRequired: true },
                    select: { id: true },
                  })
                  .then((items) => items.map((i) => i.id)),
              },
              isComplete: true,
            },
            select: { itemId: true },
          }),
        ]);

      // Check if all required items are completed
      const allRequiredItemsCompleted =
        requiredItems.length === completedItems.length;

      // 4. If all required items completed, mark policy as complete
      const policyCompletion = allRequiredItemsCompleted
        ? await this.prisma.userPolicyCompletion.upsert({
            where: {
              userId_courseId_policyId: {
                userId,
                courseId,
                policyId,
              },
            },
            update: {
              isComplete: true,
              completedAt: new Date(),
            },
            create: {
              userId,
              courseId,
              policyId,
              isComplete: true,
              completedAt: new Date(),
            },
          })
        : null;

      return {
        message:
          'Policy item marked as completed' +
          (allRequiredItemsCompleted ? ', Policy completed as well' : ''),
        statusCode: HttpStatus.OK,
        data: {
          itemCompletion,
          policyCompletion,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to mark policy item as completed',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async getUserPolicyCompletions({ courseId, userId }): Promise<any> {
    try {
      // Get all policies with their items and completion status
      const policies = await this.prisma.policy.findMany({
        where: { courseId },
        orderBy: { order: 'asc' },
        include: {
          items: {
            orderBy: { order: 'asc' },
            include: {
              completions: {
                where: { userId },
                select: {
                  isComplete: true,
                  completedAt: true,
                },
              },
            },
          },
          completions: {
            where: { userId },
            select: {
              isComplete: true,
              completedAt: true,
            },
          },
        },
      });

      // Transform the data to match the frontend expectations
      const transformedPolicies = policies.map((policy) => {
        // Calculate policy item completion status
        const items = policy.items.map((item) => ({
          policyItemId: item.id,
          title: item.title,
          description: item.description,
          link: item.link,
          isRequired: item.isRequired,
          isComplete: item.completions[0]?.isComplete || false,
          completedAt: item.completions[0]?.completedAt || null,
        }));

        // Policy is complete only if all required items are complete
        const isPolicyComplete =
          policy.completions[0]?.isComplete ||
          (items.length > 0 &&
            items.every((item) => !item.isRequired || item.isComplete));

        return {
          policyId: policy.id,
          title: policy.title,
          description: policy.description,
          isComplete: isPolicyComplete,
          completedAt: policy.completions[0]?.completedAt || null,
          items,
        };
      });

      // Calculate completion counts
      const totalPolicies = policies.length;
      const completedPolicies = transformedPolicies.filter(
        (p) => p.isComplete,
      ).length;
      const totalItems = transformedPolicies.reduce(
        (sum, policy) => sum + policy.items.length,
        0,
      );
      const completedItems = transformedPolicies.reduce(
        (sum, policy) =>
          sum + policy.items.filter((item) => item.isComplete).length,
        0,
      );

      // Calculate required items specific counts
      const allItems = transformedPolicies.flatMap((policy) => policy.items);
      const requiredItems = allItems.filter((item) => item.isRequired).length;
      const completedRequiredItems = allItems.filter(
        (item) => item.isRequired && item.isComplete,
      ).length;

      return {
        totalPolicies,
        completedPolicies,
        totalItems,
        completedItems,
        requiredItems, // Total number of required items
        completedRequiredItems, // Number of completed required items
        policies: transformedPolicies,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Failed to fetch policy completions',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getCourseReport(courseId: any, userId: any): Promise<any> {
    try {
      const [
        userDetails,
        completion,
        curriculum,
        courseForms,
        courseFeedback,
        chapterCompletions,
        moduleCompletions,
        newSinceCompletion,
        firstProgress,
      ] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            address: true,
            photo: true,
            role: true,
            status: true,
            timezone: true,
            createdAt: true,
          },
        }),
        this.prisma.courseCompletion.findUnique({
          where: { userId_courseId: { userId, courseId } },
          select: { courseCompletedAt: true },
        }),
        this.courseVersionService.resolveCurriculumTreeForReport(
          userId,
          courseId,
        ),
        this.getCourseFormsWithMetadataForUser(userId, courseId),
        this.getCourseFeedbackForUserReport(userId, courseId),
        this.prisma.userChapterCompletion.findMany({
          where: { userId, courseId },
          select: { chapterId: true, completedAt: true },
        }),
        this.prisma.userModuleCompletion.findMany({
          where: { userId, courseId },
          select: { moduleId: true, completedAt: true },
        }),
        this.courseVersionService.summarizeNewSincePinnedVersion(
          userId,
          courseId,
        ),
        this.prisma.userCourseProgress.findFirst({
          where: { userId, courseId },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
      ]);

      const isFrozen = !!completion?.courseCompletedAt;
      const courseStartDate = firstProgress?.createdAt ?? null;
      const chapterCompletedAtById = new Map(
        chapterCompletions.map((row) => [row.chapterId, row.completedAt]),
      );
      const moduleCompletedAtById = new Map(
        moduleCompletions.map((row) => [row.moduleId, row.completedAt]),
      );

      const reportMeta = {
        message: 'Successfully retrieved datas',
        statusCode: 200,
        user: userDetails,
        courseForms,
        courseFeedback,
        isCompleted: isFrozen,
        completedAt: completion?.courseCompletedAt ?? null,
        courseStartDate,
        ...(newSinceCompletion ? { newSinceCompletion } : {}),
      };

      if (curriculum.mode === 'versioned') {
        const { tree } = curriculum;
        const liveChapterIds = tree.modules.flatMap((m) =>
          m.chapters.map((c) => c.sourceChapterId),
        );

        const activity = await this.fetchReportActivityData(
          userId,
          courseId,
          liveChapterIds,
        );

        const totalSectionsInCourse = tree.modules.reduce((sum, mod) => {
          return (
            sum +
            mod.chapters.reduce(
              (chSum, chapter) => chSum + chapter.sections.length,
              0,
            )
          );
        }, 0);

        const modules = tree.modules.map((mod) => {
          const moduleId = mod.sourceModuleId;
          const chapters = mod.chapters.map((chapter) => {
            const sourceChapterId = chapter.sourceChapterId;
            const sectionMetas: SectionReportMeta[] = chapter.sections
              .sort(
                (a, b) =>
                  (a.orderIndex ?? Number.MAX_SAFE_INTEGER) -
                  (b.orderIndex ?? Number.MAX_SAFE_INTEGER),
              )
              .map((s) => ({
                id: s.id,
                title: s.title,
                orderIndex: s.orderIndex,
                type: s.type,
              }));

            return buildChapterReportRow({
              id: sourceChapterId,
              title: chapter.title,
              sectionMetas,
              quizzesTotal: chapter.quizzesTotal,
              activity,
              chapterCompletedAt:
                chapterCompletedAtById.get(sourceChapterId) ?? null,
              isFrozen,
            });
          });

          return applyModuleRollup(
            {
              id: moduleId,
              title: mod.title,
              completedAt: moduleCompletedAtById.get(moduleId) ?? null,
              chapters,
            },
            totalSectionsInCourse,
            isFrozen,
          );
        });

        return {
          ...reportMeta,
          data: modules,
          enrolledVersionNumber: curriculum.versionNumber,
        };
      }

      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
        select: {
          id: true,
          title: true,
          // Live fallback (unpinned learner). Sections already filtered
          // isArchived:false / isActive:true, but modules and chapters were
          // not — so archived modules and chapters used to render as empty
          // shells with a "0/0" activity block. Filter them out here so the
          // live report tree matches the versioned tree above.
          modules: {
            where: { isArchived: false },
            select: {
              id: true,
              title: true,
              chapters: {
                where: { isArchived: false },
                select: {
                  id: true,
                  title: true,
                  sections: {
                    where: { isArchived: false, isActive: true },
                    select: {
                      id: true,
                      title: true,
                      orderIndex: true,
                      type: true,
                    },
                    orderBy: { orderIndex: 'asc' },
                  },
                  _count: {
                    select: {
                      quizzes: { where: { isArchived: false } },
                    },
                  },
                },
                orderBy: { createdAt: 'asc' },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      const liveChapterIds = course.modules.flatMap((m) =>
        m.chapters.map((c) => c.id),
      );
      const activity = await this.fetchReportActivityData(
        userId,
        courseId,
        liveChapterIds,
      );

      const totalSectionsInCourse = course.modules.reduce(
        (sum, mod) =>
          sum +
          mod.chapters.reduce((chSum, ch) => chSum + ch.sections.length, 0),
        0,
      );

      const modules = course.modules.map((mod) => {
        const chapters = mod.chapters.map((chapter) => {
          const sectionMetas: SectionReportMeta[] = chapter.sections.map(
            (s) => ({
              id: s.id,
              title: s.title,
              orderIndex: s.orderIndex,
              type: s.type,
            }),
          );

          return buildChapterReportRow({
            id: chapter.id,
            title: chapter.title,
            sectionMetas,
            quizzesTotal: chapter._count.quizzes,
            activity,
            chapterCompletedAt: chapterCompletedAtById.get(chapter.id) ?? null,
            isFrozen,
          });
        });

        return applyModuleRollup(
          {
            id: mod.id,
            title: mod.title,
            completedAt: moduleCompletedAtById.get(mod.id) ?? null,
            chapters,
          },
          totalSectionsInCourse,
          isFrozen,
        );
      });

      return {
        ...reportMeta,
        data: modules,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async getCourseDates(courseId: any, userId: any): Promise<any> {
    try {
      const allProgressItem = await this.prisma.userCourseProgress.findMany({
        where: {
          courseId,
          userId,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      const courseStartDate = allProgressItem?.[0]?.createdAt;

      return {
        message: 'Successfully retrieved datas',
        statusCode: 200,
        data: { courseStartDate },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  // apis related to comments
  async deletePostComment(postId: any, commentId: any): Promise<ResponseDto> {
    try {
      const post = await this.prisma.comment.findUnique({
        where: { id: commentId, postId },
      });
      if (!post) {
        throw new Error('Post not found');
      }

      await this.prisma.comment.delete({
        where: { id: commentId, postId },
      });

      return {
        message: 'Successfully deleted post comment record',
        statusCode: 200,
        data: post,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        // Foreign key constraint violation
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error:
              'Cannot delete it because it is associated with other records.',
          },
          HttpStatus.FORBIDDEN,
        );
      } else {
        // Other errors
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error: error?.message || 'Something went wrong',
          },
          HttpStatus.FORBIDDEN,
          {
            cause: error,
          },
        );
      }
    }
  }

  async getPostComments(postId: any): Promise<any> {
    try {
      const postComments = await this.prisma.comment.findMany({
        where: {
          postId: postId,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      return {
        message: 'Successfully retrieved data',
        statusCode: 200,
        data: postComments,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async createPostComment(
    postId: any,
    userId: any,
    body: any,
  ): Promise<ResponseDto> {
    try {
      const comment = await this.prisma.comment.create({
        data: {
          content: body.content, // Assuming 'content' is the main content of the post
          postId: postId,
          userId, // Assuming you also have a userId field in the request body
        },
      });
      return {
        message: 'Successfully created post comment record',
        statusCode: 200,
        data: comment,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async updatePostComment(
    postId: string,
    commentId: any,
    body: any,
  ): Promise<ResponseDto> {
    try {
      const doesCommentExist = await this.prisma.comment.findUnique({
        where: { id: commentId, postId },
      });
      if (!doesCommentExist) {
        throw new Error('Comment does not exist');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      const updatePost = {};

      for (const [key, value] of Object.entries(body)) {
        updatePost[key] = value;
      }
      // Save the updated user
      const updatedPostComment = await this.prisma.comment.update({
        where: { id: commentId, postId }, // Specify the unique identifier for the user you want to update
        data: updatePost, // Pass the modified user object
      });

      return {
        message: 'Successfully updated post record',
        statusCode: 200,
        data: updatedPostComment,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  // api related to post
  async deletePost(id: string): Promise<ResponseDto> {
    try {
      const post = await this.prisma.post.findUnique({
        where: { id },
      });
      if (!post) {
        throw new Error('Post not found');
      }

      await this.prisma.post.delete({
        where: { id },
      });

      return {
        message: 'Successfully deleted post record',
        statusCode: 200,
        data: post,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        // Foreign key constraint violation
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error:
              'Cannot delete it because it is associated with other records.',
          },
          HttpStatus.FORBIDDEN,
        );
      } else {
        // Other errors
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error: error?.message || 'Something went wrong',
          },
          HttpStatus.FORBIDDEN,
          {
            cause: error,
          },
        );
      }
    }
  }

  async getPost(postId: any): Promise<any> {
    try {
      const posts = await this.prisma.post.findUnique({
        where: {
          id: postId,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      return {
        message: 'Successfully retrieved data',
        statusCode: 200,
        data: posts,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async getAllPosts(courseId: any): Promise<any> {
    try {
      const posts = await this.prisma.post.findMany({
        where: {
          courseId,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          comments: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return {
        message: 'Successfully fetch all posts',
        statusCode: 200,
        data: posts,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async createPost(
    courseId: any,
    userId: any,
    body: any,
  ): Promise<ResponseDto> {
    try {
      const post = await this.prisma.post.create({
        data: {
          title: body.title,
          content: body.content, // Assuming 'content' is the main content of the post
          courseId: courseId,
          userId, // Assuming you also have a userId field in the request body
        },
      });
      return {
        message: 'Successfully create post record',
        statusCode: 200,
        data: post,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async createPolicies(userId: any, body: any): Promise<ResponseDto> {
    try {
      const isCourseExist: any =
        await this.prisma.policiesAndProcedures.findUnique({
          where: { policiesId: body.policiesId },
        });
      if (isCourseExist) {
        throw new Error('Course already exist with specified title');
      }

      const policiesAndProcedures =
        await this.prisma.policiesAndProcedures.create({
          data: {
            policiesId: body?.policiesId,
            userId,
          },
        });
      return {
        message: 'Successfully updated record',
        statusCode: 200,
        data: policiesAndProcedures,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async getUserPolicies(userId: any): Promise<ResponseDto> {
    try {
      const policiesAndProcedures =
        await this.prisma.policiesAndProcedures.findMany({
          where: {
            userId,
          },
        });
      return {
        message: 'Record fetched successfully',
        statusCode: 200,
        data: policiesAndProcedures,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async deletePolicies(): Promise<ResponseDto> {
    try {
      const user = await this.prisma.policiesAndProcedures.deleteMany();

      return {
        message: 'Successfully deleted policies record',
        statusCode: 200,
        data: user,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async updatePost(id: string, body: UpdateCourseDto): Promise<ResponseDto> {
    try {
      const isPostExist = await this.prisma.post.findUnique({
        where: { id: id },
      });
      if (!isPostExist) {
        throw new Error('Post does not exist');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      const updatePost = {};

      for (const [key, value] of Object.entries(body)) {
        updatePost[key] = value;
      }
      // Save the updated user
      const updatedPost = await this.prisma.post.update({
        where: { id }, // Specify the unique identifier for the user you want to update
        data: updatePost, // Pass the modified user object
      });

      return {
        message: 'Successfully updated post record',
        statusCode: 200,
        data: updatedPost,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async createCourse(body: CourseDto): Promise<ResponseDto> {
    try {
      // Check if course exists
      const isCourseExist: Course = await this.prisma.course.findUnique({
        where: { title: body.title },
      });

      if (isCourseExist) {
        throw new Error('Course already exist with specified title');
      }
      console.log('test');
      // Create transaction for atomic operations
      const result = await this.prisma.$transaction(async (prisma) => {
        // 1. Create the course
        const course: Course = await prisma.course.create({
          data: {
            title: body.title,
            description: body.description,
            assessment: body.assessment,
            duration: body.duration,
            overview: body.overview,
            image: body.image,
            syllabusOverview: body.syllabusOverview,
            resourcesOverview: body.resourcesOverview,
            tutorInfo: body.tutorInfo,
            assessments: body.assessments,
            resources: body.resources,
            syllabus: body.syllabus,
            price: body.price,
            // Omit when not provided so the schema default (365) applies.
            ...(body.validityDays != null
              ? { validityDays: body.validityDays }
              : {}),
            ...(body.certificateIssueMode != null
              ? { certificateIssueMode: body.certificateIssueMode }
              : {}),
          },
        });

        // 2. Add required forms if specified
        if (body.courseForms && body.courseForms.length > 0) {
          await prisma.courseForm.createMany({
            data: body.courseForms.map((form) => ({
              courseId: course.id,
              formId: form.value,
              formName: form.label,
              isRequired: form.isRequired ?? true, // Use specified value or default to true
            })),
          });
        }

        // 3. Add feedback form if specified
        if (body.feedbackForm) {
          await prisma.courseFeedbackForm.create({
            data: {
              courseId: course.id,
              formName:
                body.feedbackForm.formName || 'Course Completion Feedback',
              formStructure: body.feedbackForm.formStructure || {},
              isRequired: body.feedbackForm.isRequired,
            },
          });
        }

        return course;
      });

      return {
        message: 'Successfully created course record with forms',
        statusCode: 200,
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async createModule(body: ModuleDto, adminId?: string): Promise<ResponseDto> {
    try {
      const module: Module = await this.prisma.module.create({
        data: {
          title: body.title,
          description: body.description,

          courseId: body.id,
        },
      });
      const publishedVersion = await this.autoPublishAfterStructureChange(
        body.id,
        adminId,
        `Added module "${body.title}"`,
      );
      return {
        message: publishedVersion
          ? `Successfully created module (published v${publishedVersion.versionNumber})`
          : 'Successfully create module record',
        statusCode: 200,
        data: module,
        publishedVersion: publishedVersion ?? undefined,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async createChapter(body: ModuleDto, adminId?: string): Promise<ResponseDto> {
    try {
      const courseId = await this.resolveCourseIdFromModuleId(body.id);
      const chapter: Chapter = await this.prisma.chapter.create({
        data: {
          title: body.title,
          description: body.description,
          pdfFile: body.pdfFile,
          moduleId: body.id,
        },
      });
      const publishedVersion = await this.autoPublishAfterStructureChange(
        courseId,
        adminId,
        `Added chapter "${body.title}"`,
      );
      return {
        message: publishedVersion
          ? `Successfully created chapter (published v${publishedVersion.versionNumber})`
          : 'Successfully create chapter record',
        statusCode: 200,
        data: chapter,
        publishedVersion: publishedVersion ?? undefined,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async createSection(
    body:
      | CreateSectionDto
      | CreateMatchAndLearnSectionDto
      | CreateVisualActivitySectionDto
      | CreateOrderingSectionDto
      | CreateMatchingSectionDto
      | CreateFlashcardsSectionDto,
    adminId?: string,
  ): Promise<ResponseDto> {
    try {
      assertNoInlineBase64(body.description);
      assertNoInlineBase64(body.shortDescription, 'shortDescription');
      const data: any = {
        title: body.title,
        description: body.description,
        shortDescription: body.shortDescription ?? '',
        type: body.type || SectionType.DEFAULT,
        chapterId: body.chapterId || (body as any).id, // Support old format with body.id
        moduleId: body.moduleId,
        orderIndex: body.orderIndex || null, // Order within chapter (null by default)
      };

      // Handle Match and Learn specific fields
      if (body.type === SectionType.MATCH_AND_LEARN) {
        const matchData = body as CreateMatchAndLearnSectionDto;

        // Extract unique categories from items if not provided
        const categories = matchData.categories || [
          ...new Set(matchData.items.map((item) => item.correctCategory)),
        ];

        data.itemLabel = matchData.itemLabel;
        data.categoryLabel = matchData.categoryLabel;
        data.categories = categories;
        data.maxPerCategory = matchData.maxPerCategory || 1;
        data.isActive = matchData.isActive ?? true;
        data.items = matchData.items; // Stored as JSON
      }

      // Handle Visual Activity specific fields
      if (body.type === SectionType.VISUAL_ACTIVITY) {
        const visualData = body as CreateVisualActivitySectionDto;

        // Validate that at least one option is correct
        const hasCorrectOption = visualData.options.some(
          (option) => option.isCorrect === true,
        );
        if (!hasCorrectOption) {
          throw new Error(
            'At least one option must be marked as correct for Visual Activity sections',
          );
        }

        data.questionText = visualData.questionText;
        data.imageUrl = visualData.imageUrl || null;
        data.allowMultipleSelection =
          visualData.allowMultipleSelection ?? false;
        data.options = visualData.options; // Stored as JSON
      }

      if (body.type === SectionType.ORDERING) {
        const ord = body as CreateOrderingSectionDto;
        this.assertValidOrderingItems(ord.items, ord.correctOrder);
        data.type = SectionType.ORDERING as any;
        data.questionText = ord.questionText ?? null;
        data.items = ord.items as unknown as Prisma.InputJsonValue;
        data.config = {
          correctOrder: ord.correctOrder,
        } as unknown as Prisma.InputJsonValue;
      }

      if (body.type === SectionType.MATCHING) {
        const mat = body as CreateMatchingSectionDto;
        const ids = new Set(mat.pairs.map((p) => p.id));
        if (ids.size !== mat.pairs.length) {
          throw new Error('Matching pairs must have unique ids');
        }
        data.type = SectionType.MATCHING as any;
        data.questionText = mat.questionText ?? null;
        data.config = { pairs: mat.pairs } as unknown as Prisma.InputJsonValue;
      }

      if (body.type === SectionType.FLASHCARDS) {
        const fc = body as CreateFlashcardsSectionDto;
        data.type = SectionType.FLASHCARDS as any;
        data.config = buildFlashcardsConfig(
          fc.cards,
          fc.layout,
        ) as unknown as Prisma.InputJsonValue;
      }

      const section: Section = await this.prisma.section.create({
        data,
      });

      const chapterId = section.chapterId;
      const courseId = await this.resolveCourseIdFromChapterId(chapterId);
      const publishedVersion = await this.autoPublishAfterStructureChange(
        courseId,
        adminId,
        `Added section "${section.title}"`,
      );

      return {
        message: publishedVersion
          ? `Successfully created section (published v${publishedVersion.versionNumber})`
          : 'Successfully create section record',
        statusCode: 200,
        data: section,
        publishedVersion: publishedVersion ?? undefined,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async getCourse(id: string): Promise<ResponseDto> {
    try {
      const course = await this.prisma.course.findUnique({
        where: { id },
        include: {
          courseForms: true, // Include the associated course forms
          Policy: {
            include: {
              items: true, // Include all policy items
            },
          },
          feedbackForm: true, // Include the feedback form
        },
      });

      if (!course) {
        throw new Error('Course not found');
      }

      return {
        message: 'Successfully fetched course info',
        statusCode: 200,
        data: {
          ...course,
          // Maintain backward compatibility by mapping Policy to CoursePolicy
          CoursePolicy:
            course.Policy?.flatMap((policy) => ({
              id: policy.id,
              courseId: policy.courseId,
              title: policy.title,
              description: policy.description,
              link: policy.items?.[0]?.link, // Use first item's link for backward compatibility
              isRequired: true, // Default to true for backward compatibility
              order: policy.order,
              createdAt: policy.createdAt,
              updatedAt: policy.updatedAt,
            })) || [],
          // Include feedback form information
          feedbackForm: course.feedbackForm
            ? {
                id: course.feedbackForm.id,
                formName: course.feedbackForm.formName,
                formStructure: course.feedbackForm.formStructure,
                isRequired: course.feedbackForm.isRequired,
                isActive: course.feedbackForm.isActive,
              }
            : null,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async canAccessCourseContent(
    userId: string,
    courseId: string,
  ): Promise<ResponseDto> {
    try {
      // First get the course with basic info and user assignment
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
        include: {
          users: {
            where: { userId },
            select: { id: true },
          },
        },
      });

      if (!course) {
        throw new Error('Course not found');
      }

      // Check if user is assigned to this course
      if (course.users.length === 0) {
        return {
          message: 'User is not assigned to this course',
          statusCode: 403,
          data: { canAccessContent: false },
        };
      }

      // Post-completion access window: once the course is completed, access
      // lasts course.validityDays days (default 365). After that the learner is
      // locked out until an admin renews access. Computed live; no row mutated.
      const completion = await this.prisma.courseCompletion.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: { courseCompletedAt: true },
      });
      if (completion?.courseCompletedAt) {
        const expiresAt = new Date(completion.courseCompletedAt);
        expiresAt.setDate(expiresAt.getDate() + (course.validityDays ?? 365));
        if (new Date() > expiresAt) {
          return {
            message: `Your access to this course expired on ${
              expiresAt.toISOString().split('T')[0]
            }. Please contact your administrator to renew access.`,
            statusCode: 403,
            data: { canAccessContent: false, expired: true, expiresAt },
          };
        }
      }

      // Now get all required data in parallel
      const [forms, policies, policyCompletions, policyItemCompletions, registrationForm] =
        await Promise.all([
          // Get required forms and their completions
          this.prisma.courseForm.findMany({
            where: {
              courseId,
              isRequired: true,
            },
            include: {
              userFormCompletions: {
                where: { userId },
                select: { isComplete: true, metadata: true },
              },
            },
          }),

          // Get all policies with their required items
          this.prisma.policy.findMany({
            where: { courseId },
            include: {
              items: {
                where: { isRequired: true },
                select: { id: true },
              },
            },
          }),

          // Get policy completions
          this.prisma.userPolicyCompletion.findMany({
            where: {
              userId,
              courseId,
              isComplete: true,
            },
            select: { policyId: true },
          }),

          // Get policy item completions
          this.prisma.userPolicyItemCompletion.findMany({
            where: {
              userId,
              isComplete: true,
              item: {
                policy: {
                  courseId,
                },
                isRequired: true,
              },
            },
            select: { itemId: true },
          }),

          this.prisma.courseForm.findFirst({
            where: { courseId, formId: 'registration-form' },
            include: {
              userFormCompletions: {
                where: { userId },
                select: { isComplete: true, metadata: true },
              },
            },
          }),
        ]);

      // Calculate form completion status
      const totalRequiredForms = forms.length;
      let completedForms = 0;
      const formStatus = forms.map((form) => {
        const isComplete = form.userFormCompletions[0]?.isComplete || false;
        if (isComplete) completedForms++;
        return {
          formId: form.formId,
          formName: form.formName,
          isRequired: form.isRequired,
          isComplete,
        };
      });

      // Calculate policy completion status
      const totalRequiredPolicies = policies.length;
      const completedPolicies = policyCompletions.length;

      // Calculate policy item completion status
      const totalRequiredPolicyItems = policies.reduce(
        (sum, policy) => sum + (policy.items?.length || 0),
        0,
      );
      const completedPolicyItems = policyItemCompletions.length;

      // Get detailed policy info for response
      const detailedPolicies = await this.prisma.policy.findMany({
        where: { courseId },
        include: {
          items: {
            include: {
              completions: {
                where: { userId },
                select: { isComplete: true },
              },
            },
          },
          completions: {
            where: { userId },
            select: { isComplete: true },
          },
        },
      });

      const policyStatus = detailedPolicies.map((policy) => ({
        policyId: policy.id,
        title: policy.title,
        description: policy.description,
        isComplete: policy.completions[0]?.isComplete || false,
        items: policy.items.map((item) => ({
          itemId: item.id,
          title: item.title,
          description: item.description,
          link: item.link,
          isRequired: item.isRequired,
          isComplete: item.completions[0]?.isComplete || false,
        })),
      }));

      // Determine access
      const requirementsMet =
        completedForms === totalRequiredForms &&
        completedPolicyItems === totalRequiredPolicyItems;
      const registrationGate = evaluateRegistrationAccess([
        {
          formId: 'registration-form',
          metadata: registrationForm?.userFormCompletions[0]?.metadata,
        },
      ]);
      const canAccessContent = requirementsMet && !registrationGate.blocked;
      const registrationBlocksContent =
        requirementsMet && registrationGate.blocked;

      return {
        message: registrationBlocksContent
          ? registrationGate.message
          : 'Course access status retrieved',
        statusCode: 200,
        data: {
          canAccessContent,
          ...(registrationBlocksContent
            ? {
                reason: registrationGate.reason,
                registrationStatus: registrationGate.registrationStatus,
                registrationComments: registrationGate.comments,
                message: registrationGate.message,
              }
            : registrationGate.registrationStatus
              ? {
                  registrationStatus: registrationGate.registrationStatus,
                  registrationComments: registrationGate.comments,
                }
              : {}),
          formStatus: {
            completedForms,
            totalForms: totalRequiredForms,
            forms: formStatus,
          },
          policyStatus: {
            completedPolicies,
            totalPolicies: totalRequiredPolicies,
            completedPolicyItems,
            totalPolicyItems: totalRequiredPolicyItems,
            policies: policyStatus,
          },
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error?.message || 'Failed to check course access',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
        {
          cause: error,
        },
      );
    }
  }
  async getCourseDetailPublic(id: string): Promise<ResponseDto> {
    try {
      const course = await this.prisma.course.findFirst({
        where: { id, isActive: true },
        select: {
          id: true,
          title: true,
          description: true,
          image: true,
          price: true,
          // Public marketing page must show the CURRENT (non-archived)
          // curriculum. Prior to these filters an archived module would
          // vanish from the admin list (we filter isArchived:false there
          // now) but still render on the public course page — the new
          // divergence the admin-facing archive changes introduced. Also
          // hides archived chapters and inactive/archived sections; matches
          // getAllChapters / getAllSections behaviour so admin and public
          // views agree on what "exists".
          modules: {
            where: { isArchived: false },
            select: {
              id: true,
              title: true,
              chapters: {
                where: { isArchived: false },
                orderBy: {
                  createdAt: 'asc',
                },
              },
              _count: {
                select: {
                  chapters: { where: { isArchived: false } },
                  sections: { where: { isArchived: false, isActive: true } },
                },
              },
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
      });
      if (!course) {
        throw new Error('course not found');
      }
      return {
        message: 'Successfully fetch Course info',
        statusCode: 200,
        data: course,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async getModule(id: string): Promise<ResponseDto> {
    try {
      const module = await this.prisma.module.findUnique({ where: { id } });
      if (!module) {
        throw new Error('Module not found');
      }
      return {
        message: 'Successfully fetch module info',
        statusCode: 200,
        data: module,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async getChapter(id: string): Promise<ResponseDto> {
    try {
      const chapter = await this.prisma.chapter.findUnique({ where: { id } });
      if (!chapter) {
        throw new Error('Chapter not found');
      }
      return {
        message: 'Successfully fetch Chapter info',
        statusCode: 200,
        data: chapter,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async getSection(id: string): Promise<ResponseDto> {
    try {
      const section = await this.prisma.section.findUnique({ where: { id } });
      if (!section) {
        throw new Error('section not found');
      }
      return {
        message: 'Successfully fetch section info',
        statusCode: 200,
        data: section,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async getAllCourses(): Promise<ResponseDto> {
    try {
      const courses = await this.prisma.course.findMany({
        include: {
          _count: {
            select: {
              // Match getAllModules — archived modules are hidden from the
              // admin list, so the count on the card must not include them.
              // Otherwise the card says "5 Modules" but clicking in shows 4,
              // which is exactly the "did my delete work?" confusion the
              // rest of this batch was meant to end.
              modules: { where: { isArchived: false } },
              users: true,
            },
          },
          // Latest published version only. The admin list wants "what are new
          // learners getting?", which is exactly the isLatest row; the full
          // history lives behind the manage page.
          courseVersions: {
            where: { status: 'PUBLISHED', isLatest: true },
            select: {
              id: true,
              versionNumber: true,
              publishedAt: true,
              sectionCount: true,
              changeNotes: true,
            },
            take: 1,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!(courses.length > 0)) {
        throw new Error('No Courses found');
      }

      // Active enrollments per course, in one grouped query rather than a
      // count per row. `_count.UserCourse` above is every enrollment ever;
      // this is the subset actually studying, which is the more useful number
      // on an admin list.
      const activeEnrollments = await this.prisma.userCourse.groupBy({
        by: ['courseId'],
        where: { isActive: true },
        _count: { _all: true },
      });
      const activeByCourse = new Map(
        activeEnrollments.map((row) => [row.courseId, row._count._all]),
      );

      const data = courses.map((course) => {
        const { courseVersions, ...rest } = course;
        const latest = courseVersions?.[0] ?? null;
        return {
          ...rest,
          status: course.isActive ? 'active' : 'inactive',
          latestVersion: latest
            ? {
                versionId: latest.id,
                versionNumber: latest.versionNumber,
                publishedAt: latest.publishedAt,
                sectionCount: latest.sectionCount,
                changeNotes: latest.changeNotes,
              }
            : null,
          enrollmentCount: course._count?.users ?? 0,
          activeEnrollmentCount: activeByCourse.get(course.id) ?? 0,
        };
      });

      return {
        message: 'Successfully fetched all Courses with form information',
        statusCode: 200,
        data,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async getAllPublicCourses(): Promise<ResponseDto> {
    try {
      const courses = await this.prisma.course.findMany({
        where: { isActive: true },
        include: {
          _count: {
            select: {
              // Public listing must agree with the public detail page — the
              // detail page filters archived modules, so the list card's
              // count must too.
              modules: { where: { isArchived: false } },
            },
          },
        },

        orderBy: {
          createdAt: 'desc',
        },
      });
      if (!(courses.length > 0)) {
        return {
          message: 'Successfully fetch all Courses info',
          statusCode: 200,
          data: [],
        };
      }
      return {
        message: 'Successfully fetch all Courses info',
        statusCode: 200,
        data: courses,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async setCourseActive(
    courseId: string,
    isActive: boolean,
  ): Promise<ResponseDto> {
    try {
      const existing = await this.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!existing) {
        throw new Error('Course not found');
      }
      const course = await this.prisma.course.update({
        where: { id: courseId },
        data: { isActive },
      });
      return {
        message: isActive
          ? 'Course activated successfully'
          : 'Course deactivated successfully',
        statusCode: 200,
        data: course,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async getAllModules(id: string): Promise<ResponseDto> {
    try {
      const modules = await this.prisma.module.findMany({
        where: {
          courseId: id,
          // Hide archived modules from the admin list — consistent with
          // getAllSections / getAllAssignQuizzes. When admin "deletes" a
          // module that is referenced by a published version, we archive
          // instead of hard-delete; the delete response now carries
          // outcome/stillServedTo so the FE can explain what happened.
          // The archived row remains discoverable via the dedicated
          // /courses/:courseId/archived endpoint (to be built) and remains
          // the content source for pinned learners.
          isArchived: false,
        },
        include: {
          _count: {
            select: {
              // Also only count non-archived chapters so badges match the
              // getAllChapters list, which filters isArchived: false too.
              chapters: { where: { isArchived: false } },
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
        // limit: 10,
        // offset: 10,
      });
      // Empty is a legitimate outcome, not a 403 condition — a course may
      // have no modules yet, or every module may have been archived (which is
      // now newly reachable since the isArchived filter above hides archived
      // rows). Matches getAllChapters / getAllSections, which both return an
      // empty array. Preserves the prior contract shape.
      return {
        message: 'Successfully fetch all Modules info against course',
        statusCode: 200,
        data: modules,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async getAllUserModules(id: string, userId: string): Promise<any> {
    try {
      const [completion, curriculum, quizProgressRows] = await Promise.all([
        this.prisma.courseCompletion.findUnique({
          where: { userId_courseId: { userId, courseId: id } },
          select: { courseCompletedAt: true },
        }),
        this.courseVersionService.resolveCurriculumTree(userId, id),
        this.prisma.quizProgress.findMany({ where: { userId } }),
      ]);

      const isFrozen = !!completion?.courseCompletedAt;
      const newSinceCompletion =
        await this.courseVersionService.summarizeNewSincePinnedVersion(
          userId,
          id,
        );

      if (curriculum.mode === 'versioned') {
        const progressRows = await this.prisma.userCourseProgress.findMany({
          where: { userId, courseId: id },
          select: { sectionId: true, chapterId: true, moduleId: true },
        });
        const progressByChapter = new Map<string, number>();
        const progressByModule = new Map<string, number>();
        const progressSectionIds = new Set(
          progressRows.map((p) => p.sectionId),
        );

        for (const mod of curriculum.tree.modules) {
          const sourceModuleId = mod.sourceModuleId;
          let modCount = 0;
          for (const ch of mod.chapters) {
            const sourceChapterId = ch.sourceChapterId;
            const sectionIds = ch.sections.map((s) => s.id);
            const chCount = sectionIds.filter((sid) =>
              progressSectionIds.has(sid),
            ).length;
            progressByChapter.set(sourceChapterId, chCount);
            modCount += chCount;
          }
          progressByModule.set(sourceModuleId, modCount);
        }

        let modules = this.courseVersionService.buildUserModulesFromVersion(
          curriculum.tree,
          progressByChapter,
          progressByModule,
        );

        const quizByChapter = new Map(
          quizProgressRows.map((q) => [q.chapterId, q]),
        );
        modules = modules.map((mod) => ({
          ...mod,
          chapters: mod.chapters.map((ch) => ({
            ...ch,
            QuizProgress: quizByChapter.has(ch.id)
              ? [quizByChapter.get(ch.id)]
              : [],
          })),
        }));

        if (isFrozen) {
          for (const mod of modules) {
            if (mod._count?.sections != null) {
              mod._count.UserCourseProgress = mod._count.sections;
            }
            for (const chapter of mod.chapters ?? []) {
              if (chapter._count?.sections != null) {
                chapter._count.UserCourseProgress = chapter._count.sections;
              }
            }
          }
        }

        return {
          message: 'Successfully fetched all Modules info against course',
          statusCode: 200,
          data: modules,
          isCompleted: isFrozen,
          completedAt: completion?.courseCompletedAt ?? null,
          enrolledVersionNumber: curriculum.versionNumber,
          ...(newSinceCompletion ? { newSinceCompletion } : {}),
        };
      }

      // Live (unpinned) branch. Filters below must mirror
      // countCompletionDenominator's live path (isArchived:false everywhere,
      // isActive:true on sections) so the module/chapter ratios shown here
      // agree with the completion gate. Prior to these filters, archived
      // sections/chapters/modules — which now routinely exist because
      // "delete" archives when referenced by a version — inflated the
      // denominators and produced <100% here while the gate considered the
      // learner done.
      const [courses]: any = await Promise.all([
        this.prisma.course.findFirst({
          where: { id },
          select: {
            id: true,
            title: true,
            modules: {
              where: { isArchived: false },
              select: {
                id: true,
                title: true,
                chapters: {
                  where: { isArchived: false },
                  select: {
                    id: true,
                    title: true,
                    // Numerator (UserCourseProgress) is scoped by Section
                    // so it matches the denominator's isArchived:false /
                    // isActive:true filter. The FE's calculateProgress does
                    // (completed * 100) / total with no clamp
                    // (docs/frontend-progress-display-guide.md §4.3 line
                    // 106), so a numerator counting progress on
                    // now-archived sections could produce >100% chapter
                    // rings. UserCourseProgress rows survive a section
                    // archive (only cascade on hard delete), which is why
                    // this filter is required.
                    _count: {
                      select: {
                        UserCourseProgress: {
                          where: {
                            userId,
                            Section: {
                              isArchived: false,
                              isActive: true,
                            },
                          },
                        },
                        sections: {
                          where: { isArchived: false, isActive: true },
                        },
                        quizzes: { where: { isArchived: false } },
                      },
                    },
                    QuizProgress: {
                      where: { userId },
                    },
                  },
                  orderBy: {
                    createdAt: 'asc',
                  },
                },
                // Same numerator/denominator alignment at module level: the
                // module ring in CourseContent.tsx uses the same
                // calculateProgress(_count.UserCourseProgress,
                // _count.sections) helper.
                _count: {
                  select: {
                    UserCourseProgress: {
                      where: {
                        userId,
                        Section: {
                          isArchived: false,
                          isActive: true,
                        },
                      },
                    },
                    sections: {
                      where: { isArchived: false, isActive: true },
                    },
                  },
                },
              },
            },
          },
        }),
      ]);

      // Certified completers keep 100% at every aggregate level even when
      // admin adds sections later. Clamp _count.UserCourseProgress so the FE
      // ratio (progressed / total sections) stays at 100%.
      if (isFrozen && courses?.modules) {
        for (const mod of courses.modules) {
          if (mod._count?.sections != null) {
            mod._count.UserCourseProgress = mod._count.sections;
          }
          for (const chapter of mod.chapters ?? []) {
            if (chapter._count?.sections != null) {
              chapter._count.UserCourseProgress = chapter._count.sections;
            }
          }
        }
      }

      return {
        message: 'Successfully fetched all Modules info against course',
        statusCode: 200,
        data: courses?.modules,
        isCompleted: isFrozen,
        completedAt: completion?.courseCompletedAt ?? null,
        ...(newSinceCompletion ? { newSinceCompletion } : {}),
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async getAllChapters(id: string): Promise<ResponseDto> {
    try {
      const chapters = await this.prisma.chapter.findMany({
        where: {
          moduleId: id,
          // Hide archived chapters from the admin list — consistent with
          // getAllSections / getAllAssignQuizzes / getAllModules. Prior to
          // this filter, archiving a chapter left it in the list with no
          // visible flag; the admin thought their delete had silently
          // failed. Archived chapters remain the content source for pinned
          // learners and will be surfaced via the /archived inventory
          // endpoint.
          isArchived: false,
        },
        include: {
          _count: {
            select: {
              // Count only non-archived rows so these badges match the lists
              // returned by getAllSections / getAllAssignQuizzes, which both
              // filter isArchived: false. An unfiltered count over-reports by
              // the number of archived sections/quizzes.
              sections: { where: { isArchived: false } },
              quizzes: { where: { isArchived: false } },
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
        // limit: 10,
        // offset: 10,
      });

      return {
        message: 'Successfully fetch all Chapters info against module',
        statusCode: 200,
        data: chapters,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async getAllSections(id: string): Promise<ResponseDto> {
    try {
      const sections = await this.prisma.section.findMany({
        where: {
          chapterId: id,
          isArchived: false,
        },
        orderBy: {
          createdAt: 'asc',
        },
        // Return all fields including new type-specific fields
      });

      // Sort sections: non-null orderIndex first (ascending), then nulls at the end
      sections.sort((a, b) => {
        const aOrder = (a as any).orderIndex;
        const bOrder = (b as any).orderIndex;
        if (aOrder === null && bOrder === null) return 0;
        if (aOrder === null) return 1; // nulls go to end
        if (bOrder === null) return -1; // nulls go to end
        return aOrder - bOrder;
      });
      // if (!(sections.length > 0)) {
      //   throw new Error('No Sections found');
      // }
      return {
        message: 'Successfully fetch all Sections info against chapter',
        statusCode: 200,
        data: sections,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async getAllUserSections(
    id: string,
    userId: string,
    courseId: string,
  ): Promise<any> {
    try {
      const [userCourseProgress, lastSeenLesson, completion, curriculum] =
        await Promise.all([
          this.prisma.userCourseProgress.findMany({
            where: { userId, courseId, chapterId: id },
          }),
          this.prisma.lastSeenSection.findUnique({
            where: { userId_chapterId: { userId, chapterId: id } },
          }),
          this.prisma.courseCompletion.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { courseCompletedAt: true },
          }),
          this.courseVersionService.resolveCurriculumTree(userId, courseId),
        ]);

      const newSinceCompletion =
        await this.courseVersionService.summarizeNewSincePinnedVersion(
          userId,
          courseId,
        );

      if (curriculum.mode === 'versioned') {
        const found = this.courseVersionService.findVersionChapterBySourceId(
          curriculum.tree,
          id,
        );
        if (!found) {
          throw new Error('Chapter not found in enrolled course version');
        }

        const { chapter: versionChapter } = found;
        const allSections =
          this.courseVersionService.mapVersionSectionsForLearner(
            versionChapter.sections,
          );
        const completedSections = userCourseProgress ?? [];

        allSections.forEach((section: any) => {
          const isCompleted = completedSections.some(
            (completedSection: any) =>
              completedSection.sectionId === section.id,
          );
          section.isLastSeen = lastSeenLesson?.sectionId === section.id;
          section.isCompleted = isCompleted;

          if (
            section.type === SectionType.ORDERING ||
            section.type === SectionType.MATCHING
          ) {
            this.sanitizeLessonSectionForStudent(section);
          }
        });

        if (allSections.length === 0) {
          throw new Error('No Sections found');
        }

        const quizzes = this.courseVersionService.mapVersionQuizzesForLearner(
          versionChapter.quizzes,
          false,
        );

        return {
          message: 'Successfully fetch all Sections info against chapter',
          statusCode: 200,
          data: allSections,
          chapter: {
            id,
            title: versionChapter.title,
            description: versionChapter.description,
            pdfFile: versionChapter.pdfFile,
            moduleId: found.module.sourceModuleId,
            quizzes,
          },
          isCompleted: !!completion?.courseCompletedAt,
          completedAt: completion?.courseCompletedAt ?? null,
          enrolledVersionNumber: curriculum.versionNumber,
          ...(newSinceCompletion ? { newSinceCompletion } : {}),
        };
      }

      const [sections, chapter] = await Promise.all([
        this.prisma.section.findMany({
          // isActive:true to match every other live path. The lesson-player
          // sidebar derives its "N/N" from this array's length, so including
          // inactive sections made its denominator disagree with the chapter
          // percentage and the completion gate.
          where: { chapterId: id, isArchived: false, isActive: true },
          orderBy: {
            createdAt: 'asc',
          },
        }),
        this.prisma.chapter.findUnique({
          where: { id },
          include: {
            quizzes: {
              where: { isArchived: false },
              select: {
                id: true,
                question: true,
                options: true,
                answer: true,
              },
            },
          },
        }),
      ]);

      // Sort sections: non-null orderIndex first (ascending), then nulls at the end
      const sortedSections = [...sections].sort((a, b) => {
        const aOrder = (a as any).orderIndex;
        const bOrder = (b as any).orderIndex;
        if (aOrder === null && bOrder === null) return 0;
        if (aOrder === null) return 1; // nulls go to end
        if (bOrder === null) return -1; // nulls go to end
        return aOrder - bOrder;
      });

      const allSections = sortedSections?.length > 0 ? [...sortedSections] : [];
      const completedSections =
        userCourseProgress?.length > 0 ? [...userCourseProgress] : [];

      allSections?.forEach((section: any) => {
        // Check if the section ID exists in completedSections
        const isCompleted = completedSections?.some(
          (completedSection: any) => completedSection.sectionId === section.id,
        );
        section.isLastSeen =
          lastSeenLesson?.sectionId === section.id ? true : false;
        // Insert the boolean value into the section object
        section.isCompleted = isCompleted;

        if (
          section.type === SectionType.ORDERING ||
          section.type === SectionType.MATCHING
        ) {
          this.sanitizeLessonSectionForStudent(section);
        }
      });

      if (!(sections.length > 0)) {
        throw new Error('No Sections found');
      }
      return {
        message: 'Successfully fetch all Sections info against chapter',
        statusCode: 200,
        data: allSections,
        chapter: chapter,
        isCompleted: !!completion?.courseCompletedAt,
        completedAt: completion?.courseCompletedAt ?? null,
        ...(newSinceCompletion ? { newSinceCompletion } : {}),
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async updateCourse(id: string, body: UpdateCourseDto): Promise<ResponseDto> {
    try {
      const course = await this.prisma.course.findUnique({ where: { id } });

      if (!course) {
        throw new Error('Course does not exist');
      }

      if (Object.entries(body).length === 0) {
        throw new Error('No update data provided');
      }

      const { courseForms, policies, feedbackForm, ...courseData } = body;

      // 1. Update basic course information
      const updatedCourse = await this.prisma.course.update({
        where: { id },
        data: courseData,
      });

      // 2. Update course forms if provided
      if (courseForms) {
        await this.prisma.courseForm.deleteMany({ where: { courseId: id } });

        if (courseForms.length > 0) {
          await this.prisma.courseForm.createMany({
            data: courseForms.map((form) => ({
              courseId: id,
              formId: form.value,
              formName: form.label,
              isRequired: form.isRequired ?? true,
            })),
          });
        }
      }

      // 3. Update feedback form if provided
      if (feedbackForm) {
        // First delete existing feedback submissions
        await this.prisma.courseFeedbackSubmission.deleteMany({
          where: {
            courseId: id,
          },
        });

        // Then delete existing feedback form for this course
        await this.prisma.courseFeedbackForm.deleteMany({
          where: {
            courseId: id,
          },
        });

        // Create new feedback form
        await this.prisma.courseFeedbackForm.create({
          data: {
            courseId: id,
            formName: feedbackForm.formName || 'Course Completion Feedback',
            formStructure: feedbackForm.formStructure || {},
            isRequired: feedbackForm.isRequired,
          },
        });
      }

      // 4. Update policies and related data if provided
      if (policies) {
        // Step 3.1: Clean up existing related records
        await this.prisma.userPolicyItemCompletion.deleteMany({
          where: { item: { policy: { courseId: id } } },
        });

        await this.prisma.userPolicyCompletion.deleteMany({
          where: { policy: { courseId: id } },
        });

        await this.prisma.policyItem.deleteMany({
          where: { policy: { courseId: id } },
        });

        await this.prisma.policy.deleteMany({
          where: { courseId: id },
        });

        // Step 3.2: Recreate policies and their items
        for (const policy of policies) {
          await this.prisma.policy.create({
            data: {
              courseId: id,
              title: policy.title,
              description: policy.description,
              order: policy.order ?? 0,
              items: {
                create: policy.items?.map((item, index) => ({
                  title: item.title,
                  description: item.description ?? '',
                  link: item.link,
                  isRequired: item.isRequired ?? true,
                  order: item.order ?? index,
                })),
              },
            },
          });
        }
      }

      return {
        message: 'Successfully updated course record with forms and policies',
        statusCode: 200,
        data: updatedCourse,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error:
            error?.message || 'Something went wrong while updating the course',
        },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  async updateModule(id: string, body: UpdateCourseDto): Promise<ResponseDto> {
    try {
      const isModuleExist: Module = await this.prisma.module.findUnique({
        where: { id: id },
      });
      if (!isModuleExist) {
        throw new Error('Module already exist with specified title');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      const updateModule = {};

      for (const [key, value] of Object.entries(body)) {
        updateModule[key] = value;
      }

      // Save the updated user
      const updatedModule = await this.prisma.module.update({
        where: { id }, // Specify the unique identifier for the user you want to update
        data: updateModule, // Pass the modified user object
      });

      return {
        message: 'Successfully updated module record',
        statusCode: 200,
        data: updatedModule,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async updateChapter(id: string, body: UpdateCourseDto): Promise<ResponseDto> {
    try {
      const isChapterExist: Chapter = await this.prisma.chapter.findUnique({
        where: { id: id },
      });
      if (!isChapterExist) {
        throw new Error('Chapter already exist with specified title');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      const updateChapter = {};

      for (const [key, value] of Object.entries(body)) {
        updateChapter[key] = value;
      }

      // Save the updated user
      const updatedChapter = await this.prisma.chapter.update({
        where: { id }, // Specify the unique identifier for the user you want to update
        data: updateChapter, // Pass the modified user object
      });

      return {
        message: 'Successfully updated chapter record',
        statusCode: 200,
        data: updatedChapter,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async updateSection(
    id: string,
    body:
      | UpdateSectionDto
      | UpdateMatchAndLearnSectionDto
      | UpdateVisualActivitySectionDto
      | UpdateOrderingSectionDto
      | UpdateMatchingSectionDto
      | UpdateFlashcardsSectionDto
      | any,
  ): Promise<ResponseDto> {
    try {
      const isSectionExist: Section = await this.prisma.section.findUnique({
        where: { id: id },
      });
      if (!isSectionExist) {
        throw new Error('Section does not exist');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }

      const updateData: any = {};

      // Handle common section fields
      if (body.title !== undefined) updateData.title = body.title;
      if (body.description !== undefined) {
        assertNoInlineBase64(body.description);
        updateData.description = body.description;
      }
      if (body.shortDescription !== undefined) {
        assertNoInlineBase64(body.shortDescription, 'shortDescription');
        updateData.shortDescription = body.shortDescription;
      }
      if (body.chapterId !== undefined) updateData.chapterId = body.chapterId;
      if (body.moduleId !== undefined) updateData.moduleId = body.moduleId;
      if ((body as any).orderIndex !== undefined)
        updateData.orderIndex = (body as any).orderIndex;
      if (body.type !== undefined) updateData.type = body.type as any;

      // Handle Match and Learn specific fields if section type is MATCH_AND_LEARN
      const sectionType = (isSectionExist as any).type;
      if (
        sectionType === SectionType.MATCH_AND_LEARN ||
        body.type === SectionType.MATCH_AND_LEARN
      ) {
        const matchData = body as UpdateMatchAndLearnSectionDto;

        if (matchData.itemLabel !== undefined)
          updateData.itemLabel = matchData.itemLabel;
        if (matchData.categoryLabel !== undefined)
          updateData.categoryLabel = matchData.categoryLabel;
        if (matchData.maxPerCategory !== undefined)
          updateData.maxPerCategory = matchData.maxPerCategory;
        if (matchData.isActive !== undefined)
          updateData.isActive = matchData.isActive;

        // Handle items update
        if (matchData.items !== undefined) {
          updateData.items = matchData.items;
          // Recalculate categories from items if not explicitly provided
          if (matchData.categories === undefined) {
            updateData.categories = [
              ...new Set(
                matchData.items.map((item: any) => item.correctCategory),
              ),
            ];
          } else {
            updateData.categories = matchData.categories;
          }
        } else if (matchData.categories !== undefined) {
          updateData.categories = matchData.categories;
        }
      }

      // Handle Visual Activity specific fields if section type is VISUAL_ACTIVITY
      if (
        sectionType === SectionType.VISUAL_ACTIVITY ||
        body.type === SectionType.VISUAL_ACTIVITY
      ) {
        const visualData = body as UpdateVisualActivitySectionDto;

        if (visualData.questionText !== undefined)
          updateData.questionText = visualData.questionText;
        if (visualData.imageUrl !== undefined)
          updateData.imageUrl = visualData.imageUrl;
        if (visualData.allowMultipleSelection !== undefined)
          updateData.allowMultipleSelection = visualData.allowMultipleSelection;

        // Handle options update
        if (visualData.options !== undefined) {
          // Validate that at least one option is correct
          const hasCorrectOption = visualData.options.some(
            (option: any) => option.isCorrect === true,
          );
          if (!hasCorrectOption) {
            throw new Error(
              'At least one option must be marked as correct for Visual Activity sections',
            );
          }
          updateData.options = visualData.options;
        }
      }

      if (
        sectionType === SectionType.ORDERING ||
        body.type === SectionType.ORDERING
      ) {
        const ord = body as UpdateOrderingSectionDto;
        if (ord.questionText !== undefined)
          updateData.questionText = ord.questionText;
        if (ord.items !== undefined)
          updateData.items = ord.items as unknown as Prisma.InputJsonValue;
        if (ord.items !== undefined || ord.correctOrder !== undefined) {
          const items =
            ord.items ??
            (Array.isArray(isSectionExist.items)
              ? (isSectionExist.items as { id: string }[])
              : null);
          const existingCfg = isSectionExist.config as {
            correctOrder?: string[];
          } | null;
          const correctOrder =
            ord.correctOrder ?? existingCfg?.correctOrder ?? null;
          if (!items?.length || !correctOrder?.length) {
            throw new Error(
              'ORDERING section update requires existing items and correctOrder, or provide both in the request',
            );
          }
          this.assertValidOrderingItems(items, correctOrder);
          updateData.config = {
            correctOrder,
          } as unknown as Prisma.InputJsonValue;
        }
      }

      if (
        sectionType === SectionType.MATCHING ||
        body.type === SectionType.MATCHING
      ) {
        const mat = body as UpdateMatchingSectionDto;
        if (mat.questionText !== undefined)
          updateData.questionText = mat.questionText;
        if (mat.pairs !== undefined) {
          const ids = new Set(mat.pairs.map((p) => p.id));
          if (ids.size !== mat.pairs.length) {
            throw new Error('Matching pairs must have unique ids');
          }
          updateData.config = {
            pairs: mat.pairs,
          } as unknown as Prisma.InputJsonValue;
        }
      }

      if (
        sectionType === SectionType.FLASHCARDS ||
        body.type === SectionType.FLASHCARDS
      ) {
        const fc = body as UpdateFlashcardsSectionDto;
        if (fc.cards !== undefined || fc.layout !== undefined) {
          const existingCfg = isSectionExist.config as FlashcardsConfig | null;
          const cards = fc.cards ?? existingCfg?.cards;
          const layout = fc.layout ?? existingCfg?.layout ?? 'grid';
          updateData.config = buildFlashcardsConfig(
            cards,
            layout,
          ) as unknown as Prisma.InputJsonValue;
        }
      }

      // If updateData is empty, use the original approach for backward compatibility
      if (Object.keys(updateData).length === 0) {
        for (const [key, value] of Object.entries(body)) {
          updateData[key] = value;
        }
      }

      const updatedSection = await this.prisma.section.update({
        where: { id },
        data: updateData,
      });

      return {
        message: 'Successfully update section record',
        statusCode: 200,
        data: updatedSection,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async updateSectionOrder(body: UpdateSectionOrderDto): Promise<ResponseDto> {
    try {
      // Verify all sections belong to the provided chapterId
      const sectionIds = body.sections.map((s) => s.id);
      const sections = await this.prisma.section.findMany({
        where: {
          id: { in: sectionIds },
          chapterId: body.chapterId,
        },
      });

      if (sections.length !== sectionIds.length) {
        throw new Error(
          'Some sections not found or do not belong to the specified chapter',
        );
      }

      // Update each section's orderIndex in a transaction
      const updatePromises = body.sections.map((sectionOrder) =>
        this.prisma.section.update({
          where: { id: sectionOrder.id },
          data: { orderIndex: sectionOrder.orderIndex } as any,
        }),
      );

      await this.prisma.$transaction(updatePromises);

      return {
        message: 'Successfully updated section order',
        statusCode: 200,
        data: { chapterId: body.chapterId, updatedCount: body.sections.length },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: error?.message || 'Failed to update section order',
        },
        HttpStatus.BAD_REQUEST,
        {
          cause: error,
        },
      );
    }
  }

  async deleteCourse(id: string): Promise<ResponseDto> {
    try {
      const course = await this.prisma.course.findUnique({
        where: { id },
      });
      if (!course) {
        throw new Error('Course not found');
      }

      await this.prisma.course.delete({
        where: { id },
      });

      return {
        message: 'Successfully deleted course record',
        statusCode: 200,
        data: course,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        // Foreign key constraint violation
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error:
              'Cannot delete it because it is associated with other records.',
          },
          HttpStatus.FORBIDDEN,
        );
      } else {
        // Other errors
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error: error?.message || 'Something went wrong',
          },
          HttpStatus.FORBIDDEN,
          {
            cause: error,
          },
        );
      }
    }
  }

  async deleteModule(id: string, adminId?: string): Promise<ResponseDto> {
    try {
      const mod = await this.prisma.module.findUnique({
        where: { id },
      });
      if (!mod) {
        throw new Error('Module not found');
      }

      const references =
        await this.courseVersionService.getReferencingVersionsWithEnrollments(
          'module',
          id,
          mod.courseId,
        );
      const referenced = references.versions.length > 0;
      if (referenced) {
        const archived = await this.prisma.module.update({
          where: { id },
          // archivedAt: authoritative timestamp for the inventory endpoint's
          // sort. Set explicitly (not derived from updatedAt) so it survives
          // subsequent edits to the row while archived.
          data: { isArchived: true, archivedAt: new Date() },
        });
        const publishedVersion = await this.autoPublishAfterStructureChange(
          mod.courseId,
          adminId,
          `Archived module "${mod.title}"`,
        );
        await this.writeArchiveAudit({
          adminId,
          entity: 'Module',
          targetId: id,
          courseId: mod.courseId,
          title: mod.title,
          stillServedTo: references.stillServedTo,
          versions: references.versions,
        });
        return {
          message: this.buildArchiveMessage(
            'Module',
            references.stillServedTo,
            references.versions,
          ),
          statusCode: 200,
          data: archived,
          outcome: 'archived',
          stillServedTo: references.stillServedTo,
          versionsReferencing: references.versions,
          publishedVersion: publishedVersion ?? undefined,
        };
      }

      await this.prisma.module.delete({
        where: { id },
      });

      const publishedVersion = await this.autoPublishAfterStructureChange(
        mod.courseId,
        adminId,
        `Removed module "${mod.title}"`,
      );

      return {
        message: publishedVersion
          ? `Successfully deleted module (published v${publishedVersion.versionNumber})`
          : 'Successfully deleted module record',
        statusCode: 200,
        data: mod,
        outcome: 'deleted',
        stillServedTo: 0,
        publishedVersion: publishedVersion ?? undefined,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        // Foreign key constraint violation
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error:
              'Cannot delete it because it is associated with other records.',
          },
          HttpStatus.FORBIDDEN,
        );
      } else {
        // Other errors
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error: error?.message || 'Something went wrong',
          },
          HttpStatus.FORBIDDEN,
          {
            cause: error,
          },
        );
      }
    }
  }

  async deleteChapter(id: string, adminId?: string): Promise<ResponseDto> {
    try {
      const chapter = await this.prisma.chapter.findUnique({
        where: { id },
      });
      if (!chapter) {
        throw new Error('Chapter not found');
      }

      const courseId = await this.resolveCourseIdFromModuleId(chapter.moduleId);

      const references =
        await this.courseVersionService.getReferencingVersionsWithEnrollments(
          'chapter',
          id,
          courseId,
        );
      const referenced = references.versions.length > 0;
      if (referenced) {
        const archived = await this.prisma.chapter.update({
          where: { id },
          data: { isArchived: true, archivedAt: new Date() },
        });
        const publishedVersion = await this.autoPublishAfterStructureChange(
          courseId,
          adminId,
          `Archived chapter "${chapter.title}"`,
        );
        await this.writeArchiveAudit({
          adminId,
          entity: 'Chapter',
          targetId: id,
          courseId,
          title: chapter.title,
          stillServedTo: references.stillServedTo,
          versions: references.versions,
        });
        return {
          message: this.buildArchiveMessage(
            'Chapter',
            references.stillServedTo,
            references.versions,
          ),
          statusCode: 200,
          data: archived,
          outcome: 'archived',
          stillServedTo: references.stillServedTo,
          versionsReferencing: references.versions,
          publishedVersion: publishedVersion ?? undefined,
        };
      }

      await this.prisma.chapter.delete({
        where: { id },
      });

      const publishedVersion = await this.autoPublishAfterStructureChange(
        courseId,
        adminId,
        `Removed chapter "${chapter.title}"`,
      );

      return {
        message: publishedVersion
          ? `Successfully deleted chapter (published v${publishedVersion.versionNumber})`
          : 'Successfully deleted chapter record',
        statusCode: 200,
        data: chapter,
        outcome: 'deleted',
        stillServedTo: 0,
        publishedVersion: publishedVersion ?? undefined,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        // Foreign key constraint violation
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error:
              'Cannot delete it because it is associated with other records.',
          },
          HttpStatus.FORBIDDEN,
        );
      } else {
        // Other errors
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error: error?.message || 'Something went wrong',
          },
          HttpStatus.FORBIDDEN,
          {
            cause: error,
          },
        );
      }
    }
  }

  async deleteSection(id: string, adminId?: string): Promise<ResponseDto> {
    // try {
    //   const user = await this.prisma.section.findUnique({
    //     where: { id },
    //   });
    //   if (!user) {
    //     throw new Error('Section not found');
    //   }

    //   await this.prisma.section.delete({
    //     where: { id },
    //   });

    //   return {
    //     message: 'Successfully deleted section record',
    //     statusCode: 200,
    //     data: user,
    //   };
    // } catch (error) {
    //   throw new HttpException(
    //     {
    //       status: HttpStatus.FORBIDDEN,
    //       error: error?.message || 'Something went wrong',
    //     },
    //     HttpStatus.FORBIDDEN,
    //     {
    //       cause: error,
    //     },
    //   );
    // }

    try {
      const section = await this.prisma.section.findUnique({
        where: { id },
      });
      if (!section) {
        throw new Error('Section not found');
      }

      const courseId = await this.resolveCourseIdFromChapterId(
        section.chapterId,
      );

      // Already archived: hard-delete only when no version manifest still references it.
      if (section.isArchived) {
        const stillReferenced =
          await this.courseVersionService.isReferencedByAnyVersion(
            'section',
            id,
            courseId,
          );
        if (stillReferenced) {
          return {
            message:
              'Archived section is still referenced by a published version and cannot be removed',
            statusCode: 200,
            data: section,
          };
        }
        await this.prisma.section.delete({ where: { id } });
        return {
          message: 'Archived section permanently removed',
          statusCode: 200,
          data: section,
        };
      }

      const references =
        await this.courseVersionService.getReferencingVersionsWithEnrollments(
          'section',
          id,
          courseId,
        );
      const referenced = references.versions.length > 0;
      if (referenced) {
        const archived = await this.prisma.section.update({
          where: { id },
          data: { isArchived: true, archivedAt: new Date() },
        });
        const publishedVersion = await this.autoPublishAfterStructureChange(
          courseId,
          adminId,
          `Archived section "${section.title}"`,
        );
        await this.writeArchiveAudit({
          adminId,
          entity: 'Section',
          targetId: id,
          courseId,
          title: section.title,
          stillServedTo: references.stillServedTo,
          versions: references.versions,
        });
        return {
          message: this.buildArchiveMessage(
            'Section',
            references.stillServedTo,
            references.versions,
          ),
          statusCode: 200,
          data: archived,
          outcome: 'archived',
          stillServedTo: references.stillServedTo,
          versionsReferencing: references.versions,
          publishedVersion: publishedVersion ?? undefined,
        };
      }

      await this.prisma.section.delete({
        where: { id },
      });

      const publishedVersion = await this.autoPublishAfterStructureChange(
        courseId,
        adminId,
        `Removed section "${section.title}"`,
      );

      return {
        message: publishedVersion
          ? `Successfully deleted section (published v${publishedVersion.versionNumber})`
          : 'Successfully deleted section record',
        statusCode: 200,
        data: section,
        outcome: 'deleted',
        stillServedTo: 0,
        publishedVersion: publishedVersion ?? undefined,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        // Foreign key constraint violation
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error:
              'Cannot delete it because it is associated with other records.',
          },
          HttpStatus.FORBIDDEN,
        );
      } else {
        // Other errors
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error: error?.message || 'Something went wrong',
          },
          HttpStatus.FORBIDDEN,
          {
            cause: error,
          },
        );
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Restore endpoints (PR 1)
  //
  // For every delete/unassign path that archives (instead of hard-deletes)
  // because a published version still references the row, we now expose an
  // explicit "un-archive" endpoint. Previously the only way back was the
  // accidental blind-key-copy path in updateChapter/updateModule, which was
  // both undocumented and easy to fire by mistake.
  //
  // Cascade semantics (verified 2026-08-08 against the delete methods above):
  // archiving a parent does NOT flip children's `isArchived` — the four
  // delete methods only touch their own row. Therefore the parent-chain
  // guard on restore must reject if the *immediate* parent is archived, and
  // for Section (two levels deep) also reject if the grandparent module is
  // archived. Restoring a child under an archived ancestor would leave the
  // tree inconsistent (a live section under an archived chapter), which no
  // downstream code is defensive against.
  //
  // Restoring a parent does NOT auto-restore its archived children — that's
  // deliberate (cascade-on-restore is too much magic on a high-consequence
  // path). The admin walks top-down: restore module first, then chapter,
  // then section/quiz, seeing the count of remaining archived descendants
  // in the FE toast.
  // ───────────────────────────────────────────────────────────────────────

  async restoreModule(id: string, adminId?: string): Promise<ResponseDto> {
    const mod = await this.prisma.module.findUnique({
      where: { id },
      select: { id: true, courseId: true, isArchived: true, title: true },
    });
    if (!mod) {
      throw new HttpException(
        { status: HttpStatus.NOT_FOUND, error: 'Module not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    if (!mod.isArchived) {
      throw new HttpException(
        {
          status: HttpStatus.CONFLICT,
          error: 'Cannot restore: Module is already live (not archived)',
          details: { id: mod.id, isArchived: false },
        },
        HttpStatus.CONFLICT,
      );
    }

    // Restore. archivedAt cleared so the row disappears from inventory and
    // sorting-by-archived-time never surfaces a live row.
    const restored = await this.prisma.module.update({
      where: { id },
      data: { isArchived: false, archivedAt: null },
    });

    // Look up the latest published version and check whether it references
    // this module. If it does, the row is already reachable by new
    // enrollments and the FE can suppress the "publish to make visible" note.
    const latest = await this.courseVersionService.getLatestPublishedVersion(
      mod.courseId,
    );
    const publishedInLatest = this._isRowInVersion(latest, 'module', id);

    // Best-effort audit — writeAudit swallows failures internally.
    if (adminId) {
      await this.courseVersionService.writeAudit({
        adminId,
        action: 'RESTORE_ENTITY',
        targetType: 'Module',
        targetId: id,
        courseId: mod.courseId,
        metadata: {
          entityType: 'module',
          priorIsArchived: true,
          parentWasArchived: false, // module has no parent
          publishedInLatest,
          title: mod.title,
        },
      });
    }

    return {
      message: 'Restored',
      statusCode: 200,
      data: {
        ...restored,
        entityType: 'module',
        latestPublishedVersionId: latest?.id ?? null,
        latestPublishedVersionNumber: latest?.versionNumber ?? null,
        publishedInLatest,
        note: publishedInLatest
          ? undefined
          : this.courseVersionService.buildRestoreNote(latest?.versionNumber),
      },
    };
  }

  async restoreChapter(id: string, adminId?: string): Promise<ResponseDto> {
    const chapter = await this.prisma.chapter.findUnique({
      where: { id },
      select: {
        id: true,
        moduleId: true,
        isArchived: true,
        title: true,
        module: {
          select: {
            id: true,
            isArchived: true,
            title: true,
            courseId: true,
          },
        },
      },
    });
    if (!chapter) {
      throw new HttpException(
        { status: HttpStatus.NOT_FOUND, error: 'Chapter not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    if (!chapter.isArchived) {
      throw new HttpException(
        {
          status: HttpStatus.CONFLICT,
          error: 'Cannot restore: Chapter is already live (not archived)',
          details: { id: chapter.id, isArchived: false },
        },
        HttpStatus.CONFLICT,
      );
    }

    // Parent guard: reject if the module is archived. The admin must
    // restore the module first — a live chapter under an archived module
    // creates a tree inconsistency the rest of the system does not
    // defensively handle.
    if (chapter.module?.isArchived) {
      throw new HttpException(
        {
          status: HttpStatus.CONFLICT,
          error: `Cannot restore: parent Module "${chapter.module.title}" is archived; restore the module first`,
          details: {
            parentEntityType: 'module',
            parentId: chapter.module.id,
            parentTitle: chapter.module.title,
            chain: [
              {
                entityType: 'module',
                id: chapter.module.id,
                title: chapter.module.title,
              },
            ],
          },
        },
        HttpStatus.CONFLICT,
      );
    }

    const restored = await this.prisma.chapter.update({
      where: { id },
      data: { isArchived: false, archivedAt: null },
    });

    const courseId = chapter.module?.courseId ?? '';
    const latest = courseId
      ? await this.courseVersionService.getLatestPublishedVersion(courseId)
      : null;
    const publishedInLatest = this._isRowInVersion(latest, 'chapter', id);

    if (adminId) {
      await this.courseVersionService.writeAudit({
        adminId,
        action: 'RESTORE_ENTITY',
        targetType: 'Chapter',
        targetId: id,
        courseId,
        metadata: {
          entityType: 'chapter',
          priorIsArchived: true,
          parentWasArchived: false,
          publishedInLatest,
          title: chapter.title,
        },
      });
    }

    return {
      message: 'Restored',
      statusCode: 200,
      data: {
        ...restored,
        entityType: 'chapter',
        latestPublishedVersionId: latest?.id ?? null,
        latestPublishedVersionNumber: latest?.versionNumber ?? null,
        publishedInLatest,
        note: publishedInLatest
          ? undefined
          : this.courseVersionService.buildRestoreNote(latest?.versionNumber),
      },
    };
  }

  async restoreSection(id: string, adminId?: string): Promise<ResponseDto> {
    const section = await this.prisma.section.findUnique({
      where: { id },
      select: {
        id: true,
        chapterId: true,
        isArchived: true,
        title: true,
        chapter: {
          select: {
            id: true,
            isArchived: true,
            title: true,
            module: {
              select: {
                id: true,
                isArchived: true,
                title: true,
                courseId: true,
              },
            },
          },
        },
      },
    });
    if (!section) {
      throw new HttpException(
        { status: HttpStatus.NOT_FOUND, error: 'Section not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    if (!section.isArchived) {
      throw new HttpException(
        {
          status: HttpStatus.CONFLICT,
          error: 'Cannot restore: Section is already live (not archived)',
          details: { id: section.id, isArchived: false },
        },
        HttpStatus.CONFLICT,
      );
    }

    // Parent-chain guard: walk chapter → module. Because archives don't
    // cascade, a section can legitimately sit under an archived chapter or
    // an archived module, and either state blocks restore.
    const chain: Array<{ entityType: string; id: string; title: string }> = [];
    if (section.chapter?.module?.isArchived) {
      chain.push({
        entityType: 'module',
        id: section.chapter.module.id,
        title: section.chapter.module.title,
      });
    }
    if (section.chapter?.isArchived) {
      chain.push({
        entityType: 'chapter',
        id: section.chapter.id,
        title: section.chapter.title,
      });
    }
    if (chain.length > 0) {
      // Report the highest archived ancestor first so the FE can direct the
      // admin at the top of the chain — restoring a mid-level ancestor
      // would still leave the section un-restorable.
      const highest = chain[0];
      throw new HttpException(
        {
          status: HttpStatus.CONFLICT,
          error: `Cannot restore: parent ${
            highest.entityType === 'module' ? 'Module' : 'Chapter'
          } "${highest.title}" is archived; restore the ${
            highest.entityType
          } first`,
          details: {
            parentEntityType: highest.entityType,
            parentId: highest.id,
            parentTitle: highest.title,
            chain,
          },
        },
        HttpStatus.CONFLICT,
      );
    }

    const restored = await this.prisma.section.update({
      where: { id },
      data: { isArchived: false, archivedAt: null },
    });

    const courseId = section.chapter?.module?.courseId ?? '';
    const latest = courseId
      ? await this.courseVersionService.getLatestPublishedVersion(courseId)
      : null;
    const publishedInLatest = this._isRowInVersion(latest, 'section', id);

    if (adminId) {
      await this.courseVersionService.writeAudit({
        adminId,
        action: 'RESTORE_ENTITY',
        targetType: 'Section',
        targetId: id,
        courseId,
        metadata: {
          entityType: 'section',
          priorIsArchived: true,
          parentWasArchived: false,
          publishedInLatest,
          title: section.title,
        },
      });
    }

    return {
      message: 'Restored',
      statusCode: 200,
      data: {
        ...restored,
        entityType: 'section',
        latestPublishedVersionId: latest?.id ?? null,
        latestPublishedVersionNumber: latest?.versionNumber ?? null,
        publishedInLatest,
        note: publishedInLatest
          ? undefined
          : this.courseVersionService.buildRestoreNote(latest?.versionNumber),
      },
    };
  }

  /**
   * Cheap membership probe for the restore response's `publishedInLatest`
   * field. Delegates to the manifest helper (already used by
   * `getReferencingVersionsWithEnrollments`) so a change in what "referenced"
   * means only has to move in one place.
   */
  private _isRowInVersion(
    version: { manifest: Prisma.JsonValue } | null | undefined,
    table: 'module' | 'chapter' | 'section' | 'quiz',
    sourceId: string,
  ): boolean {
    if (!version) return false;
    const parsed = parseManifest(version.manifest);
    return parsed ? isIdReferencedInManifest(parsed, table, sourceId) : false;
  }

  /**
   * Archive inventory for a course: every archived Module/Chapter/Section/
   * Quiz that still exists in the DB, annotated with "still served to" and
   * "which versions still reference this row".
   *
   * Pagination is in-memory because the archived-row count per course is
   * bounded by admin behaviour (typically dozens, worst case hundreds).
   * Cursor pagination against a UNION view is the escape hatch if a course
   * ever accumulates thousands of archived rows.
   *
   * The batched `getReferencingVersionsWithEnrollmentsBatch` helper turns
   * what would otherwise be O(N archived rows × M versions) manifest scans
   * into O(M) per entity type — the reason CC2 was folded into this PR.
   */
  async getArchivedInventory(
    courseId: string,
    opts: {
      page?: number;
      pageSize?: number;
      entityType?: 'module' | 'chapter' | 'section' | 'quiz';
      search?: string;
      sort?: string;
    },
  ): Promise<ResponseDto> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const search = opts.search?.trim() || undefined;
    const sort = opts.sort || 'archivedAt:desc';

    const searchWhere = search
      ? { title: { contains: search, mode: 'insensitive' as const } }
      : {};

    const wantModule = !opts.entityType || opts.entityType === 'module';
    const wantChapter = !opts.entityType || opts.entityType === 'chapter';
    const wantSection = !opts.entityType || opts.entityType === 'section';
    const wantQuiz = !opts.entityType || opts.entityType === 'quiz';

    const [modules, chapters, sections, quizzes] = await Promise.all([
      wantModule
        ? this.prisma.module.findMany({
            where: { courseId, isArchived: true, ...searchWhere },
            select: {
              id: true,
              title: true,
              archivedAt: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
      wantChapter
        ? this.prisma.chapter.findMany({
            where: {
              module: { courseId },
              isArchived: true,
              ...searchWhere,
            },
            select: {
              id: true,
              title: true,
              archivedAt: true,
              updatedAt: true,
              module: {
                select: { id: true, title: true, isArchived: true },
              },
            },
          })
        : Promise.resolve([]),
      wantSection
        ? this.prisma.section.findMany({
            where: {
              chapter: { module: { courseId } },
              isArchived: true,
              ...searchWhere,
            },
            select: {
              id: true,
              title: true,
              archivedAt: true,
              updatedAt: true,
              chapter: {
                select: {
                  id: true,
                  title: true,
                  isArchived: true,
                  module: {
                    select: { id: true, title: true, isArchived: true },
                  },
                },
              },
            },
          })
        : Promise.resolve([]),
      wantQuiz
        ? this.prisma.quiz.findMany({
            where: {
              // Quizzes can legitimately have a null chapterId (unassigned but
              // still in the bank). Scope to this course by joining through
              // chapter.module. Quizzes archived via unAssignQuiz also set
              // chapterId to null, so we need an OR: either their current
              // chapter belongs to this course, OR they were originally
              // assigned to a chapter in this course and are now dangling
              // (best-effort — we can't recover the historical courseId).
              // Pragmatic compromise: include only quizzes still linked to a
              // chapter in this course. The unlinked-and-archived quizzes
              // surface via the (separate) POST /quiz/:id/restore audit trail.
              chapter: { module: { courseId } },
              isArchived: true,
              ...(search
                ? { question: { contains: search, mode: 'insensitive' } }
                : {}),
            },
            select: {
              id: true,
              question: true,
              archivedAt: true,
              updatedAt: true,
              chapter: {
                select: {
                  id: true,
                  title: true,
                  isArchived: true,
                  module: {
                    select: { id: true, title: true, isArchived: true },
                  },
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    type Row = {
      id: string;
      entityType: 'module' | 'chapter' | 'section' | 'quiz';
      title: string;
      parentPath: string | null;
      parentIsArchived: boolean;
      parentId: string | null;
      parentEntityType: 'module' | 'chapter' | null;
      archivedAt: Date | null;
      stillServedTo: number;
      versionsReferencing: Array<{
        versionId: string;
        versionNumber: number;
        status: string;
        enrollmentCount: number;
      }>;
    };

    // effectiveArchivedAt: falls back to updatedAt when the row was archived
    // before the archivedAt column existed and the backfill migration copied
    // updatedAt into archivedAt. We keep both in mind here because a row can
    // still legitimately have archivedAt = null in edge scenarios (e.g. an
    // older archive that predates both the backfill and PR 1 was subsequently
    // re-archived by hand in the DB) — this fallback keeps the sort stable.
    const effArchivedAt = (r: { archivedAt: Date | null; updatedAt: Date }) =>
      r.archivedAt ?? r.updatedAt;

    const flat: Row[] = [
      ...modules.map<Row>((m) => ({
        id: m.id,
        entityType: 'module',
        title: m.title,
        parentPath: null,
        parentIsArchived: false,
        parentId: null,
        parentEntityType: null,
        archivedAt: effArchivedAt(m),
        stillServedTo: 0,
        versionsReferencing: [],
      })),
      ...chapters.map<Row>((c) => ({
        id: c.id,
        entityType: 'chapter',
        title: c.title,
        parentPath: c.module.title,
        parentIsArchived: c.module.isArchived,
        parentId: c.module.isArchived ? c.module.id : null,
        parentEntityType: c.module.isArchived ? 'module' : null,
        archivedAt: effArchivedAt(c),
        stillServedTo: 0,
        versionsReferencing: [],
      })),
      ...sections.map<Row>((s) => ({
        id: s.id,
        entityType: 'section',
        title: s.title,
        parentPath: `${s.chapter.module.title} › ${s.chapter.title}`,
        // Highest-severity archived ancestor determines parentIsArchived.
        // If the module is archived we point the FE at the module first
        // because restoring the section requires the module to be restored
        // first anyway.
        parentIsArchived: s.chapter.module.isArchived || s.chapter.isArchived,
        parentId: s.chapter.module.isArchived
          ? s.chapter.module.id
          : s.chapter.isArchived
            ? s.chapter.id
            : null,
        parentEntityType: s.chapter.module.isArchived
          ? 'module'
          : s.chapter.isArchived
            ? 'chapter'
            : null,
        archivedAt: effArchivedAt(s),
        stillServedTo: 0,
        versionsReferencing: [],
      })),
      ...quizzes.map<Row>((q) => ({
        id: q.id,
        entityType: 'quiz',
        // Quizzes don't have a `title` column — surface the question text
        // (truncated) so inventory search-by-title still works usefully.
        title:
          q.question.length > 100 ? q.question.slice(0, 100) + '…' : q.question,
        parentPath: q.chapter
          ? `${q.chapter.module.title} › ${q.chapter.title}`
          : null,
        parentIsArchived: q.chapter
          ? q.chapter.module.isArchived || q.chapter.isArchived
          : false,
        parentId: q.chapter
          ? q.chapter.module.isArchived
            ? q.chapter.module.id
            : q.chapter.isArchived
              ? q.chapter.id
              : null
          : null,
        parentEntityType: q.chapter
          ? q.chapter.module.isArchived
            ? 'module'
            : q.chapter.isArchived
              ? 'chapter'
              : null
          : null,
        archivedAt: effArchivedAt(q),
        stillServedTo: 0,
        versionsReferencing: [],
      })),
    ];

    // Batch-resolve stillServedTo/versionsReferencing per entity type. This
    // is O(#entity_types × #versions) manifest scans total, regardless of
    // how many archived rows fit in the inventory. Without CC2 this would be
    // O(#rows × #versions) — 20× worse on a fully-populated page.
    const idsByType = new Map<
      'module' | 'chapter' | 'section' | 'quiz',
      string[]
    >();
    for (const row of flat) {
      const bucket = idsByType.get(row.entityType) ?? [];
      bucket.push(row.id);
      idsByType.set(row.entityType, bucket);
    }
    const referencesByType = new Map<
      string,
      Awaited<
        ReturnType<
          typeof this.courseVersionService.getReferencingVersionsWithEnrollmentsBatch
        >
      >
    >();
    for (const [type, ids] of idsByType) {
      if (ids.length === 0) continue;
      const map =
        await this.courseVersionService.getReferencingVersionsWithEnrollmentsBatch(
          type,
          ids,
          courseId,
        );
      referencesByType.set(type, map);
    }
    for (const row of flat) {
      const map = referencesByType.get(row.entityType);
      const ref = map?.get(row.id);
      if (ref) {
        row.stillServedTo = ref.stillServedTo;
        row.versionsReferencing = ref.versions;
      }
    }

    // Sort. `stillServedTo:desc` sorts to help the admin triage
    // highest-consequence archives first (many pinned learners still
    // seeing content that admin thinks is deleted).
    const [sortKey, sortDirRaw] = sort.split(':');
    const sortDir = sortDirRaw === 'asc' ? 1 : -1;
    flat.sort((a, b) => {
      if (sortKey === 'title') {
        return a.title.localeCompare(b.title) * sortDir;
      }
      if (sortKey === 'stillServedTo') {
        return (a.stillServedTo - b.stillServedTo) * sortDir;
      }
      // Default: archivedAt. Null archivedAt sorts last regardless of dir
      // (both edges of the sort are more interesting than unknown times).
      const aTime = a.archivedAt?.getTime() ?? -Infinity;
      const bTime = b.archivedAt?.getTime() ?? -Infinity;
      return (aTime - bTime) * sortDir;
    });

    const total = flat.length;
    const paged = flat.slice((page - 1) * pageSize, page * pageSize);

    return {
      message: 'OK',
      statusCode: 200,
      data: {
        rows: paged,
        total,
        page,
        pageSize,
      },
    };
  }

  // async assignCourse(userId: string, courseId: string): Promise<ResponseDto> {
  //   try {
  //     const course = await this.prisma.course.findUnique({
  //       where: { id: courseId },
  //     });
  //     if (!course) {
  //       throw new Error('course not found');
  //     }
  //     const user = await this.prisma.user.findUnique({
  //       where: { id: userId },
  //     });
  //     if (!user) {
  //       throw new Error('user not found');
  //     }

  //     // Assign the course to the user
  //     await this.prisma.user.update({
  //       where: { id: userId },
  //       data: {
  //         courses: {
  //           connect: { id: courseId },
  //         },
  //       },
  //     });

  //     return {
  //       message: 'Successfully assigned course to user',
  //       statusCode: 200,
  //       data: {},
  //     };
  //   } catch (error) {
  //     throw new HttpException(
  //       {
  //         status: HttpStatus.FORBIDDEN,
  //         error: error?.message || 'Something went wrong',
  //       },
  //       HttpStatus.FORBIDDEN,
  //       {
  //         cause: error,
  //       },
  //     );
  //   }
  // }

  async assignCourse(userId: string, courseId: string): Promise<ResponseDto> {
    try {
      // Check if the course exists
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!course) {
        throw new HttpException(
          { status: HttpStatus.NOT_FOUND, error: 'Course not found.' },
          HttpStatus.NOT_FOUND,
        );
      }

      // Check if the user exists
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        throw new HttpException(
          { status: HttpStatus.NOT_FOUND, error: 'User not found.' },
          HttpStatus.NOT_FOUND,
        );
      }

      // Check if the course is already assigned to the user
      const existingAssignment = await this.prisma.userCourse.findUnique({
        where: {
          userId_courseId: {
            userId,
            courseId,
          },
        },
      });
      if (existingAssignment) {
        throw new HttpException(
          {
            status: HttpStatus.CONFLICT,
            error:
              'This course is already assigned to this user. No changes were made.',
          },
          HttpStatus.CONFLICT,
        );
      }

      // Assign the course to the user by creating a new entry in UserCourse table
      await this.prisma.userCourse.create({
        data: {
          userId,
          courseId,
          isActive: false, // Default status as inactive
          isPaid: false, // Default payment status as unpaid
        },
      });

      return {
        message: 'Successfully assigned course to user',
        statusCode: 200,
        data: {},
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new HttpException(
          {
            status: HttpStatus.CONFLICT,
            error:
              'This course is already assigned to this user. No changes were made.',
          },
          HttpStatus.CONFLICT,
        );
      }
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error:
            error instanceof Error ? error.message : 'Something went wrong',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async assignCoursePublic(
    userId: string,
    courseId: string,
  ): Promise<ResponseDto> {
    try {
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!course) {
        throw new HttpException(
          { status: HttpStatus.NOT_FOUND, error: 'Course not found.' },
          HttpStatus.NOT_FOUND,
        );
      }
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        throw new HttpException(
          { status: HttpStatus.NOT_FOUND, error: 'User not found.' },
          HttpStatus.NOT_FOUND,
        );
      }

      const existingAssignment = await this.prisma.userCourse.findUnique({
        where: {
          userId_courseId: {
            userId,
            courseId,
          },
        },
      });
      if (existingAssignment) {
        throw new HttpException(
          {
            status: HttpStatus.CONFLICT,
            error:
              'This course is already assigned to this user. No changes were made.',
          },
          HttpStatus.CONFLICT,
        );
      }

      await this.prisma.userCourse.create({
        data: {
          userId,
          courseId,
          isActive: false, // Default status as inactive
          isPaid: false, // Default payment status as unpaid
        },
      });

      return {
        message: 'Successfully assigned course to user',
        statusCode: 200,
        data: {},
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new HttpException(
          {
            status: HttpStatus.CONFLICT,
            error:
              'This course is already assigned to this user. No changes were made.',
          },
          HttpStatus.CONFLICT,
        );
      }
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error:
            error instanceof Error ? error.message : 'Something went wrong',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
  async unAssignCourse(
    userId: string,
    courseId: string,
    options?: { force?: boolean; adminId?: string },
  ): Promise<ResponseDto> {
    try {
      // Check if the user exists
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        throw new Error('User not found');
      }

      // Check if the course exists
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!course) {
        throw new Error('Course not found');
      }

      // Check if the user-course relation exists
      const userCourse = await this.prisma.userCourse.findFirst({
        where: { userId, courseId },
      });
      if (!userCourse) {
        throw new Error('User is not assigned to this course');
      }

      // ── Unassign/Reassign loophole guard ──────────────────────────────────
      // Multiple learner-state tables are keyed by (userId, courseId, …) or
      // (userId, chapterId, …) or (userId, assessmentId, …) with NO FK to
      // UserCourse. Prior to this guard, deleting the UserCourse row left all
      // that state orphaned; a follow-up assignCourse then created a fresh
      // UserCourse (null pin) and, on activation, pinned the learner to the
      // current LATEST version — silently re-attaching the old progress,
      // completion, quiz-answer, and assessment-attempt rows to a potentially
      // larger denominator. The learner's % could drop (100% → 92%) and a
      // certified completer could quietly move off their frozen pin.
      //
      // The detection MUST enumerate the same 13 tables that
      // resetUserCourseProgress deletes — otherwise a learner who did chapter
      // quizzes / signed a policy / sat the assessment but has zero section
      // progress passes as "clean" and the loophole survives narrower.
      const residual = await this.probeUserCourseResidualState(
        userId,
        courseId,
      );

      if (residual.hasAny && !options?.force) {
        throw new HttpException(
          {
            status: HttpStatus.CONFLICT,
            error:
              'Refusing to unassign: learner has progress or completion data. ' +
              'Deleting the enrollment now would leave orphaned state that ' +
              'silently re-attaches on re-assignment (progress % may drop, ' +
              'completion may be re-pinned to a newer version). ' +
              'Re-send with { force: true } to wipe all learner state for ' +
              'this course, or use POST /courses/enrollments/migrate-version ' +
              'to move the learner between versions without touching progress.',
            details: residual.counts,
          },
          HttpStatus.CONFLICT,
        );
      }

      // Force path (or clean unassign): delete UserCourse and ALL residual
      // learner state atomically so the next assignCourse cannot resurrect it.
      // Uses the same enumeration as resetUserCourseProgress via the shared
      // wipeUserCourseState helper so the two paths can't drift.
      //
      // Timeout matters here: the wipe does ~13 sequential deleteMany calls
      // plus the UserCourse delete. Prisma's default interactive-transaction
      // budget is 5s; on Neon with cold starts and connection_limit=1 that
      // is tight and would surface as "Transaction already closed" rolling
      // the whole wipe back — the same failure mode publishNewVersion
      // already documents.
      const wiped = await this.prisma.$transaction(
        async (tx) => {
          const counts = await this.wipeUserCourseState(tx, userId, courseId, {
            // Unassign removes the enrollment entirely, so time-spent should
            // go too — resetUserCourseProgress preserves totalSeconds
            // intentionally (it's a "reset progress" not "erase enrollment").
            deleteSectionTimeSpent: true,
            // Forward the ids we already resolved in the probe so we don't
            // re-run the same two findMany inside the interactive tx.
            chapterIds: residual.chapterIds,
            assessmentIds: residual.assessmentIds,
          });
          await tx.userCourse.delete({ where: { id: userCourse.id } });
          return counts;
        },
        { timeout: 15000, maxWait: 5000 },
      );

      // Audit trail — write for every force-wipe (not just "hadResidualState")
      // so a clean unassign of a learner who just happened to have completed
      // one attempt still leaves a row. Use the shared writeAudit helper so
      // the actor's email is denormalised and the write is best-effort.
      if (options?.adminId && (residual.hasAny || options.force)) {
        await this.courseVersionService.writeAudit({
          adminId: options.adminId,
          action: residual.hasAny ? 'UNASSIGN_COURSE_FORCE' : 'UNASSIGN_COURSE',
          targetType: 'UserCourse',
          targetId: userCourse.id,
          courseId,
          userId,
          metadata: {
            ...residual.counts,
            wiped,
            priorEnrolledVersionId: userCourse.enrolledVersionId,
          },
        });
      }

      return {
        message: residual.hasAny
          ? 'Successfully unassigned course and wiped all learner state (force)'
          : 'Successfully unassigned course from user',
        statusCode: 200,
        data: {
          wiped: residual.hasAny ? wiped : undefined,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to unassign course from user',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async toggleCourseStatus(
    userId: string,
    courseId: string,
    isActive: boolean,
  ): Promise<ResponseDto> {
    try {
      // Check if the user exists
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        throw new Error('User not found');
      }

      // Check if the course exists
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!course) {
        throw new Error('Course not found');
      }

      // Check if the user-course relation exists
      const userCourse = await this.prisma.userCourse.findFirst({
        where: { userId, courseId },
      });
      if (!userCourse) {
        throw new Error('User is not assigned to this course');
      }

      // Update the isActive status for the user-course relation. On the first
      // false→true activation, stamp activatedAt — this is the engagement
      // "start line" for NEVER_STARTED reminders. Only set it once (don't reset
      // on a later deactivate/reactivate would be a product call; keeping the
      // first activation is the conservative choice).
      const isFirstActivation =
        isActive && !userCourse.isActive && !userCourse.activatedAt;

      await this.prisma.$transaction(async (tx) => {
        await tx.userCourse.update({
          where: { id: userCourse.id },
          data: {
            isActive,
            ...(isFirstActivation ? { activatedAt: new Date() } : {}),
          },
        });

        if (isFirstActivation && !userCourse.enrolledVersionId) {
          await this.courseVersionService.pinEnrollmentToLatest(
            userCourse.id,
            tx,
          );
        }
      });

      return {
        message: `Successfully ${
          isActive ? 'activated' : 'deactivated'
        } course status for user`,
        statusCode: 200,
        data: {
          userId,
          courseId,
          isActive,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error:
            error?.message ||
            `Failed to ${isActive ? 'activate' : 'deactivate'} course status`,
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async toggleCoursePaymentStatus(
    userId: string,
    courseId: string,
    isPaid: boolean,
  ): Promise<ResponseDto> {
    try {
      // Check if the user exists
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        throw new Error('User not found');
      }

      // Check if the course exists
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!course) {
        throw new Error('Course not found');
      }

      // Check if the user-course relation exists
      const userCourse = await this.prisma.userCourse.findFirst({
        where: { userId, courseId },
      });
      if (!userCourse) {
        throw new Error('User is not assigned to this course');
      }

      // Update the isActive status for the user-course relation
      await this.prisma.userCourse.update({
        where: { id: userCourse.id },
        data: { isPaid },
      });

      return {
        message: `Successfully ${
          isPaid ? 'activated' : 'deactivated'
        } course payment status for user`,
        statusCode: 200,
        data: {
          userId,
          courseId,
          isPaid,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error:
            error?.message ||
            `Failed to ${
              isPaid ? 'activate' : 'deactivate'
            } course payment status`,
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async getAllAssignedCourses(userId: string, role: string): Promise<any> {
    try {
      const whereCondition =
        role === 'user' ? { userId, isActive: true } : { userId };

      const assignedCourses = await this.prisma.userCourse.findMany({
        where: whereCondition,
        include: {
          course: {
            include: {
              courseForms: {
                include: {
                  userFormCompletions: {
                    where: { userId },
                    select: { isComplete: true, metadata: true },
                  },
                },
              },
              Policy: {
                include: {
                  completions: {
                    where: { userId },
                    select: { isComplete: true },
                  },
                  items: {
                    where: { isRequired: true },
                    include: {
                      completions: {
                        where: { userId },
                        select: { isComplete: true },
                      },
                    },
                  },
                },
              },
              // Live denominator source for UNPINNED learners (the pinned
              // path uses versionSectionCounts from CourseVersion.sectionCount
              // and skips this entirely). It must match countCompletionDenominator's
              // live path — isArchived:false + isActive:true at every level —
              // otherwise the list card can show 87% while the completion
              // gate treats the learner as done. Now that "delete" archives
              // instead of hard-deleting when a version references the row,
              // archived sections routinely exist in the tree and this
              // divergence would fire on almost every course that has ever
              // been edited.
              modules: {
                where: { isArchived: false },
                select: {
                  chapters: {
                    where: { isArchived: false },
                    select: {
                      _count: {
                        select: {
                          sections: {
                            where: { isArchived: false, isActive: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
              // Filter the numerator to match the denominator above
              // (modules → chapters → sections filter isArchived:false,
              // isActive:true). Prior to this filter, an unpinned learner
              // with progress on a now-archived section would push
              // percentage past 100 (userCourseProgressCount / sectionsCount
              // with mismatched filters). The FE's calculateProgress helper
              // does not clamp — see docs/frontend-progress-display-guide.md
              // §4.2 line 106 — so the ratio must be pre-clamped here.
              // UserCourseProgress cascades on section hard-delete but
              // survives archive; this filter is the reason.
              _count: {
                select: {
                  UserCourseProgress: {
                    where: {
                      userId,
                      Section: { isArchived: false, isActive: true },
                    },
                  },
                },
              },
              feedbackForm: {
                select: { isRequired: true, isActive: true },
              },
              LastSeenSection: {
                where: { userId },
                take: 1,
                orderBy: { updatedAt: 'desc' },
                include: {
                  section: { select: { title: true } },
                },
              },
            },
          },
        },
      });

      if (!assignedCourses.length) {
        return {
          message: 'Successfully retrieved assigned courses',
          statusCode: 200,
          data: [],
        };
      }

      const courseIds = assignedCourses.map((uc) => uc.courseId);
      const [feedbackSubmissions, completions] = await Promise.all([
        this.prisma.courseFeedbackSubmission.findMany({
          where: { userId, courseId: { in: courseIds } },
          select: { courseId: true },
        }),
        // Completion timestamps drive the post-completion access window so the
        // list can flag expired courses without a per-course gate fetch.
        this.prisma.courseCompletion.findMany({
          where: { userId, courseId: { in: courseIds } },
          select: { courseId: true, courseCompletedAt: true },
        }),
      ]);
      const feedbackSubmittedIds = new Set(
        feedbackSubmissions.map((s) => s.courseId),
      );
      const completedAtByCourse = new Map(
        completions
          .filter((c) => c.courseCompletedAt)
          .map((c) => [c.courseId, c.courseCompletedAt as Date]),
      );

      // Percentages via the shared engine. Batched across every assigned
      // course in one call — a 10-course dashboard costs a fixed number of
      // round trips, not one per card. Pins are already on the rows, so the
      // engine skips its own enrollment lookup.
      //
      // Previously the denominator came from the stored
      // CourseVersion.sectionCount while the numerator came from a `_count`
      // sub-select filtered to LIVE sections. Those describe different trees:
      // a learner who finished their pinned version read <100 once one of its
      // sections was archived, disagreeing with the completion gate (which
      // derives both halves from the manifest). The engine derives both from
      // one view, so that cannot happen here.
      const learnerPercentages = await computeLearnerPercentages(
        this.prisma,
        assignedCourses.map((uc) => ({
          userId,
          courseId: uc.courseId,
          enrolledVersionId: uc.enrolledVersionId ?? null,
        })),
      );

      const coursesWithDetails = assignedCourses.map((userCourse) => {
        // enrolledVersionId is no longer read here — the percentage engine
        // resolves the learner's curriculum from the pin passed in above.
        const { course, isActive, isPaid } = userCourse as any;

        // Form completion status (unchanged)
        const formStatus = {
          totalForms: course.courseForms?.length || 0,
          completedForms:
            course.courseForms?.filter(
              (form) => form.userFormCompletions?.some((uc) => uc.isComplete),
            ).length || 0,
          forms:
            course.courseForms?.map((form) => ({
              courseFormId: form.id,
              formId: form.formId,
              formName: form.formName,
              isRequired: form.isRequired,
              isComplete:
                form.userFormCompletions?.some((uc) => uc.isComplete) || false,
              metadata: form.userFormCompletions?.[0]?.metadata ?? null,
            })) || [],
        };

        // Policy completion status - only required policies matter for access
        const requiredPolicies = course.Policy || [];

        // Policy-level completion (all required policies must be completed)
        const allRequiredPoliciesCompleted = requiredPolicies.every(
          (policy) => policy.completions?.some((uc) => uc.isComplete),
        );

        // Item-level completion (all required items across all policies must be completed)
        const allRequiredItems = requiredPolicies.flatMap(
          (policy) => policy.items?.filter((item) => item.isRequired) || [],
        );

        const allRequiredItemsCompleted = allRequiredItems.every(
          (item) => item.completions?.some((uc) => uc.isComplete),
        );

        const policyStatus = {
          totalPolicies: requiredPolicies.length,
          completedPolicies:
            requiredPolicies.filter(
              (policy) => policy.completions?.some((uc) => uc.isComplete),
            ).length || 0,
          policies:
            requiredPolicies.map((policy) => ({
              policyId: policy.id,
              title: policy.title,
              description: policy.description,
              isComplete:
                policy.completions?.some((uc) => uc.isComplete) || false,
              items:
                policy.items?.map((item) => ({
                  itemId: item.id,
                  title: item.title,
                  description: item.description,
                  link: item.link,
                  isRequired: item.isRequired,
                  isComplete:
                    item.completions?.some((uc) => uc.isComplete) || false,
                })) || [],
            })) || [],
        };

        const learnerProgress = learnerPercentages.get(
          percentageKey(userId, course.id),
        );
        // Fall back to the live tree only if the engine somehow has no entry
        // for this pair (it pre-seeds every pair, so this is belt-and-braces).
        const sectionsCount =
          learnerProgress?.denominator ??
          (course.modules
            ?.flatMap((module) => module.chapters)
            ?.reduce((acc, chapter) => acc + chapter._count.sections, 0) ||
            0);

        const userCourseProgressCount =
          learnerProgress?.numerator ?? course._count?.UserCourseProgress ?? 0;

        const latestLastSeenSection = course.LastSeenSection?.[0];

        const formsCompleted =
          formStatus.totalForms === formStatus.completedForms;

        // Updated access control logic
        const canAccessPolicies = formsCompleted;
        const registrationGate = evaluateRegistrationAccess(
          formStatus.forms.map((form) => ({
            formId: form.formId,
            metadata: form.metadata,
          })),
        );
        const canAccessContent =
          formsCompleted &&
          allRequiredItemsCompleted &&
          !registrationGate.blocked;

        // Post-completion access window: once completed, access lasts
        // validityDays (default 365) from courseCompletedAt. Computed live;
        // mirrors the canAccessCourseContent gate so list CTAs can show an
        // "expired" state without a per-course gate fetch. Learners only.
        const completedAt = completedAtByCourse.get(course.id);
        const isFrozen = !!completedAt;

        // Invariant, not a fix: with numerator and denominator drawn from one
        // curriculum view a certified learner cannot compute below 100. If
        // this fires, scoping has drifted somewhere and the freeze is masking
        // it — which is exactly what the old `isFrozen ? 100` clamp did
        // silently. Warn rather than clamp-and-forget.
        if (
          completedAt &&
          learnerProgress &&
          learnerProgress.percentage < 100 &&
          learnerProgress.denominator > 0
        ) {
          CourseService.completionLogger.warn(
            `Percentage invariant: certified learner ${userId} on course ${course.id} computed ` +
              `${learnerProgress.numerator}/${learnerProgress.denominator} ` +
              `(source=${learnerProgress.denominatorSource}); frozen to 100 for display.`,
          );
        }
        let expired = false;
        let expiresAt: Date | null = null;
        if (completedAt) {
          expiresAt = new Date(completedAt);
          expiresAt.setDate(expiresAt.getDate() + (course.validityDays ?? 365));
          expired = role === 'user' && new Date() > expiresAt;
        }

        return {
          ...course,
          isActive,
          isPaid,
          expired,
          expiresAt,
          isCompleted: isFrozen,
          completedAt: completedAt ?? null,
          feedbackForm: course.feedbackForm
            ? {
                isRequired: course.feedbackForm.isRequired,
                isCompleted: feedbackSubmittedIds.has(course.id),
              }
            : null,
          percentage: learnerProgress
            ? learnerProgress.percentage
            : isFrozen
              ? 100
              : sectionsCount > 0
                ? (userCourseProgressCount * 100) / sectionsCount
                : 0,
          // Raw counts stay truthful for a frozen completer EXCEPT that the
          // numerator is clamped to the denominator: the FE divides these two
          // itself (CourseContent.tsx) and its `done >= sections` gate is
          // unclamped, so letting them disagree would unlock content early.
          _count: {
            totalSections: sectionsCount,
            userCourseProgress: isFrozen
              ? sectionsCount
              : Math.min(userCourseProgressCount, sectionsCount),
          },
          formStatus,
          policyStatus,
          policyItemStatus: {
            totalItems: allRequiredItems.length,
            completedItems: allRequiredItems.filter(
              (item) => item.completions?.some((uc) => uc.isComplete),
            ).length,
          },
          canAccessPolicies,
          canAccessContent,
          ...(registrationGate.blocked &&
          formsCompleted &&
          allRequiredItemsCompleted
            ? {
                reason: registrationGate.reason,
                registrationStatus: registrationGate.registrationStatus,
                registrationComments: registrationGate.comments,
                message: registrationGate.message,
              }
            : registrationGate.registrationStatus
              ? {
                  registrationStatus: registrationGate.registrationStatus,
                  registrationComments: registrationGate.comments,
                }
              : {}),
          latestLastSeenSection: latestLastSeenSection
            ? {
                id: latestLastSeenSection.id,
                userId: latestLastSeenSection.userId,
                chapterId: latestLastSeenSection.chapterId,
                moduleId: latestLastSeenSection.moduleId,
                sectionId: latestLastSeenSection.sectionId,
                createdAt: latestLastSeenSection.createdAt,
                updatedAt: latestLastSeenSection.updatedAt,
                title: latestLastSeenSection.section.title,
              }
            : null,
        };
      });

      return {
        message: 'Successfully retrieved assigned courses with status',
        statusCode: 200,
        data: coursesWithDetails,
      };
    } catch (error) {
      console.error(error);
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async getAllAssignedCoursesPublic(userId: string): Promise<any> {
    try {
      // Fetch assigned courses from UserCourse table
      const assignedCourses = await this.prisma.userCourse.findMany({
        where: { userId },
        include: {
          course: {
            select: {
              id: true,
              title: true,
              price: true,
            },
          },
        },
        // select: {
        //   course: {
        //     select: {
        //       id: true,
        //       title: true,
        //       price: true,
        //       // isActive: true,
        //     },
        //   },
        // },
      });
      // Check if no courses are assigned
      // if (!assignedCourses.length) {
      //   throw new HttpException(
      //     {
      //       status: HttpStatus.NOT_FOUND,
      //       error: 'No courses assigned to this user',
      //     },
      //     HttpStatus.NOT_FOUND,
      //   );
      // }

      // Map courses to extract only public fields
      // const courses = assignedCourses.map((userCourse) => userCourse.course);

      return {
        message: 'Successfully retrieved assigned courses',
        statusCode: 200,
        data: assignedCourses,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async updateUserChapterProgress(
    userId: string,
    body: any,
    userEmail?: string | null,
  ): Promise<ResponseDto> {
    try {
      await assertChapterAccessible(
        this.prisma,
        this.config,
        userId,
        body.chapterId,
        userEmail,
      );

      // Existence check for the course. Previously this fetched the course
      // with `include: { modules: true }` — every Module row for the course
      // — but nothing in this method reads `course.modules`. The comment
      // "Get total modules in the course" was a leftover from an older
      // module-rollup path that no longer lives here. This runs on the
      // hottest write path in the app (every section completion), so on a
      // course with 12 modules that was 12 dead Module rows per completion,
      // per user, forever.
      const course = await this.prisma.course.findUnique({
        where: { id: body.courseId },
        select: { id: true },
      });
      if (!course) {
        throw new Error('Course not found');
      }

      // Existence check for the user. `assertChapterAccessible` above
      // already validates the JWT-derived userId against gating rules, so
      // this is just a defensive "was the user hard-deleted between token
      // issue and this call?" probe. Kept as `select: { id: true }` for the
      // same reason we trimmed the course load — the previous full-row
      // fetch was ~12 wasted columns per call.
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      if (!user) {
        throw new Error('user not found');
      }
      // Update or create progress record
      let userCourseProgress = await this.prisma.userCourseProgress.findFirst({
        where: {
          userId: userId,
          courseId: body.courseId,
          chapterId: body.chapterId,
          sectionId: body.sectionId,
          moduleId: body.moduleId,
        },
      });
      if (!userCourseProgress) {
        userCourseProgress = await this.prisma.userCourseProgress.create({
          data: {
            userId: userId,
            courseId: body.courseId,
            chapterId: body.chapterId,
            sectionId: body.sectionId,
            moduleId: body.moduleId,
          },
        });
        // A new section was just completed — re-check whether the user has now
        // finished all content for this course (content completion is the
        // course-completion criterion; assessment pass is tracked separately).
        await this.courseCompletion.checkContentCompletion(
          userId,
          body.courseId,
        );
        await recordChapterAndModuleCompletionIfNeeded(
          this.prisma,
          userId,
          body.chapterId,
          { courseId: body.courseId },
        );
      }

      return {
        message: 'User course progress updated successfully',
        statusCode: 200,
        data: {
          userCourseProgress,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  /**
   * Resolve a learner's enrollment for a course and assert it is currently
   * usable. Enforces, for `user`-role callers only (admins/staff bypass):
   *   1. an enrollment exists and is active (UserCourse.isActive), and
   *   2. the post-completion access window has not elapsed — once a course is
   *      completed (CourseCompletion.courseCompletedAt), access lasts
   *      course.validityDays days (default 365). Expiry is computed live; the
   *      enrollment row is left untouched.
   *
   * Returns the enrollment on success. Throws ForbiddenException otherwise, so
   * callers can replace their existing inline enrollment lookup with this.
   */
  private async _assertEnrollmentUsable(
    userId: string,
    courseId: string,
    userRole: Role,
  ): Promise<any> {
    const isLearner = userRole === Role.user;
    const enrollment = await this.prisma.userCourse.findFirst({
      where: isLearner
        ? { userId, courseId, isActive: true }
        : { userId, courseId },
    });
    if (!enrollment) {
      throw new ForbiddenException({
        detail:
          'You are not assigned to this course, or the enrolment is inactive',
      });
    }

    // Expiry only applies to learners and only once the course is completed.
    if (isLearner) {
      const [completion, course] = await Promise.all([
        this.prisma.courseCompletion.findUnique({
          where: { userId_courseId: { userId, courseId } },
          select: { courseCompletedAt: true },
        }),
        this.prisma.course.findUnique({
          where: { id: courseId },
          select: { validityDays: true },
        }),
      ]);

      if (completion?.courseCompletedAt) {
        const validityDays = course?.validityDays ?? 365;
        const expiresAt = new Date(completion.courseCompletedAt);
        expiresAt.setDate(expiresAt.getDate() + validityDays);
        if (new Date() > expiresAt) {
          throw new ForbiddenException({
            detail: `Your access to this course expired on ${
              expiresAt.toISOString().split('T')[0]
            }. Please contact your administrator to renew access.`,
          });
        }
      }
    }

    return enrollment;
  }

  async getUserChapterProgress(
    userId: string,
    courseId: string,
    chapterId: string,
  ): Promise<ResponseDto> {
    try {
      const [userCourseProgress, completion, curriculum] = await Promise.all([
        this.prisma.userCourseProgress.findMany({
          where: {
            userId,
            courseId,
            chapterId,
          },
        }),
        this.prisma.courseCompletion.findUnique({
          where: { userId_courseId: { userId, courseId } },
          select: { courseCompletedAt: true },
        }),
        this.courseVersionService.resolveCurriculumTree(userId, courseId),
      ]);

      const newSinceCompletion =
        await this.courseVersionService.summarizeNewSincePinnedVersion(
          userId,
          courseId,
        );

      if (curriculum.mode === 'versioned') {
        const found = this.courseVersionService.findVersionChapterBySourceId(
          curriculum.tree,
          chapterId,
        );
        if (!found) {
          throw new HttpException(
            { status: HttpStatus.NOT_FOUND, error: 'Chapter not found' },
            HttpStatus.NOT_FOUND,
          );
        }

        const versionSectionIds = found.chapter.sections.map((s) => s.id);
        const totalSections = versionSectionIds.length;
        const progressSectionIds = new Set(
          userCourseProgress.map((p) => p.sectionId),
        );
        const completedSections = Math.min(
          versionSectionIds.filter((id) => progressSectionIds.has(id)).length,
          totalSections,
        );

        const isFrozen = !!completion?.courseCompletedAt;
        let percentage = 0;
        if (isFrozen) {
          percentage = 100;
        } else if (totalSections > 0) {
          percentage = (completedSections * 100) / totalSections;
        }

        return {
          message: 'User course progress updated successfully',
          statusCode: 200,
          data: {
            userCourseProgress: percentage,
            courseProgressData: userCourseProgress,
            totalSections,
            completedSections: isFrozen ? totalSections : completedSections,
            isCompleted: isFrozen,
            completedAt: completion?.courseCompletedAt ?? null,
            enrolledVersionNumber: curriculum.versionNumber,
            ...(newSinceCompletion ? { newSinceCompletion } : {}),
          },
        };
      }

      const chapter = await this.prisma.chapter.findUnique({
        where: { id: chapterId },
        include: {
          // isActive:true belongs here alongside isArchived:false — every
          // other live path (countCompletionDenominator, getAllUserModules,
          // the percentage engine) treats an inactive section as outside the
          // curriculum, and omitting it made this endpoint's denominator
          // larger than the completion gate's for the same chapter.
          sections: {
            where: { isArchived: false, isActive: true },
            select: { id: true },
          },
          module: { select: { courseId: true } },
        },
      });

      if (!chapter) {
        throw new HttpException(
          { status: HttpStatus.NOT_FOUND, error: 'Chapter not found' },
          HttpStatus.NOT_FOUND,
        );
      }
      if (chapter.module?.courseId !== courseId) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Chapter does not belong to the specified course',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const isFrozen = !!completion?.courseCompletedAt;
      const liveSectionIds = chapter.sections.map((s) => s.id);
      const totalSections = liveSectionIds.length;
      // Intersect rather than count-and-clamp. UserCourseProgress rows outlive
      // the sections they reference (they only cascade on hard delete), so a
      // raw count includes progress on sections that are no longer part of the
      // chapter. Clamping hid that as "exactly 100%"; intersecting reports the
      // learner's true position against the live chapter, matching the
      // versioned branch above and countCompletionDenominator.
      const progressedSectionIds = new Set(
        userCourseProgress.map((p) => p.sectionId),
      );
      const completedSections = liveSectionIds.filter((sid) =>
        progressedSectionIds.has(sid),
      ).length;

      let percentage = 0;
      if (isFrozen) {
        percentage = 100;
      } else if (totalSections > 0) {
        percentage = (completedSections * 100) / totalSections;
      }

      return {
        message: 'User course progress updated successfully',
        statusCode: 200,
        data: {
          userCourseProgress: percentage,
          courseProgressData: userCourseProgress,
          totalSections,
          completedSections: isFrozen ? totalSections : completedSections,
          isCompleted: isFrozen,
          completedAt: completion?.courseCompletedAt ?? null,
          ...(newSinceCompletion ? { newSinceCompletion } : {}),
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async getLastSeenSection(
    userId: string,
    chapterId: string,
  ): Promise<ResponseDto> {
    try {
      const getLastSeenSection = await this.prisma.lastSeenSection.findUnique({
        where: {
          userId_chapterId: { userId, chapterId },
        },
      });

      return {
        message: 'success',
        statusCode: 200,
        data: getLastSeenSection,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async updateLastSeenSection(
    userId: string,
    chapterId: string,
    sectionId: string,
    moduleId: string,
    courseId: string,
    userEmail?: string | null,
  ): Promise<ResponseDto> {
    try {
      await assertChapterAccessible(
        this.prisma,
        this.config,
        userId,
        chapterId,
        userEmail,
      );

      await this.prisma.lastSeenSection.upsert({
        where: {
          userId_chapterId: { userId, chapterId },
        },
        update: {
          sectionId,
        },
        create: {
          userId,
          chapterId,
          sectionId,
          moduleId,
          courseId,
        },
      });

      return {
        message: 'success',
        statusCode: 200,
        data: {},
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  // Student: submit course completion feedback (delegates to FeedbackService)
  async submitCourseFeedback(
    studentId: string,
    courseId: string,
    body: { formVersion?: string; formData: unknown },
  ): Promise<ResponseDto> {
    return this.feedbackService.submitCourseFeedback(studentId, courseId, body);
  }

  async getCourseFeedbackStatus(
    studentId: string,
    courseId: string,
  ): Promise<ResponseDto> {
    return this.feedbackService.getCourseFeedbackStatus(studentId, courseId);
  }

  async getCourseFeedbackSubmissions(
    courseId: string,
    adminId: string,
  ): Promise<ResponseDto> {
    return this.feedbackService.getCourseFeedbackSubmissions(courseId, adminId);
  }

  /**
   * Testing/admin: clear all learner progress for a course (sections, quizzes,
   * forms, policies, feedback, assessments). Does not unassign the course.
   */
  async resetUserCourseProgress(
    adminId: string,
    userId: string,
    courseId: string,
  ): Promise<ResponseDto> {
    try {
      const admin = await this.prisma.user.findUnique({
        where: { id: adminId },
        select: { role: true },
      });
      if (!admin || admin.role !== 'admin') {
        throw new ForbiddenException('Only admins can reset course progress');
      }

      const [user, course] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, deletedAt: true },
        }),
        this.prisma.course.findUnique({
          where: { id: courseId },
          select: { id: true },
        }),
      ]);
      if (!user || user.deletedAt) {
        throw new BadRequestException('User not found');
      }
      if (!course) {
        throw new BadRequestException('Course not found');
      }

      // Uses the shared wipeUserCourseState helper so this admin reset and the
      // unassign force-wipe path can't drift. Passes deleteSectionTimeSpent
      // false to preserve totalSeconds — resetting progress isn't the same as
      // erasing the enrollment.
      //
      // Timeout bump for the same reason unAssignCourse sets one: the wipe
      // does 2 findMany + 13 sequential mutations; 5s default is not enough
      // on Neon during cold starts.
      const wiped = await this.prisma.$transaction(
        (tx) =>
          this.wipeUserCourseState(tx, userId, courseId, {
            deleteSectionTimeSpent: false,
          }),
        { timeout: 15000, maxWait: 5000 },
      );

      // Preserve the historical response shape callers may depend on. The
      // 'sectionAttemptsReset' field mirrors the counter-reset semantics for
      // SectionTimeSpent that resetUserCourseProgress uses.
      const deleted = {
        sectionProgress: wiped.sectionProgress,
        lastSeen: wiped.lastSeen,
        quizProgress: wiped.quizProgress,
        quizAnswers: wiped.quizAnswers,
        formCompletions: wiped.formCompletions,
        policyCompletions: wiped.policyCompletions,
        policyItemCompletions: wiped.policyItemCompletions,
        feedbackSubmissions: wiped.feedbackSubmissions,
        courseCompletions: wiped.courseCompletions,
        chapterCompletions: wiped.chapterCompletions,
        moduleCompletions: wiped.moduleCompletions,
        sectionAttemptsReset: wiped.sectionTimeSpent,
        assessmentAttempts: wiped.assessmentAttempts,
      };

      return {
        message: 'User course progress reset successfully',
        statusCode: 200,
        data: { userId, courseId, deleted },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to reset course progress',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
