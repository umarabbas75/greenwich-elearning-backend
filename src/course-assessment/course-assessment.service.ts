import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AssessmentAttemptStatus,
  AssessmentMode,
  NotificationType,
  Prisma,
  QuestionDifficulty,
  QuestionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { CourseVersionService } from '../course-version/course-version.service';
import { CertificateService } from '../certificate/certificate.service';
import { ADMIN_EMAIL } from '../mail/templates/mail-layout';
import { assertImportedCourseTreeLocked } from '../utils/assert-imported-course-tree-locked';
import { assertNoInlineBase64 } from '../utils/reject-inline-base64';
import { courseAccessExpiresAt } from '../utils/course-access-expiry';
import {
  calculateAutoScore,
  stripCorrectAnswerFields,
} from '../utils/question-grading';
import {
  AddAssessmentQuestionDto,
  CreateAssessmentDto,
  CreateQuestionCategoryDto,
  CreateQuestionDto,
  GradeAttemptDto,
  ReorderAssessmentQuestionsDto,
  SaveAttemptAnswersDto,
  SetCertificateDto,
  StartAttemptDto,
  SubmitAttemptDto,
  UpdateAssessmentDto,
  UpdateQuestionCategoryDto,
  UpdateQuestionDto,
} from '../dto';

@Injectable()
export class CourseAssessmentService {
  /** Grace period after the nominal deadline when the server still accepts submit (not configurable per assessment). */
  private static readonly ASSESSMENT_TIMER_GRACE_SECONDS = 60;
  private static readonly logger = new Logger(CourseAssessmentService.name);

  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
    private courseVersionService: CourseVersionService,
    private certificateService: CertificateService,
  ) {}

  /**
   * Maps thrown errors to the right HTTP status:
   *   - Existing HttpException → re-thrown unchanged
   *   - "X not found" / Prisma P2025 → 404
   *   - "You do not have access ..." → 403
   *   - Any other Error → 400 (validation/state)
   *   - Anything else → 500
   */
  private throwMapped(error: unknown, fallback: string): never {
    if (error instanceof HttpException) throw error;

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new HttpException(
        { status: HttpStatus.NOT_FOUND, error: 'Resource not found' },
        HttpStatus.NOT_FOUND,
        { cause: error },
      );
    }

    if (error instanceof Error) {
      const msg = error.message;
      if (/not found/i.test(msg)) {
        throw new HttpException(
          { status: HttpStatus.NOT_FOUND, error: msg },
          HttpStatus.NOT_FOUND,
          { cause: error },
        );
      }
      if (/do not have access/i.test(msg)) {
        throw new HttpException(
          { status: HttpStatus.FORBIDDEN, error: msg },
          HttpStatus.FORBIDDEN,
          { cause: error },
        );
      }
      throw new HttpException(
        { status: HttpStatus.BAD_REQUEST, error: msg || fallback },
        HttpStatus.BAD_REQUEST,
        { cause: error },
      );
    }

    throw new HttpException(
      { status: HttpStatus.INTERNAL_SERVER_ERROR, error: fallback },
      HttpStatus.INTERNAL_SERVER_ERROR,
      { cause: error },
    );
  }

  private throwQuestionCategoryError(error: unknown, fallback: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new HttpException(
          {
            status: HttpStatus.CONFLICT,
            error: 'A category with this name already exists for this course.',
          },
          HttpStatus.CONFLICT,
          { cause: error },
        );
      }
      if (error.code === 'P2025') {
        throw new HttpException(
          { status: HttpStatus.NOT_FOUND, error: 'Category not found' },
          HttpStatus.NOT_FOUND,
          { cause: error },
        );
      }
    }
    if (error instanceof Error && error.message === 'Course not found') {
      throw new HttpException(
        { status: HttpStatus.NOT_FOUND, error: error.message },
        HttpStatus.NOT_FOUND,
        { cause: error },
      );
    }
    if (
      error instanceof Error &&
      error.message.startsWith(
        'Cannot delete a category that has active questions',
      )
    ) {
      throw new HttpException(
        { status: HttpStatus.BAD_REQUEST, error: error.message },
        HttpStatus.BAD_REQUEST,
        { cause: error },
      );
    }
    const message = error instanceof Error ? error.message : fallback;
    throw new HttpException(
      { status: HttpStatus.INTERNAL_SERVER_ERROR, error: message || fallback },
      HttpStatus.INTERNAL_SERVER_ERROR,
      { cause: error },
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // QUESTION CATEGORIES
  // ────────────────────────────────────────────────────────────────────────────

  async createCategory(adminId: string, body: CreateQuestionCategoryDto) {
    try {
      const course = await this.prisma.course.findUnique({
        where: { id: body.courseId },
      });
      if (!course) throw new Error('Course not found');

      const category = await this.prisma.questionCategory.create({
        data: { name: body.name, courseId: body.courseId },
      });

      return {
        message: 'Category created successfully',
        statusCode: 200,
        data: category,
      };
    } catch (error) {
      this.throwQuestionCategoryError(error, 'Failed to create category');
    }
  }

  async getCategoriesByCourse(courseId: string) {
    try {
      const categories = await this.prisma.questionCategory.findMany({
        where: { courseId },
        orderBy: { name: 'asc' },
      });
      return {
        message: 'Categories fetched successfully',
        statusCode: 200,
        data: categories,
      };
    } catch (error) {
      this.throwQuestionCategoryError(error, 'Failed to fetch categories');
    }
  }

  async updateCategory(categoryId: string, body: UpdateQuestionCategoryDto) {
    try {
      const category = await this.prisma.questionCategory.update({
        where: { id: categoryId },
        data: { name: body.name },
      });
      return {
        message: 'Category updated successfully',
        statusCode: 200,
        data: category,
      };
    } catch (error) {
      this.throwQuestionCategoryError(error, 'Failed to update category');
    }
  }

  async deleteCategory(categoryId: string) {
    try {
      const activeQuestions = await this.prisma.question.count({
        where: { categoryId, isActive: true },
      });
      if (activeQuestions > 0)
        throw new Error(
          'Cannot delete a category that has active questions. Deactivate the questions first.',
        );

      await this.prisma.questionCategory.delete({ where: { id: categoryId } });
      return {
        message: 'Category deleted successfully',
        statusCode: 200,
        data: {},
      };
    } catch (error) {
      this.throwQuestionCategoryError(error, 'Failed to delete category');
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // QUESTION BANK
  // ────────────────────────────────────────────────────────────────────────────

  async createQuestion(adminId: string, body: CreateQuestionDto) {
    try {
      const category = await this.prisma.questionCategory.findUnique({
        where: { id: body.categoryId },
      });
      if (!category) throw new Error('Category not found');
      if (category.courseId !== body.courseId)
        throw new Error('Category does not belong to the specified course');

      assertNoInlineBase64(body.text, 'text');

      const question = await this.prisma.question.create({
        data: {
          courseId: body.courseId,
          categoryId: body.categoryId,
          type: body.type,
          difficulty: body.difficulty,
          text: body.text,
          imageUrl: body.imageUrl ?? null,
          content: body.content,
          maxMarks: body.maxMarks,
        },
      });

      return {
        message: 'Question created successfully',
        statusCode: 200,
        data: question,
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to create question');
    }
  }

  async getQuestions(
    courseId: string,
    filters: {
      categoryId?: string;
      difficulty?: QuestionDifficulty;
      type?: QuestionType;
      isActive?: boolean;
    },
  ) {
    try {
      const questions = await this.prisma.question.findMany({
        where: {
          courseId,
          ...(filters.categoryId && { categoryId: filters.categoryId }),
          ...(filters.difficulty && { difficulty: filters.difficulty }),
          ...(filters.type && { type: filters.type }),
          ...(filters.isActive !== undefined && { isActive: filters.isActive }),
        },
        include: { category: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return {
        message: 'Questions fetched successfully',
        statusCode: 200,
        data: questions,
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to fetch questions');
    }
  }

  async getQuestionById(questionId: string) {
    try {
      const question = await this.prisma.question.findUnique({
        where: { id: questionId },
        include: { category: true },
      });
      if (!question) throw new Error('Question not found');
      return {
        message: 'Question fetched successfully',
        statusCode: 200,
        data: question,
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to fetch question');
    }
  }

  async updateQuestion(questionId: string, body: UpdateQuestionDto) {
    try {
      if (body.text !== undefined) assertNoInlineBase64(body.text, 'text');

      const question = await this.prisma.question.update({
        where: { id: questionId },
        data: {
          ...(body.categoryId && { categoryId: body.categoryId }),
          ...(body.type && { type: body.type }),
          ...(body.difficulty && { difficulty: body.difficulty }),
          ...(body.text && { text: body.text }),
          ...(body.imageUrl !== undefined && { imageUrl: body.imageUrl }),
          ...(body.content && { content: body.content }),
          ...(body.maxMarks !== undefined && { maxMarks: body.maxMarks }),
          ...(body.isActive !== undefined && { isActive: body.isActive }),
        },
      });
      return {
        message: 'Question updated successfully',
        statusCode: 200,
        data: question,
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to update question');
    }
  }

  async deleteQuestion(questionId: string, permanent: boolean) {
    try {
      const question = await this.prisma.question.findUnique({
        where: { id: questionId },
      });
      if (!question) throw new Error('Question not found');

      if (permanent) {
        // Block permanent delete if the question has been used in any finalized attempt
        const usedInAttempt = await this.prisma.attemptQuestionSnapshot.count({
          where: { questionId },
        });
        if (usedInAttempt > 0)
          throw new Error(
            'This question has been used in student attempts and cannot be permanently deleted. Deactivate it instead.',
          );

        // Remove from all assessment rosters first (FK constraint)
        await this.prisma.assessmentQuestion.deleteMany({
          where: { questionId },
        });
        await this.prisma.question.delete({ where: { id: questionId } });
        return {
          message: 'Question permanently deleted',
          statusCode: 200,
          data: {},
        };
      } else {
        const updated = await this.prisma.question.update({
          where: { id: questionId },
          data: { isActive: false },
        });
        // Remove from any inactive assessment rosters
        await this.prisma.assessmentQuestion.deleteMany({
          where: { questionId, assessment: { isActive: false } },
        });
        return {
          message: 'Question deactivated successfully',
          statusCode: 200,
          data: updated,
        };
      }
    } catch (error) {
      this.throwMapped(error, 'Failed to delete question');
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ASSESSMENT MANAGEMENT (ADMIN)
  // ────────────────────────────────────────────────────────────────────────────

  async createAssessment(adminId: string, body: CreateAssessmentDto) {
    try {
      const course = await this.prisma.course.findUnique({
        where: { id: body.courseId },
      });
      if (!course) throw new Error('Course not found');
      await assertImportedCourseTreeLocked(
        this.prisma,
        {
          courseId: body.courseId,
        },
        { deliveryMode: course.deliveryMode },
      );

      if (body.mode === AssessmentMode.AUTOMATIC && !body.autoConfig)
        throw new Error('autoConfig is required for AUTOMATIC mode');

      if (body.description)
        assertNoInlineBase64(body.description, 'description');

      const assessment = await this.prisma.assessment.create({
        data: {
          courseId: body.courseId,
          title: body.title,
          description: body.description ?? null,
          mode: body.mode,
          passingPercentage: body.passingPercentage,
          timeLimitMinutes: body.timeLimitMinutes ?? null,
          maxAttempts: body.maxAttempts ?? null,
          autoConfig: body.autoConfig ? (body.autoConfig as any) : null,
          createdByAdminId: adminId,
        },
      });

      return {
        message: 'Assessment created successfully',
        statusCode: 200,
        data: assessment,
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to create assessment');
    }
  }

  async updateAssessment(assessmentId: string, body: UpdateAssessmentDto) {
    try {
      const existing = await this.prisma.assessment.findUnique({
        where: { id: assessmentId },
        include: { course: { select: { deliveryMode: true } } },
      });
      if (!existing) throw new Error('Assessment not found');
      await assertImportedCourseTreeLocked(
        this.prisma,
        { courseId: existing.courseId },
        { deliveryMode: existing.course.deliveryMode },
      );

      if (body.description !== undefined) {
        assertNoInlineBase64(body.description, 'description');
      }

      const assessment = await this.prisma.assessment.update({
        where: { id: assessmentId },
        data: {
          ...(body.title && { title: body.title }),
          ...(body.description !== undefined && {
            description: body.description,
          }),
          ...(body.passingPercentage !== undefined && {
            passingPercentage: body.passingPercentage,
          }),
          ...(body.timeLimitMinutes !== undefined && {
            timeLimitMinutes: body.timeLimitMinutes,
          }),
          ...(body.maxAttempts !== undefined && {
            maxAttempts: body.maxAttempts,
          }),
          ...(body.autoConfig !== undefined && {
            autoConfig: body.autoConfig as any,
          }),
        },
      });
      return {
        message: 'Assessment updated successfully',
        statusCode: 200,
        data: assessment,
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to update assessment');
    }
  }

  async activateAssessment(assessmentId: string, adminId?: string) {
    try {
      const assessment = await this.prisma.assessment.findUnique({
        where: { id: assessmentId },
        include: {
          assessmentQuestions: true,
          course: { select: { deliveryMode: true } },
        },
      });
      if (!assessment) throw new Error('Assessment not found');
      await assertImportedCourseTreeLocked(
        this.prisma,
        { courseId: assessment.courseId },
        { deliveryMode: assessment.course.deliveryMode },
      );

      if (
        assessment.mode === AssessmentMode.MANUAL &&
        assessment.assessmentQuestions.length === 0
      )
        throw new Error(
          'Cannot activate a MANUAL assessment with no questions. Add questions first.',
        );

      if (
        assessment.mode === AssessmentMode.AUTOMATIC &&
        !assessment.autoConfig
      )
        throw new Error(
          'Cannot activate an AUTOMATIC assessment without autoConfig.',
        );

      // A course has one active assessment. Activating this one replaces
      // whichever was live, in one batch. Learners mid-attempt on the replaced
      // one can still submit it: submit does not check isActive.
      const othersActive = {
        courseId: assessment.courseId,
        isActive: true,
        id: { not: assessmentId },
      };
      const replaced = await this.prisma.assessment.findMany({
        where: othersActive,
        select: { id: true, title: true },
      });
      const [, activated] = await this.prisma.$transaction([
        this.prisma.assessment.updateMany({
          where: othersActive,
          data: { isActive: false },
        }),
        this.prisma.assessment.update({
          where: { id: assessmentId },
          data: { isActive: true },
        }),
      ]);
      // An active assessment becomes a certificate requirement for learners
      // who have not been issued one yet, so who switched it on is recorded.
      if (adminId) {
        for (const prev of replaced) {
          await this.courseVersionService.writeAudit({
            adminId,
            action: 'DEACTIVATE_ASSESSMENT',
            targetType: 'Assessment',
            targetId: prev.id,
            courseId: assessment.courseId,
            metadata: { title: prev.title, replacedBy: assessmentId },
          });
        }
        if (!assessment.isActive) {
          await this.courseVersionService.writeAudit({
            adminId,
            action: 'ACTIVATE_ASSESSMENT',
            targetType: 'Assessment',
            targetId: assessmentId,
            courseId: assessment.courseId,
            metadata: {
              title: assessment.title,
              mode: assessment.mode,
              replaced: replaced.map((r) => r.id),
            },
          });
        }
      }

      return {
        message: replaced.length
          ? `Assessment activated. "${replaced
              .map((r) => r.title)
              .join('", "')}" is no longer active.`
          : 'Assessment activated successfully',
        statusCode: 200,
        data: { ...activated, replaced },
      };
    } catch (error) {
      // Two admins activating different assessments in the same course at
      // once: the partial unique index lets one through.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new HttpException(
          {
            status: HttpStatus.CONFLICT,
            error:
              'Another assessment in this course was activated at the same time. Refresh and try again.',
          },
          HttpStatus.CONFLICT,
          { cause: error },
        );
      }
      this.throwMapped(error, 'Failed to activate assessment');
    }
  }

  async deactivateAssessment(assessmentId: string, adminId?: string) {
    try {
      const existing = await this.prisma.assessment.findUnique({
        where: { id: assessmentId },
        include: { course: { select: { deliveryMode: true } } },
      });
      if (!existing) throw new Error('Assessment not found');
      await assertImportedCourseTreeLocked(
        this.prisma,
        { courseId: existing.courseId },
        { deliveryMode: existing.course.deliveryMode },
      );

      const assessment = await this.prisma.assessment.update({
        where: { id: assessmentId },
        data: { isActive: false },
      });
      if (adminId && existing.isActive) {
        await this.courseVersionService.writeAudit({
          adminId,
          action: 'DEACTIVATE_ASSESSMENT',
          targetType: 'Assessment',
          targetId: assessmentId,
          courseId: existing.courseId,
          metadata: { title: existing.title },
        });
      }
      return {
        message: 'Assessment deactivated successfully',
        statusCode: 200,
        data: assessment,
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to deactivate assessment');
    }
  }

  async getAssessmentsByCourse(courseId: string) {
    try {
      const assessments = await this.prisma.assessment.findMany({
        where: { courseId },
        include: {
          _count: { select: { assessmentQuestions: true, attempts: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return {
        message: 'Assessments fetched successfully',
        statusCode: 200,
        data: assessments,
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to fetch assessments');
    }
  }

  async getAssessmentById(assessmentId: string) {
    try {
      const assessment = await this.prisma.assessment.findUnique({
        where: { id: assessmentId },
        include: {
          assessmentQuestions: {
            include: { question: true },
            orderBy: { orderIndex: 'asc' },
          },
          _count: { select: { attempts: true } },
        },
      });
      if (!assessment) throw new Error('Assessment not found');
      return {
        message: 'Assessment fetched successfully',
        statusCode: 200,
        data: assessment,
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to fetch assessment');
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // MANUAL ASSESSMENT QUESTION ROSTER (ADMIN)
  // ────────────────────────────────────────────────────────────────────────────

  async addQuestionToAssessment(
    assessmentId: string,
    body: AddAssessmentQuestionDto,
  ) {
    try {
      const assessment = await this.prisma.assessment.findUnique({
        where: { id: assessmentId },
      });
      if (!assessment) throw new Error('Assessment not found');
      if (assessment.mode !== AssessmentMode.MANUAL)
        throw new Error(
          'Questions can only be added manually to MANUAL mode assessments',
        );

      const question = await this.prisma.question.findUnique({
        where: { id: body.questionId },
      });
      if (!question) throw new Error('Question not found');
      if (question.courseId !== assessment.courseId)
        throw new Error(
          'Question does not belong to the same course as this assessment',
        );
      if (!question.isActive)
        throw new Error('Cannot add an inactive question to an assessment');

      const aq = await this.prisma.assessmentQuestion.create({
        data: {
          assessmentId,
          questionId: body.questionId,
          orderIndex: body.orderIndex ?? 0,
          marksOverride: body.marksOverride ?? null,
        },
        include: { question: true },
      });

      return {
        message: 'Question added to assessment',
        statusCode: 200,
        data: aq,
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to add question');
    }
  }

  async removeQuestionFromAssessment(assessmentId: string, questionId: string) {
    try {
      const hasAttempts = await this.prisma.assessmentAttempt.count({
        where: { assessmentId, status: AssessmentAttemptStatus.FINALIZED },
      });
      if (hasAttempts > 0)
        throw new Error(
          'Cannot remove questions from an assessment that has finalized attempts',
        );

      await this.prisma.assessmentQuestion.deleteMany({
        where: { assessmentId, questionId },
      });
      return {
        message: 'Question removed from assessment',
        statusCode: 200,
        data: {},
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to remove question');
    }
  }

  async reorderAssessmentQuestions(
    assessmentId: string,
    body: ReorderAssessmentQuestionsDto,
  ) {
    try {
      await this.prisma.$transaction(
        body.questions.map((q) =>
          this.prisma.assessmentQuestion.updateMany({
            where: { assessmentId, questionId: q.questionId },
            data: { orderIndex: q.orderIndex },
          }),
        ),
      );
      return {
        message: 'Questions reordered successfully',
        statusCode: 200,
        data: {},
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to reorder questions');
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STUDENT — ASSESSMENT FLOW
  // ────────────────────────────────────────────────────────────────────────────

  async getActiveAssessmentForStudent(userId: string, courseId: string) {
    try {
      const enrollment = await this.prisma.userCourse.findFirst({
        where: { userId, courseId, isActive: true },
      });
      if (!enrollment) throw new Error('You are not enrolled in this course');
      await this._assertNotExpired(userId, courseId);

      const assessments = await this.prisma.assessment.findMany({
        where: { courseId, isActive: true },
        select: {
          id: true,
          title: true,
          description: true,
          mode: true,
          passingPercentage: true,
          timeLimitMinutes: true,
          maxAttempts: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      const isEligible = await this._isCourseContentCompleted(userId, courseId);

      const result = await Promise.all(
        assessments.map(async (assessment) => {
          await this._expireStaleAttempts(userId, assessment.id);

          const attempts = await this.prisma.assessmentAttempt.findMany({
            where: { userId, assessmentId: assessment.id },
            select: {
              id: true,
              status: true,
              startedAt: true,
              submittedAt: true,
              finalizedAt: true,
              marksObtained: true,
              totalMarks: true,
              percentage: true,
              isPassed: true,
              snapshotTimeLimitMin: true,
              snapshotMaxAttempts: true,
            },
            orderBy: { startedAt: 'desc' },
          });
          const maxAttempts = CourseAssessmentService.effectiveMaxAttempts(
            assessment.maxAttempts,
            attempts.map((a) => a.snapshotMaxAttempts),
          );

          const attemptsWithMeta = attempts.map((a) => {
            const isExpired = a.status === AssessmentAttemptStatus.EXPIRED;
            const timeInfo =
              a.status === AssessmentAttemptStatus.IN_PROGRESS
                ? this._computeTimeInfo({
                    startedAt: a.startedAt,
                    snapshotTimeLimitMin: a.snapshotTimeLimitMin,
                  })
                : null;
            return { ...a, isExpired, timeInfo };
          });

          const inProgressAttempt = attemptsWithMeta.find(
            (a) => a.status === AssessmentAttemptStatus.IN_PROGRESS,
          );
          const remainingAttempts =
            maxAttempts === null
              ? null
              : Math.max(0, maxAttempts - attempts.length);
          const canStart =
            isEligible &&
            !inProgressAttempt &&
            (maxAttempts === null || remainingAttempts! > 0);

          return {
            assessment: { ...assessment, maxAttempts },
            isEligible,
            remainingAttempts,
            canStart,
            inProgressAttemptId: inProgressAttempt?.id ?? null,
            attempts: attemptsWithMeta,
          };
        }),
      );

      return {
        message: 'Assessments fetched successfully',
        statusCode: 200,
        data: result,
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to fetch assessments');
    }
  }

  /**
   * Courses where this learner can see an assessment: active enrolment, access
   * not expired, and an active assessment. Drives the student nav in two
   * queries instead of one availability call per enrolled course.
   */
  async getStudentAssessmentCourseIds(userId: string) {
    try {
      const enrollments = await this.prisma.userCourse.findMany({
        where: {
          userId,
          isActive: true,
          course: { courseAssessments: { some: { isActive: true } } },
        },
        select: { courseId: true, course: { select: { validityDays: true } } },
      });
      const completions = enrollments.length
        ? await this.prisma.courseCompletion.findMany({
            where: {
              userId,
              courseId: { in: enrollments.map((e) => e.courseId) },
              courseCompletedAt: { not: null },
            },
            select: {
              courseId: true,
              courseCompletedAt: true,
              validityDaysAtCompletion: true,
            },
          })
        : [];
      const completionByCourse = new Map(
        completions.map((c) => [c.courseId, c]),
      );

      // Same rule as _assertNotExpired.
      const now = new Date();
      const courseIds = enrollments
        .filter((e) => {
          const c = completionByCourse.get(e.courseId);
          if (!c?.courseCompletedAt) return true;
          return (
            now <=
            courseAccessExpiresAt(
              c.courseCompletedAt,
              c.validityDaysAtCompletion,
              e.course.validityDays,
            )
          );
        })
        .map((e) => e.courseId);

      return {
        message: 'Assessment courses fetched',
        statusCode: 200,
        data: { courseIds },
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to fetch assessment courses');
    }
  }

  async startAttempt(userId: string, body: StartAttemptDto) {
    try {
      const { assessmentId } = body;

      // 1. Find the assessment
      const assessment = await this.prisma.assessment.findUnique({
        where: { id: assessmentId },
        include: {
          assessmentQuestions: {
            include: { question: true },
            orderBy: { orderIndex: 'asc' },
          },
        },
      });
      if (!assessment) throw new Error('Assessment not found');
      if (!assessment.isActive)
        throw new Error('This assessment is not currently active');

      const courseId = assessment.courseId;

      // 2. Enrollment check
      const enrollment = await this.prisma.userCourse.findFirst({
        where: { userId, courseId, isActive: true },
      });
      if (!enrollment) throw new Error('You are not enrolled in this course');
      await this._assertNotExpired(userId, courseId);

      // 3. Course content completion check
      const isComplete = await this._isCourseContentCompleted(userId, courseId);
      if (!isComplete)
        throw new Error(
          'You must complete all course content before attempting the assessment',
        );

      // 4. Attempt limit check, against the limit this learner was granted
      const previousAttempts = await this.prisma.assessmentAttempt.findMany({
        where: { userId, assessmentId: assessment.id },
        select: { snapshotMaxAttempts: true },
      });
      const maxAttempts = CourseAssessmentService.effectiveMaxAttempts(
        assessment.maxAttempts,
        previousAttempts.map((a) => a.snapshotMaxAttempts),
      );
      if (maxAttempts !== null && previousAttempts.length >= maxAttempts)
        throw new Error(
          `Maximum attempts (${maxAttempts}) reached for this assessment`,
        );

      await this._expireStaleAttempts(userId, assessment.id);

      // 5. No existing IN_PROGRESS attempt
      const inProgress = await this.prisma.assessmentAttempt.findFirst({
        where: {
          userId,
          assessmentId: assessment.id,
          status: AssessmentAttemptStatus.IN_PROGRESS,
        },
      });
      if (inProgress)
        throw new Error(
          'You already have an in-progress attempt. Complete or submit it first.',
        );

      // 6. Build question list
      const selectedQuestions = await this._buildQuestionList(assessment);

      // 7. Calculate totalMarks
      const totalMarks = selectedQuestions.reduce(
        (sum, q) => sum + q.effectiveMarks,
        0,
      );

      // 8. Create attempt + snapshots in one statement (avoids interactive $transaction issues on
      // Neon / poolers where "Transaction already closed" can occur on multi-step interactive txs).
      const attempt = await this.prisma.assessmentAttempt.create({
        data: {
          assessmentId: assessment.id,
          userId,
          snapshotTitle: assessment.title,
          snapshotPassingPct: assessment.passingPercentage,
          snapshotMaxAttempts: assessment.maxAttempts,
          snapshotTimeLimitMin: assessment.timeLimitMinutes,
          totalMarks,
          questionSnapshots: {
            createMany: {
              data: selectedQuestions.map((q, idx) => ({
                questionId: q.id,
                orderIndex: idx,
                questionType: q.type,
                questionText: q.text,
                questionImageUrl: q.imageUrl ?? null,
                questionContent: q.content as any,
                maxMarks: q.effectiveMarks,
              })),
            },
          },
        },
        include: { questionSnapshots: { orderBy: { orderIndex: 'asc' } } },
      });

      // 9. Strip correct answers before returning
      const sanitized = this._stripCorrectAnswers(attempt);
      const timeInfo = this._computeTimeInfo({
        startedAt: attempt.startedAt,
        snapshotTimeLimitMin: attempt.snapshotTimeLimitMin,
      });
      return {
        message: 'Attempt started successfully',
        statusCode: 200,
        data: { ...sanitized, timeInfo },
      };
    } catch (error) {
      // Two Start clicks at once: the partial unique index lets one through.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new HttpException(
          {
            status: HttpStatus.CONFLICT,
            error:
              'You already have an in-progress attempt. Complete or submit it first.',
          },
          HttpStatus.CONFLICT,
          { cause: error },
        );
      }
      this.throwMapped(error, 'Failed to start attempt');
    }
  }

  async getAttempt(userId: string, attemptId: string) {
    try {
      const attempt = await this.prisma.assessmentAttempt.findUnique({
        where: { id: attemptId },
        include: { questionSnapshots: { orderBy: { orderIndex: 'asc' } } },
      });
      if (!attempt) throw new Error('Attempt not found');
      if (attempt.userId !== userId)
        throw new Error('You do not have access to this attempt');

      await this._expireStaleAttempts(userId, attempt.assessmentId);

      const fresh = await this.prisma.assessmentAttempt.findUnique({
        where: { id: attemptId },
        include: { questionSnapshots: { orderBy: { orderIndex: 'asc' } } },
      });
      if (!fresh) throw new Error('Attempt not found');

      const sanitized = this._stripCorrectAnswers(fresh);
      const timeInfo = this._computeTimeInfo({
        startedAt: fresh.startedAt,
        snapshotTimeLimitMin: fresh.snapshotTimeLimitMin,
      });
      return {
        message: 'Attempt fetched successfully',
        statusCode: 200,
        data: { ...sanitized, timeInfo },
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to fetch attempt');
    }
  }

  /**
   * Saves answers while the attempt is in progress, without grading them.
   * The FE calls this as the learner works, so a refresh, crash or closed tab
   * loses nothing, and submit has little left to send.
   */
  async saveAnswers(
    userId: string,
    attemptId: string,
    body: SaveAttemptAnswersDto,
  ) {
    try {
      const attempt = await this.prisma.assessmentAttempt.findUnique({
        where: { id: attemptId },
        select: {
          userId: true,
          status: true,
          startedAt: true,
          snapshotTimeLimitMin: true,
          questionSnapshots: { select: { id: true } },
        },
      });
      if (!attempt) throw new Error('Attempt not found');
      if (attempt.userId !== userId)
        throw new Error('You do not have access to this attempt');
      if (attempt.status !== AssessmentAttemptStatus.IN_PROGRESS)
        throw new Error('This attempt is not in progress');
      if (this._isPastDeadline(attempt)) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Time limit exceeded. Your assessment time has expired.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const ownIds = new Set(attempt.questionSnapshots.map((s) => s.id));
      if (body.answers.some((a) => !ownIds.has(a.snapshotId)))
        throw new Error('An answer does not belong to this attempt');

      // The status filter makes each write a no-op once the attempt has been
      // submitted, so a save racing the submit can't change graded answers.
      await this.prisma.$transaction(
        body.answers.map((a) =>
          this.prisma.attemptQuestionSnapshot.updateMany({
            where: {
              id: a.snapshotId,
              attempt: { status: AssessmentAttemptStatus.IN_PROGRESS },
            },
            data: {
              studentAnswer: a.studentAnswer as Prisma.InputJsonValue,
              isAnswered: true,
            },
          }),
        ),
      );

      return {
        message: 'Answers saved',
        statusCode: 200,
        data: { saved: body.answers.length, savedAt: new Date() },
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to save answers');
    }
  }

  async submitAttempt(
    userId: string,
    attemptId: string,
    body: SubmitAttemptDto,
  ) {
    try {
      const owner = await this.prisma.assessmentAttempt.findUnique({
        where: { id: attemptId },
        select: { userId: true, assessmentId: true },
      });
      if (!owner) throw new Error('Attempt not found');
      if (owner.userId !== userId)
        throw new Error('You do not have access to this attempt');

      // Past the deadline this grades whatever was saved in time.
      await this._expireStaleAttempts(userId, owner.assessmentId);
      const attempt = await this.prisma.assessmentAttempt.findUnique({
        where: { id: attemptId },
        include: { questionSnapshots: true },
      });
      if (!attempt) throw new Error('Attempt not found');

      if (attempt.status === AssessmentAttemptStatus.EXPIRED) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error:
              'Time limit exceeded. Your assessment time has expired and this attempt can no longer be submitted.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      if (attempt.status !== AssessmentAttemptStatus.IN_PROGRESS) {
        // Already submitted: a double click, or time ran out and the saved
        // answers were graded. Return the result rather than an error.
        return {
          message: 'This attempt has already been submitted',
          statusCode: 200,
          data: await this.prisma.assessmentAttempt.findUnique({
            where: { id: attemptId },
          }),
        };
      }

      if (this._isPastDeadline(attempt)) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Time limit exceeded. Your assessment time has expired.',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const overrides = new Map<string, unknown>(
        (body.answers ?? []).map((a) => [a.snapshotId, a.studentAnswer]),
      );
      const answeredCount = attempt.questionSnapshots.filter(
        (s) => (overrides.get(s.id) ?? s.studentAnswer ?? null) !== null,
      ).length;
      if (answeredCount === 0)
        throw new Error('Answer at least one question before submitting');

      const updated = await this._gradeAndSubmit(
        attempt,
        overrides,
        new Date(),
      );
      if (!updated) {
        // Another submit of the same attempt got there first.
        const current = await this.prisma.assessmentAttempt.findUnique({
          where: { id: attemptId },
        });
        return {
          message: 'This attempt has already been submitted',
          statusCode: 200,
          data: current,
        };
      }

      return {
        message: 'Assessment submitted successfully',
        statusCode: 200,
        data: updated,
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to submit attempt');
    }
  }

  /**
   * Grades an in-progress attempt from its saved answers, with `overrides`
   * taking precedence, and moves it to AUTO_GRADED, or to SUBMITTED when it
   * has written answers for an admin to mark. Returns null if another request
   * submitted it first.
   */
  private async _gradeAndSubmit(
    attempt: Prisma.AssessmentAttemptGetPayload<{
      include: { questionSnapshots: true };
    }>,
    overrides: Map<string, unknown>,
    submittedAt: Date,
  ) {
    const graded = attempt.questionSnapshots.map((snapshot) => {
      const studentAnswer =
        (overrides.has(snapshot.id)
          ? overrides.get(snapshot.id)
          : snapshot.studentAnswer) ?? null;
      const systemScore =
        studentAnswer !== null
          ? this._calculateAutoScore(
              snapshot.questionType,
              snapshot.questionContent as any,
              studentAnswer,
              snapshot.maxMarks,
            )
          : null;
      return { snapshot, studentAnswer, systemScore };
    });

    const hasManualQuestions = graded.some(
      (g) =>
        g.studentAnswer !== null &&
        (g.snapshot.questionType === QuestionType.SHORT_ANSWER ||
          g.snapshot.questionType === QuestionType.LONG_ANSWER),
    );

    let newStatus: AssessmentAttemptStatus;
    let marksObtained: number | null = null;
    let percentage: number | null = null;
    let isPassed: boolean | null = null;

    if (!hasManualQuestions) {
      marksObtained = graded.reduce((sum, g) => sum + (g.systemScore ?? 0), 0);
      percentage =
        attempt.totalMarks && attempt.totalMarks > 0
          ? (marksObtained / attempt.totalMarks) * 100
          : 0;
      isPassed = percentage >= attempt.snapshotPassingPct;
      newStatus = AssessmentAttemptStatus.AUTO_GRADED;
    } else {
      newStatus = AssessmentAttemptStatus.SUBMITTED;
    }

    // Claim the attempt first. Only one request moves it out of IN_PROGRESS,
    // so completion, certificate and the admin notification happen once.
    const claim = await this.prisma.assessmentAttempt.updateMany({
      where: { id: attempt.id, status: AssessmentAttemptStatus.IN_PROGRESS },
      data: {
        status: newStatus,
        submittedAt,
        ...(marksObtained !== null && { marksObtained }),
        ...(percentage !== null && { percentage }),
        ...(isPassed !== null && { isPassed }),
      },
    });
    if (claim.count === 0) return null;

    // One batched (non-interactive) transaction: interactive ones are prone
    // to "Transaction already closed" on the Neon pooler.
    try {
      await this.prisma.$transaction(
        graded.map((g) =>
          this.prisma.attemptQuestionSnapshot.update({
            where: { id: g.snapshot.id },
            data: {
              ...(g.studentAnswer !== null && {
                studentAnswer: g.studentAnswer as Prisma.InputJsonValue,
              }),
              isAnswered: g.studentAnswer !== null,
              systemScore: g.systemScore,
            },
          }),
        ),
      );
    } catch (error) {
      // Put the attempt back so it can be submitted again.
      await this.prisma.assessmentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: AssessmentAttemptStatus.IN_PROGRESS,
          submittedAt: null,
          marksObtained: null,
          percentage: null,
          isPassed: null,
        },
      });
      throw error;
    }

    const updated = await this.prisma.assessmentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    await this._afterSubmit(attempt.userId, updated);
    return updated;
  }

  /** Completion + certificate on an auto-graded pass, then tell the admin. */
  private async _afterSubmit(
    userId: string,
    attempt: Prisma.AssessmentAttemptGetPayload<object>,
  ) {
    const [assessment, student] = await Promise.all([
      this.prisma.assessment.findUnique({
        where: { id: attempt.assessmentId },
        select: {
          id: true,
          title: true,
          courseId: true,
          createdByAdminId: true,
        },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      }),
    ]);
    if (!assessment) return;

    if (
      attempt.status === AssessmentAttemptStatus.AUTO_GRADED &&
      attempt.isPassed
    ) {
      await this._upsertCourseCompletion(
        userId,
        assessment.courseId,
        attempt.id,
        attempt.percentage!,
      );
      await this.certificateService.tryIssueCertificate(
        userId,
        assessment.courseId,
      );
    }

    if (!student) return;
    const studentName = `${student.firstName} ${student.lastName}`.trim();
    await this.notificationService.createNotification({
      userId: assessment.createdByAdminId,
      emailCcAddresses: [ADMIN_EMAIL],
      type: NotificationType.ASSESSMENT_SUBMITTED,
      message: `A student has submitted the assessment: ${attempt.snapshotTitle}`,
      payload: {
        assessmentId: assessment.id,
        assessmentTitle: assessment.title,
        attemptId: attempt.id,
        studentFirstName: student.firstName,
        studentLastName: student.lastName,
      },
      groupKey: `assessment-submitted:${assessment.id}`,
      dedupeKey: `submitted:${attempt.id}`,
      referenceId: attempt.id,
      commenterId: userId,
      email: {
        excludeUserId: userId, // never the student here; recipient is the admin
        build: (r) => ({
          kind: 'ASSESSMENT_SUBMITTED',
          to: r.email,
          userId: r.id,
          recipientFirstName: r.firstName,
          studentName,
          assessmentTitle: assessment.title,
          attemptId: attempt.id,
        }),
      },
    });
  }

  async getStudentAttemptHistory(userId: string, courseId: string) {
    try {
      const assessmentIds = (
        await this.prisma.assessment.findMany({
          where: { courseId },
          select: { id: true },
        })
      ).map((a) => a.id);

      const attempts = await this.prisma.assessmentAttempt.findMany({
        where: { userId, assessmentId: { in: assessmentIds } },
        orderBy: { startedAt: 'desc' },
        include: {
          questionSnapshots: {
            select: {
              id: true,
              questionType: true,
              questionText: true,
              questionImageUrl: true,
              maxMarks: true,
              studentAnswer: true,
              isAnswered: true,
              isLocked: true,
              systemScore: true,
              finalScore: true,
              adminFeedback: true,
              orderIndex: true,
            },
          },
        },
      });

      return {
        message: 'Attempt history fetched',
        statusCode: 200,
        data: attempts,
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to fetch history');
    }
  }

  async getStudentCompletion(userId: string, courseId: string) {
    try {
      const [completion, course, requiresAssessmentPass] = await Promise.all([
        this.prisma.courseCompletion.findUnique({
          where: { userId_courseId: { userId, courseId } },
          include: {
            bestAttempt: {
              select: {
                id: true,
                percentage: true,
                isPassed: true,
                finalizedAt: true,
                submittedAt: true,
              },
            },
          },
        }),
        this.prisma.course.findUnique({
          where: { id: courseId },
          select: { certificateIssueMode: true },
        }),
        this.certificateService.courseRequiresAssessmentPass(courseId),
      ]);
      return {
        message: 'Completion fetched',
        statusCode: 200,
        data: completion
          ? {
              ...completion,
              certificateIssueMode: course?.certificateIssueMode ?? 'NONE',
              requiresAssessmentPass,
            }
          : course
            ? {
                certificateIssueMode: course.certificateIssueMode,
                requiresAssessmentPass,
              }
            : null,
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to fetch completion');
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ADMIN — GRADING
  // ────────────────────────────────────────────────────────────────────────────

  async getAdminAttempts(
    courseId: string,
    filters: { status?: AssessmentAttemptStatus; userId?: string },
  ) {
    try {
      const assessmentIds = (
        await this.prisma.assessment.findMany({
          where: { courseId },
          select: { id: true },
        })
      ).map((a) => a.id);

      const attempts = await this.prisma.assessmentAttempt.findMany({
        where: {
          assessmentId: { in: assessmentIds },
          ...(filters.status && { status: filters.status }),
          ...(filters.userId && { userId: filters.userId }),
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          assessment: { select: { id: true, title: true } },
        },
        orderBy: { submittedAt: 'desc' },
      });

      return { message: 'Attempts fetched', statusCode: 200, data: attempts };
    } catch (error) {
      this.throwMapped(error, 'Failed to fetch attempts');
    }
  }

  async getAdminAttemptDetail(attemptId: string) {
    try {
      const attempt = await this.prisma.assessmentAttempt.findUnique({
        where: { id: attemptId },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          questionSnapshots: { orderBy: { orderIndex: 'asc' } },
        },
      });
      if (!attempt) throw new Error('Attempt not found');
      await this._expireStaleAttempts(attempt.userId, attempt.assessmentId);
      const fresh = await this.prisma.assessmentAttempt.findUnique({
        where: { id: attemptId },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          questionSnapshots: { orderBy: { orderIndex: 'asc' } },
        },
      });
      if (!fresh) throw new Error('Attempt not found');
      return { message: 'Attempt fetched', statusCode: 200, data: fresh };
    } catch (error) {
      this.throwMapped(error, 'Failed to fetch attempt');
    }
  }

  async gradeAttempt(attemptId: string, body: GradeAttemptDto) {
    try {
      const attempt = await this.prisma.assessmentAttempt.findUnique({
        where: { id: attemptId },
        include: { questionSnapshots: true },
      });
      if (!attempt) throw new Error('Attempt not found');
      if (
        attempt.status !== AssessmentAttemptStatus.SUBMITTED &&
        attempt.status !== AssessmentAttemptStatus.AUTO_GRADED &&
        attempt.status !== AssessmentAttemptStatus.GRADED
      )
        throw new Error('This attempt is not available for grading');

      // Validate scores don't exceed maxMarks
      for (const score of body.scores) {
        const snapshot = attempt.questionSnapshots.find(
          (s) => s.id === score.snapshotId,
        );
        if (!snapshot)
          throw new Error(
            `Snapshot ${score.snapshotId} not found in this attempt`,
          );
        if (score.adminScore > snapshot.maxMarks)
          throw new Error(
            `Score ${score.adminScore} exceeds max marks ${snapshot.maxMarks} for question ${score.snapshotId}`,
          );
      }

      await this.prisma.$transaction([
        ...body.scores.map((score) =>
          this.prisma.attemptQuestionSnapshot.update({
            where: { id: score.snapshotId },
            data: {
              adminScore: score.adminScore,
              adminFeedback: score.adminFeedback ?? null,
              gradedAt: new Date(),
            },
          }),
        ),
        this.prisma.assessmentAttempt.update({
          where: { id: attemptId },
          data: { status: AssessmentAttemptStatus.GRADED },
        }),
      ]);

      // Recalculate running totals (preview — not finalized)
      const updatedSnapshots =
        await this.prisma.attemptQuestionSnapshot.findMany({
          where: { attemptId },
        });
      const previewMarks = updatedSnapshots.reduce(
        (sum, s) => sum + (s.adminScore ?? s.systemScore ?? 0),
        0,
      );
      const previewPct =
        attempt.totalMarks && attempt.totalMarks > 0
          ? (previewMarks / attempt.totalMarks) * 100
          : 0;

      const updated = await this.prisma.assessmentAttempt.findUnique({
        where: { id: attemptId },
        include: { questionSnapshots: { orderBy: { orderIndex: 'asc' } } },
      });

      return {
        message: 'Grading saved. Call /finalize to publish the final grade.',
        statusCode: 200,
        data: { attempt: updated, previewMarks, previewPercentage: previewPct },
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to grade attempt');
    }
  }

  async finalizeGrade(adminId: string, attemptId: string) {
    try {
      const attempt = await this.prisma.assessmentAttempt.findUnique({
        where: { id: attemptId },
        include: { questionSnapshots: true, assessment: true },
      });
      if (!attempt) throw new Error('Attempt not found');
      if (
        attempt.status !== AssessmentAttemptStatus.GRADED &&
        attempt.status !== AssessmentAttemptStatus.AUTO_GRADED &&
        attempt.status !== AssessmentAttemptStatus.SUBMITTED
      )
        throw new Error('Attempt must be graded before it can be finalized');

      // Set finalScore = adminScore ?? systemScore for each snapshot
      const snapshotUpdates = attempt.questionSnapshots.map((s) =>
        this.prisma.attemptQuestionSnapshot.update({
          where: { id: s.id },
          data: { finalScore: s.adminScore ?? s.systemScore ?? 0 },
        }),
      );

      const marksObtained = attempt.questionSnapshots.reduce(
        (sum, s) => sum + (s.adminScore ?? s.systemScore ?? 0),
        0,
      );
      const percentage =
        attempt.totalMarks && attempt.totalMarks > 0
          ? (marksObtained / attempt.totalMarks) * 100
          : 0;
      const isPassed = percentage >= attempt.snapshotPassingPct;
      const finalizedAt = new Date();

      await this.prisma.$transaction([
        ...snapshotUpdates,
        this.prisma.assessmentAttempt.update({
          where: { id: attemptId },
          data: {
            status: AssessmentAttemptStatus.FINALIZED,
            marksObtained,
            percentage,
            isPassed,
            gradedAt: finalizedAt,
            finalizedAt,
          },
        }),
      ]);

      // Upsert CourseCompletion
      if (attempt.assessment && isPassed) {
        await this._upsertCourseCompletion(
          attempt.userId,
          attempt.assessment.courseId,
          attemptId,
          percentage,
        );
        await this.certificateService.tryIssueCertificate(
          attempt.userId,
          attempt.assessment.courseId,
        );
      }

      // Notify student. dedupeKey includes finalizedAt epoch so re-finalize
      // (which can produce a different grade) generates a fresh notification
      // rather than silently swallowing it.
      await this.notificationService.createNotification({
        userId: attempt.userId,
        emailCcAddresses: [ADMIN_EMAIL],
        type: NotificationType.ASSESSMENT_GRADED,
        message: `Your assessment "${
          attempt.snapshotTitle
        }" has been graded. You ${isPassed ? 'passed' : 'did not pass'}.`,
        payload: {
          assessmentId: attempt.assessmentId,
          assessmentTitle: attempt.snapshotTitle,
          attemptId,
          passed: isPassed,
          scorePct: percentage,
        },
        dedupeKey: `graded:${attemptId}:${finalizedAt.getTime()}`,
        referenceId: attemptId,
        commenterId: adminId,
        email: {
          excludeUserId: adminId, // recipient is the student, not the grading admin
          build: (r) => ({
            kind: 'ASSESSMENT_GRADED',
            to: r.email,
            userId: r.id,
            recipientFirstName: r.firstName,
            assessmentTitle: attempt.snapshotTitle,
            courseId: attempt.assessment?.courseId,
            passed: isPassed,
            scorePct: percentage,
          }),
        },
      });

      const finalized = await this.prisma.assessmentAttempt.findUnique({
        where: { id: attemptId },
        include: { questionSnapshots: { orderBy: { orderIndex: 'asc' } } },
      });

      return {
        message: 'Assessment finalized successfully',
        statusCode: 200,
        data: finalized,
      };
    } catch (error) {
      this.throwMapped(error, 'Failed to finalize grade');
    }
  }

  async setCertificate(
    adminId: string,
    userId: string,
    courseId: string,
    body: SetCertificateDto,
  ) {
    try {
      return this.certificateService.recordManualCertificate(
        userId,
        courseId,
        body.certificateUrl,
        adminId,
      );
    } catch (error) {
      this.throwMapped(error, 'Failed to set certificate');
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * The attempt limit for one learner: the larger of the current setting and
   * every limit their earlier attempts were started under (snapshotMaxAttempts).
   * Lowering maxAttempts therefore only affects learners who have not started
   * yet; anyone already granted more (or unlimited) keeps it. null = unlimited.
   */
  private static effectiveMaxAttempts(
    current: number | null,
    granted: Array<number | null>,
  ): number | null {
    if (current === null) return null;
    let max = current;
    for (const limit of granted) {
      if (limit === null) return null;
      max = Math.max(max, limit);
    }
    return max;
  }

  /**
   * Throws if the learner's post-completion access window has elapsed. Access
   * lasts course.validityDays days (default 365) from courseCompletedAt. No-op
   * if the course isn't completed yet. Keeps the student assessment flow in
   * step with the course-content access rule.
   */
  private async _assertNotExpired(
    userId: string,
    courseId: string,
  ): Promise<void> {
    const [completion, course] = await Promise.all([
      this.prisma.courseCompletion.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: { courseCompletedAt: true, validityDaysAtCompletion: true },
      }),
      this.prisma.course.findUnique({
        where: { id: courseId },
        select: { validityDays: true },
      }),
    ]);
    if (!completion?.courseCompletedAt) return;

    const expiresAt = courseAccessExpiresAt(
      completion.courseCompletedAt,
      completion.validityDaysAtCompletion,
      course?.validityDays,
    );
    if (new Date() > expiresAt) {
      // ForbiddenException (an HttpException) is re-thrown unchanged by
      // throwMapped, so this surfaces as a clean 403 — which the client uses to
      // distinguish "expired" from other assessment errors.
      throw new ForbiddenException({
        detail: `Your access to this course expired on ${
          expiresAt.toISOString().split('T')[0]
        }. Please contact your administrator to renew access.`,
      });
    }
  }

  private async _isCourseContentCompleted(
    userId: string,
    courseId: string,
  ): Promise<boolean> {
    // A recorded completion is final: content added to the course afterwards
    // must not shut someone who already finished out of the assessment.
    const completion = await this.prisma.courseCompletion.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { courseCompletedAt: true },
    });
    if (completion?.courseCompletedAt) return true;

    // Version-aware denominator: a learner pinned to a course version is judged
    // against that version's frozen section set, so adding sections after they
    // enrolled cannot un-complete them for the assessment gate. Unpinned
    // learners fall back to the live (active, non-archived) section set. Both
    // cases are resolved by countCompletionDenominator, which returns the frozen
    // section total and the exact section ids that count toward it.
    const { total: totalSections, liveSectionIds } =
      await this.courseVersionService.countCompletionDenominator(
        userId,
        courseId,
      );
    if (totalSections === 0) return true;

    // Count distinct progressed sections that still count toward the
    // denominator. Restricting to liveSectionIds also drops stale progress rows
    // (a section deleted/moved after completion) that would otherwise falsely
    // mark content complete. distinct guards against duplicate rows for a
    // section that moved chapters (unique key includes chapterId).
    const completed = await this.prisma.userCourseProgress.findMany({
      where: { userId, courseId, sectionId: { in: liveSectionIds } },
      select: { sectionId: true },
      distinct: ['sectionId'],
    });

    return completed.length >= totalSections;
  }

  private async _buildQuestionList(assessment: any): Promise<
    Array<{
      id: string;
      type: QuestionType;
      text: string;
      imageUrl: string | null;
      content: any;
      effectiveMarks: number;
    }>
  > {
    if (assessment.mode === AssessmentMode.MANUAL) {
      return assessment.assessmentQuestions.map((aq: any) => ({
        id: aq.question.id,
        type: aq.question.type,
        text: aq.question.text,
        imageUrl: aq.question.imageUrl,
        content: aq.question.content,
        effectiveMarks: aq.marksOverride ?? aq.question.maxMarks,
      }));
    }

    // AUTOMATIC mode
    const config = assessment.autoConfig as {
      totalQuestions: number;
      byCategory: Array<{ categoryId: string; count: number }>;
      byDifficulty: Array<{ difficulty: string; count: number }>;
    };

    const selected: any[] = [];

    for (const categoryRule of config.byCategory) {
      const pool = await this.prisma.question.findMany({
        where: {
          courseId: assessment.courseId,
          categoryId: categoryRule.categoryId,
          isActive: true,
        },
      });

      if (pool.length < categoryRule.count)
        throw new Error(
          `Not enough active questions in category ${categoryRule.categoryId}. Need ${categoryRule.count}, have ${pool.length}.`,
        );

      const shuffled = this._shuffle(pool);
      selected.push(...shuffled.slice(0, categoryRule.count));
    }

    // Validate difficulty distribution (informational — not re-filtered to keep it simple)
    // Admin should ensure their question bank has the required difficulty spread.

    return this._shuffle(selected)
      .slice(0, config.totalQuestions)
      .map((q) => ({
        id: q.id,
        type: q.type,
        text: q.text,
        imageUrl: q.imageUrl,
        content: q.content,
        effectiveMarks: q.maxMarks,
      }));
  }

  private _shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * Delegates to the shared grading module (src/utils/question-grading.ts) so
   * assessments and chapter quizzes grade every question type identically —
   * see "Recommendation: Code Reuse with Assessment Module" in
   * docs/quiz-question-types-backend-handoff.md.
   */
  private _calculateAutoScore(
    type: QuestionType,
    content: any,
    answer: any,
    maxMarks: number,
  ): number | null {
    return calculateAutoScore(type, content, answer, maxMarks);
  }

  /**
   * Closes IN_PROGRESS attempts whose time (plus grace) has run out. Saved
   * answers are graded as if submitted at the deadline; an attempt with
   * nothing saved becomes EXPIRED. Called on read paths so lists and resume
   * URLs stay consistent without a cron.
   */
  private async _expireStaleAttempts(
    userId: string,
    assessmentId: string,
  ): Promise<void> {
    const open = await this.prisma.assessmentAttempt.findMany({
      where: {
        userId,
        assessmentId,
        status: AssessmentAttemptStatus.IN_PROGRESS,
        snapshotTimeLimitMin: { not: null },
      },
      select: { id: true, startedAt: true, snapshotTimeLimitMin: true },
    });

    for (const stale of open.filter((a) => this._isPastDeadline(a))) {
      const attempt = await this.prisma.assessmentAttempt.findUnique({
        where: { id: stale.id },
        include: { questionSnapshots: true },
      });
      if (attempt?.status !== AssessmentAttemptStatus.IN_PROGRESS) continue;

      if (!attempt.questionSnapshots.some((s) => s.studentAnswer !== null)) {
        await this.prisma.assessmentAttempt.updateMany({
          where: {
            id: attempt.id,
            status: AssessmentAttemptStatus.IN_PROGRESS,
          },
          data: { status: AssessmentAttemptStatus.EXPIRED },
        });
        continue;
      }

      const deadline = new Date(
        attempt.startedAt.getTime() + attempt.snapshotTimeLimitMin! * 60_000,
      );
      try {
        await this._gradeAndSubmit(attempt, new Map(), deadline);
      } catch (error) {
        // Left IN_PROGRESS; the next read retries.
        CourseAssessmentService.logger.error(
          `Grading expired attempt ${attempt.id} failed`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  /** True once startedAt + time limit + grace has passed. No limit, never. */
  private _isPastDeadline(attempt: {
    startedAt: Date;
    snapshotTimeLimitMin: number | null;
  }): boolean {
    if (attempt.snapshotTimeLimitMin == null) return false;
    const deadline =
      attempt.startedAt.getTime() +
      attempt.snapshotTimeLimitMin * 60_000 +
      CourseAssessmentService.ASSESSMENT_TIMER_GRACE_SECONDS * 1000;
    return Date.now() > deadline;
  }

  /**
   * Server-derived timer fields for the student UI. When `snapshotTimeLimitMin` is null, no timer applies.
   */
  private _computeTimeInfo(attempt: {
    startedAt: Date;
    snapshotTimeLimitMin: number | null;
  }): {
    timeLimitSeconds: number;
    startedAtMs: number;
    deadlineMs: number;
    remainingSeconds: number;
    graceSeconds: number;
  } | null {
    if (attempt.snapshotTimeLimitMin == null) return null;
    const timeLimitSeconds = attempt.snapshotTimeLimitMin * 60;
    const startedAtMs = attempt.startedAt.getTime();
    const deadlineMs = startedAtMs + attempt.snapshotTimeLimitMin * 60_000;
    const remainingSeconds = Math.max(
      0,
      Math.floor((deadlineMs - Date.now()) / 1000),
    );
    return {
      timeLimitSeconds,
      startedAtMs,
      deadlineMs,
      remainingSeconds,
      graceSeconds: CourseAssessmentService.ASSESSMENT_TIMER_GRACE_SECONDS,
    };
  }

  private _stripCorrectAnswers(attempt: any): any {
    if (!attempt) return attempt;
    return {
      ...attempt,
      questionSnapshots: (attempt.questionSnapshots ?? []).map((s: any) => {
        const { questionContent, ...rest } = s;
        return {
          ...rest,
          questionContent: stripCorrectAnswerFields(questionContent),
        };
      }),
    };
  }

  private async _upsertCourseCompletion(
    userId: string,
    courseId: string,
    attemptId: string,
    percentage: number,
  ): Promise<void> {
    const existing = await this.prisma.courseCompletion.findUnique({
      where: { userId_courseId: { userId, courseId } },
      include: {
        bestAttempt: { select: { percentage: true } },
      },
    });

    const isBetter =
      !existing?.bestAttempt ||
      percentage > (existing.bestAttempt.percentage ?? 0);

    await this.prisma.courseCompletion.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: {
        userId,
        courseId,
        isPassed: true,
        bestAttemptId: attemptId,
        assessmentPassedAt: new Date(),
      },
      update: {
        isPassed: true,
        assessmentPassedAt: existing?.assessmentPassedAt ?? new Date(),
        ...(isBetter && { bestAttemptId: attemptId }),
      },
    });
  }
}
