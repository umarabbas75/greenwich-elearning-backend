import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  FeedbackOverallRating,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from '../notifications/notification.service';
import { ResponseDto } from '../dto';
import { ADMIN_EMAIL } from '../mail/templates/mail-layout';
import {
  FEEDBACK_FORM_VERSION,
  FEEDBACK_LIKERT_KEYS,
  FEEDBACK_OVERALL_RATINGS,
  FEEDBACK_REMINDER_AFTER_DAYS,
  computeMeanLikertRating,
  feedbackDedupeKey,
  feedbackGroupKey,
  validateFeedbackFormData,
} from './feedback.constants';

export interface SubmitCourseFeedbackInput {
  formVersion?: string;
  formData: unknown;
}

export interface AdminFeedbackListQuery {
  courseId?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class FeedbackService {
  private static readonly logger = new Logger(FeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly notifications: NotificationService,
  ) {}

  // ── Student: submit ─────────────────────────────────────────────────────

  async submitCourseFeedback(
    studentId: string,
    courseId: string,
    input: SubmitCourseFeedbackInput,
  ): Promise<ResponseDto> {
    try {
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!course) {
        throw new Error('Course not found');
      }

      const feedbackForm = await this.prisma.courseFeedbackForm.findFirst({
        where: { courseId, isActive: true },
      });
      if (!feedbackForm) {
        throw new Error('No feedback form found for this course');
      }

      const enrollment = await this.prisma.userCourse.findFirst({
        where: { userId: studentId, courseId, isActive: true },
      });
      if (!enrollment) {
        throw new Error('You are not enrolled in this course');
      }

      const existing = await this.prisma.courseFeedbackSubmission.findFirst({
        where: { userId: studentId, courseId },
      });
      if (existing) {
        throw new ConflictException({ message: 'Feedback already submitted.' });
      }

      let formData: Record<string, unknown>;
      try {
        formData = validateFeedbackFormData(input.formData);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid formData';
        throw new BadRequestException(message);
      }

      const meanRating = computeMeanLikertRating(formData);
      const overallRating = formData.overallRating as FeedbackOverallRating;

      const student = await this.prisma.user.findUnique({
        where: { id: studentId },
        select: { id: true, email: true, firstName: true, lastName: true },
      });

      const learnerEmail =
        typeof formData.email === 'string' && formData.email.trim()
          ? formData.email.trim()
          : student?.email ?? null;

      const completion = await this.prisma.courseFeedbackSubmission.create({
        data: {
          userId: studentId,
          courseId,
          feedbackFormId: feedbackForm.id,
          formVersion: input.formVersion ?? FEEDBACK_FORM_VERSION,
          responses: formData as Prisma.InputJsonValue,
          meanRating,
          overallRating,
          learnerEmail,
        },
      });

      await this.markFeedbackNotificationsRead(studentId, courseId);

      try {
        const studentName = `${student?.firstName ?? ''} ${
          student?.lastName ?? ''
        }`.trim();
        if (student?.email) {
          await this.mail.sendFeedbackReceived({
            to: student.email,
            userId: studentId,
            firstName: student.firstName ?? '',
            courseTitle: course.title,
          });
        }
        await this.mail.sendFeedbackReceivedAdmin({
          to: ADMIN_EMAIL,
          studentName: studentName || 'A student',
          studentEmail: learnerEmail ?? student?.email ?? 'unknown',
          courseTitle: course.title,
        });
      } catch (mailErr) {
        const m = mailErr instanceof Error ? mailErr.message : String(mailErr);
        FeedbackService.logger.warn(
          `Feedback emails failed for user ${studentId}, course ${courseId}: ${m}`,
        );
      }

      return {
        message: 'Course feedback submitted successfully',
        statusCode: 200,
        data: this.toSubmissionDetail(completion, course.title, student),
      };
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to submit feedback',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  // ── Student: status ─────────────────────────────────────────────────────

  async getCourseFeedbackStatus(
    studentId: string,
    courseId: string,
  ): Promise<ResponseDto> {
    try {
      const feedbackForm = await this.prisma.courseFeedbackForm.findFirst({
        where: { courseId, isActive: true },
      });

      const completion = await this.prisma.courseFeedbackSubmission.findFirst({
        where: { userId: studentId, courseId },
      });

      return {
        message: 'Course feedback status fetched successfully',
        statusCode: 200,
        data: {
          isCompleted: !!completion,
          isRequired: feedbackForm?.isRequired ?? false,
          submittedAt: completion?.submittedAt?.toISOString() ?? undefined,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to fetch feedback status',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  // ── Student: pending list (global banner) ───────────────────────────────

  async getPendingFeedbackForUser(userId: string): Promise<ResponseDto> {
    try {
      const [completions, submissions] = await Promise.all([
        this.prisma.courseCompletion.findMany({
          where: {
            userId,
            courseCompletedAt: { not: null },
            course: {
              feedbackForm: { isRequired: true, isActive: true },
            },
          },
          include: {
            course: {
              select: { id: true, title: true, tutorInfo: true },
            },
          },
          orderBy: { courseCompletedAt: 'desc' },
        }),
        this.prisma.courseFeedbackSubmission.findMany({
          where: { userId },
          select: { courseId: true },
        }),
      ]);

      const submittedIds = new Set(submissions.map((s) => s.courseId));
      const now = Date.now();
      const msPerDay = 86_400_000;

      const data = completions
        .filter((c) => !submittedIds.has(c.courseId))
        .map((c) => {
          const completedAt = c.courseCompletedAt!;
          const daysSinceCompletion = Math.floor(
            (now - completedAt.getTime()) / msPerDay,
          );
          const daysOverdue = Math.max(
            0,
            daysSinceCompletion - FEEDBACK_REMINDER_AFTER_DAYS,
          );

          return {
            courseId: c.courseId,
            courseTitle: c.course.title,
            completedAt: completedAt.toISOString(),
            daysOverdue,
            trainerName: this.extractTrainerName(c.course.tutorInfo),
          };
        });

      return {
        message: 'Pending feedback fetched successfully',
        statusCode: 200,
        data,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to fetch pending feedback',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  // ── Admin: list ─────────────────────────────────────────────────────────

  async listAdminSubmissions(
    adminId: string,
    query: AdminFeedbackListQuery,
  ): Promise<ResponseDto> {
    await this.assertAdminAsync(adminId);

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const skip = (page - 1) * limit;

    const where = this.buildAdminListWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.courseFeedbackSubmission.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          course: { select: { title: true } },
        },
        orderBy: { submittedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.courseFeedbackSubmission.count({ where }),
    ]);

    return {
      message: 'Feedback submissions fetched successfully',
      statusCode: 200,
      data: rows.map((row) => this.toAdminListRow(row)),
      total,
    };
  }

  // ── Admin: detail ───────────────────────────────────────────────────────

  async getAdminSubmissionDetail(
    adminId: string,
    submissionId: string,
  ): Promise<ResponseDto> {
    await this.assertAdminAsync(adminId);

    const row = await this.prisma.courseFeedbackSubmission.findUnique({
      where: { id: submissionId },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        course: { select: { title: true } },
      },
    });

    if (!row) {
      throw new HttpException(
        { status: HttpStatus.NOT_FOUND, error: 'Submission not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      message: 'Feedback submission fetched successfully',
      statusCode: 200,
      data: this.toSubmissionDetail(row, row.course.title, row.user),
    };
  }

  // ── Admin: aggregate ────────────────────────────────────────────────────

  async getAdminAggregate(
    adminId: string,
    courseId?: string,
  ): Promise<ResponseDto> {
    await this.assertAdminAsync(adminId);

    const where: Prisma.CourseFeedbackSubmissionWhereInput = courseId
      ? { courseId }
      : {};

    const submissions = await this.prisma.courseFeedbackSubmission.findMany({
      where,
      select: { meanRating: true, overallRating: true, responses: true },
    });

    const withMean = submissions.filter((s) => s.meanRating != null);
    const meanOverall =
      withMean.length > 0
        ? Math.round(
            (withMean.reduce((sum, s) => sum + Number(s.meanRating), 0) /
              withMean.length) *
              100,
          ) / 100
        : 0;

    const overallDistribution = Object.fromEntries(
      FEEDBACK_OVERALL_RATINGS.map((k) => [k, 0]),
    ) as Record<FeedbackOverallRating, number>;

    for (const s of submissions) {
      if (s.overallRating) overallDistribution[s.overallRating] += 1;
    }

    const perQuestion = FEEDBACK_LIKERT_KEYS.map((key) => {
      const values: number[] = [];
      for (const s of submissions) {
        const data = s.responses as Record<string, unknown>;
        const raw = data?.[key];
        if (typeof raw === 'string' && /^[1-5]$/.test(raw)) {
          values.push(Number(raw));
        }
      }
      const mean =
        values.length > 0
          ? Math.round(
              (values.reduce((a, b) => a + b, 0) / values.length) * 100,
            ) / 100
          : 0;
      return { key, mean, count: values.length };
    });

    return {
      message: 'Feedback aggregate fetched successfully',
      statusCode: 200,
      data: {
        count: submissions.length,
        meanOverall,
        overallDistribution,
        perQuestion,
      },
    };
  }

  // ── Legacy admin: per-course submissions (backward compat) ────────────────

  async getCourseFeedbackSubmissions(
    courseId: string,
    adminId: string,
  ): Promise<ResponseDto> {
    await this.assertAdminAsync(adminId);

    const completions = await this.prisma.courseFeedbackSubmission.findMany({
      where: { courseId },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        course: { select: { title: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });

    return {
      message: 'Course feedback submissions fetched successfully',
      statusCode: 200,
      data: {
        courseId,
        submissions: completions.map((c) => ({
          user: c.user,
          submittedAt: c.submittedAt,
          responses: c.responses,
        })),
        totalSubmissions: completions.length,
      },
    };
  }

  // ── Completion hook: in-app notification + optional email ───────────────

  async notifyFeedbackRequiredIfNeeded(
    userId: string,
    courseId: string,
  ): Promise<void> {
    try {
      const [form, alreadySubmitted, course, user] = await Promise.all([
        this.prisma.courseFeedbackForm.findFirst({
          where: { courseId, isActive: true, isRequired: true },
        }),
        this.prisma.courseFeedbackSubmission.findFirst({
          where: { userId, courseId },
          select: { id: true },
        }),
        this.prisma.course.findUnique({
          where: { id: courseId },
          select: { title: true },
        }),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { email: true, firstName: true, deletedAt: true },
        }),
      ]);

      if (!form || alreadySubmitted || !course || user?.deletedAt) return;

      await this.notifications.createNotification({
        userId,
        type: NotificationType.COURSE_FEEDBACK_REQUIRED,
        message: `Please share your feedback for ${course.title}.`,
        payload: {
          courseId,
          courseTitle: course.title,
          daysOverdue: 0,
        },
        groupKey: feedbackGroupKey(courseId),
        dedupeKey: feedbackDedupeKey(courseId, userId, 'initial'),
        referenceId: courseId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      FeedbackService.logger.warn(
        `Feedback-required notification failed for user ${userId}, course ${courseId}: ${message}`,
      );
    }
  }

  async markFeedbackNotificationsRead(
    userId: string,
    courseId: string,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.notification.updateMany({
      where: {
        userId,
        type: NotificationType.COURSE_FEEDBACK_REQUIRED,
        referenceId: courseId,
      },
      data: {
        readAt: now,
        seenAt: now,
      },
    });
  }

  /** Whether required feedback blocks certificate access (optional §6). */
  async assertFeedbackSubmittedForCertificate(
    userId: string,
    courseId: string,
  ): Promise<void> {
    const form = await this.prisma.courseFeedbackForm.findFirst({
      where: { courseId, isActive: true, isRequired: true },
    });
    if (!form) return;

    const submission = await this.prisma.courseFeedbackSubmission.findFirst({
      where: { userId, courseId },
    });
    if (!submission) {
      throw new ForbiddenException(
        'Course feedback is required before accessing the certificate.',
      );
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async assertAdminAsync(userId: string): Promise<void> {
    const admin = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!admin || admin.role !== 'admin') {
      throw new ForbiddenException('Only admins can access this resource');
    }
  }

  private buildAdminListWhere(
    query: AdminFeedbackListQuery,
  ): Prisma.CourseFeedbackSubmissionWhereInput {
    const where: Prisma.CourseFeedbackSubmissionWhereInput = {};

    if (query.courseId) where.courseId = query.courseId;

    if (query.from || query.to) {
      where.submittedAt = {};
      if (query.from) {
        where.submittedAt.gte = new Date(`${query.from}T00:00:00.000Z`);
      }
      if (query.to) {
        where.submittedAt.lte = new Date(`${query.to}T23:59:59.999Z`);
      }
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { learnerEmail: { contains: term, mode: 'insensitive' } },
        { course: { title: { contains: term, mode: 'insensitive' } } },
        {
          responses: {
            path: ['learnerName'],
            string_contains: term,
          },
        },
        {
          user: {
            OR: [
              { email: { contains: term, mode: 'insensitive' } },
              { firstName: { contains: term, mode: 'insensitive' } },
              { lastName: { contains: term, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    return where;
  }

  private toAdminListRow(
    row: Prisma.CourseFeedbackSubmissionGetPayload<{
      include: {
        user: {
          select: {
            id: true;
            firstName: true;
            lastName: true;
            email: true;
          };
        };
        course: { select: { title: true } };
      };
    }>,
  ) {
    const formData = (row.responses ?? {}) as Record<string, unknown>;
    const learnerName =
      typeof formData.learnerName === 'string' && formData.learnerName.trim()
        ? formData.learnerName.trim()
        : `${row.user.firstName ?? ''} ${row.user.lastName ?? ''}`.trim();

    return {
      id: row.id,
      submittedAt: row.submittedAt.toISOString(),
      learnerId: row.user.id,
      learnerName: learnerName || 'Unknown',
      learnerEmail:
        row.learnerEmail ??
        (typeof formData.email === 'string' && formData.email.trim()
          ? formData.email.trim()
          : row.user.email),
      courseId: row.courseId,
      courseTitle:
        typeof formData.courseTitle === 'string' && formData.courseTitle.trim()
          ? formData.courseTitle.trim()
          : row.course.title,
      trainerName:
        typeof formData.trainerName === 'string'
          ? formData.trainerName
          : null,
      location:
        typeof formData.location === 'string' ? formData.location : null,
      overallRating: row.overallRating,
      meanRating: row.meanRating != null ? Number(row.meanRating) : null,
    };
  }

  private toSubmissionDetail(
    row: {
      id: string;
      courseId: string;
      userId: string;
      formVersion: string | null;
      responses: unknown;
      meanRating: { toNumber?: () => number } | number | null;
      overallRating: FeedbackOverallRating | null;
      submittedAt: Date;
      learnerEmail: string | null;
    },
    courseTitle: string,
    user?: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string;
    } | null,
  ) {
    const formData = (row.responses ?? {}) as Record<string, unknown>;
    const listFields = {
      id: row.id,
      submittedAt: row.submittedAt.toISOString(),
      learnerId: row.userId,
      learnerName:
        typeof formData.learnerName === 'string'
          ? formData.learnerName
          : user
            ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
            : 'Unknown',
      learnerEmail:
        row.learnerEmail ??
        (typeof formData.email === 'string' ? formData.email : user?.email),
      courseId: row.courseId,
      courseTitle:
        typeof formData.courseTitle === 'string'
          ? formData.courseTitle
          : courseTitle,
      trainerName:
        typeof formData.trainerName === 'string'
          ? formData.trainerName
          : null,
      location:
        typeof formData.location === 'string' ? formData.location : null,
      overallRating: row.overallRating,
      meanRating:
        row.meanRating != null
          ? typeof row.meanRating === 'number'
            ? row.meanRating
            : Number(row.meanRating)
          : null,
    };

    return {
      ...listFields,
      formVersion: row.formVersion,
      formData,
    };
  }

  private extractTrainerName(tutorInfo: string | null | undefined): string | undefined {
    if (!tutorInfo?.trim()) return undefined;
    const firstLine = tutorInfo.trim().split('\n')[0]?.trim();
    return firstLine || undefined;
  }
}
