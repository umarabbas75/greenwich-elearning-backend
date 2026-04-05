import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  AssessmentAttemptStatus,
  AssessmentMode,
  NotificationType,
  Prisma,
  QuestionDifficulty,
  QuestionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifiications/notification.service';
import {
  AddAssessmentQuestionDto,
  CreateAssessmentDto,
  CreateQuestionCategoryDto,
  CreateQuestionDto,
  GradeAttemptDto,
  ReorderAssessmentQuestionsDto,
  SaveAnswerDto,
  SetCertificateDto,
  StartAttemptDto,
  UpdateAssessmentDto,
  UpdateQuestionCategoryDto,
  UpdateQuestionDto,
} from '../dto';

@Injectable()
export class CourseAssessmentService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

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
      error.message.startsWith('Cannot delete a category that has active questions')
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

      return { message: 'Category created successfully', statusCode: 200, data: category };
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
      return { message: 'Categories fetched successfully', statusCode: 200, data: categories };
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
      return { message: 'Category updated successfully', statusCode: 200, data: category };
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
        throw new Error('Cannot delete a category that has active questions. Deactivate the questions first.');

      await this.prisma.questionCategory.delete({ where: { id: categoryId } });
      return { message: 'Category deleted successfully', statusCode: 200, data: {} };
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

      return { message: 'Question created successfully', statusCode: 200, data: question };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to create question' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
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
      return { message: 'Questions fetched successfully', statusCode: 200, data: questions };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch questions' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  async getQuestionById(questionId: string) {
    try {
      const question = await this.prisma.question.findUnique({
        where: { id: questionId },
        include: { category: true },
      });
      if (!question) throw new Error('Question not found');
      return { message: 'Question fetched successfully', statusCode: 200, data: question };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch question' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  async updateQuestion(questionId: string, body: UpdateQuestionDto) {
    try {
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
      return { message: 'Question updated successfully', statusCode: 200, data: question };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to update question' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
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
        await this.prisma.assessmentQuestion.deleteMany({ where: { questionId } });
        await this.prisma.question.delete({ where: { id: questionId } });
        return { message: 'Question permanently deleted', statusCode: 200, data: {} };
      } else {
        const updated = await this.prisma.question.update({
          where: { id: questionId },
          data: { isActive: false },
        });
        // Remove from any inactive assessment rosters
        await this.prisma.assessmentQuestion.deleteMany({
          where: { questionId, assessment: { isActive: false } },
        });
        return { message: 'Question deactivated successfully', statusCode: 200, data: updated };
      }
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to delete question' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ASSESSMENT MANAGEMENT (ADMIN)
  // ────────────────────────────────────────────────────────────────────────────

  async createAssessment(adminId: string, body: CreateAssessmentDto) {
    try {
      const course = await this.prisma.course.findUnique({ where: { id: body.courseId } });
      if (!course) throw new Error('Course not found');

      if (body.mode === AssessmentMode.AUTOMATIC && !body.autoConfig)
        throw new Error('autoConfig is required for AUTOMATIC mode');

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

      return { message: 'Assessment created successfully', statusCode: 200, data: assessment };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to create assessment' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  async updateAssessment(assessmentId: string, body: UpdateAssessmentDto) {
    try {
      const assessment = await this.prisma.assessment.update({
        where: { id: assessmentId },
        data: {
          ...(body.title && { title: body.title }),
          ...(body.description !== undefined && { description: body.description }),
          ...(body.passingPercentage !== undefined && { passingPercentage: body.passingPercentage }),
          ...(body.timeLimitMinutes !== undefined && { timeLimitMinutes: body.timeLimitMinutes }),
          ...(body.maxAttempts !== undefined && { maxAttempts: body.maxAttempts }),
          ...(body.autoConfig !== undefined && { autoConfig: body.autoConfig as any }),
        },
      });
      return { message: 'Assessment updated successfully', statusCode: 200, data: assessment };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to update assessment' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  async activateAssessment(assessmentId: string) {
    try {
      const assessment = await this.prisma.assessment.findUnique({
        where: { id: assessmentId },
        include: { assessmentQuestions: true },
      });
      if (!assessment) throw new Error('Assessment not found');

      if (assessment.mode === AssessmentMode.MANUAL && assessment.assessmentQuestions.length === 0)
        throw new Error('Cannot activate a MANUAL assessment with no questions. Add questions first.');

      if (assessment.mode === AssessmentMode.AUTOMATIC && !assessment.autoConfig)
        throw new Error('Cannot activate an AUTOMATIC assessment without autoConfig.');

      const [, activated] = await this.prisma.$transaction([
        this.prisma.assessment.updateMany({
          where: { courseId: assessment.courseId },
          data: { isActive: false },
        }),
        this.prisma.assessment.update({
          where: { id: assessmentId },
          data: { isActive: true },
        }),
      ]);

      return { message: 'Assessment activated successfully', statusCode: 200, data: activated };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to activate assessment' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  async deactivateAssessment(assessmentId: string) {
    try {
      const assessment = await this.prisma.assessment.update({
        where: { id: assessmentId },
        data: { isActive: false },
      });
      return { message: 'Assessment deactivated successfully', statusCode: 200, data: assessment };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to deactivate assessment' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
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
      return { message: 'Assessments fetched successfully', statusCode: 200, data: assessments };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch assessments' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
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
      return { message: 'Assessment fetched successfully', statusCode: 200, data: assessment };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch assessment' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // MANUAL ASSESSMENT QUESTION ROSTER (ADMIN)
  // ────────────────────────────────────────────────────────────────────────────

  async addQuestionToAssessment(assessmentId: string, body: AddAssessmentQuestionDto) {
    try {
      const assessment = await this.prisma.assessment.findUnique({
        where: { id: assessmentId },
      });
      if (!assessment) throw new Error('Assessment not found');
      if (assessment.mode !== AssessmentMode.MANUAL)
        throw new Error('Questions can only be added manually to MANUAL mode assessments');

      const question = await this.prisma.question.findUnique({
        where: { id: body.questionId },
      });
      if (!question) throw new Error('Question not found');
      if (question.courseId !== assessment.courseId)
        throw new Error('Question does not belong to the same course as this assessment');
      if (!question.isActive) throw new Error('Cannot add an inactive question to an assessment');

      const aq = await this.prisma.assessmentQuestion.create({
        data: {
          assessmentId,
          questionId: body.questionId,
          orderIndex: body.orderIndex ?? 0,
          marksOverride: body.marksOverride ?? null,
        },
        include: { question: true },
      });

      return { message: 'Question added to assessment', statusCode: 200, data: aq };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to add question' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  async removeQuestionFromAssessment(assessmentId: string, questionId: string) {
    try {
      const hasAttempts = await this.prisma.assessmentAttempt.count({
        where: { assessmentId, status: AssessmentAttemptStatus.FINALIZED },
      });
      if (hasAttempts > 0)
        throw new Error('Cannot remove questions from an assessment that has finalized attempts');

      await this.prisma.assessmentQuestion.deleteMany({
        where: { assessmentId, questionId },
      });
      return { message: 'Question removed from assessment', statusCode: 200, data: {} };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to remove question' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  async reorderAssessmentQuestions(assessmentId: string, body: ReorderAssessmentQuestionsDto) {
    try {
      await this.prisma.$transaction(
        body.questions.map((q) =>
          this.prisma.assessmentQuestion.updateMany({
            where: { assessmentId, questionId: q.questionId },
            data: { orderIndex: q.orderIndex },
          }),
        ),
      );
      return { message: 'Questions reordered successfully', statusCode: 200, data: {} };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to reorder questions' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
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

      const assessment = await this.prisma.assessment.findFirst({
        where: { courseId, isActive: true },
        select: {
          id: true,
          title: true,
          description: true,
          mode: true,
          passingPercentage: true,
          timeLimitMinutes: true,
          maxAttempts: true,
          // autoConfig excluded — not needed by student
        },
      });
      if (!assessment) {
        return { message: 'No active assessment for this course', statusCode: 200, data: null };
      }

      const isEligible = await this._isCourseContentCompleted(userId, courseId);

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
        },
        orderBy: { startedAt: 'desc' },
      });

      const remainingAttempts =
        assessment.maxAttempts === null
          ? null
          : Math.max(0, assessment.maxAttempts - attempts.length);

      return {
        message: 'Assessment fetched successfully',
        statusCode: 200,
        data: { assessment, isEligible, remainingAttempts, attempts },
      };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch assessment' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  async startAttempt(userId: string, body: StartAttemptDto) {
    try {
      const { courseId } = body;

      // 1. Enrollment check
      const enrollment = await this.prisma.userCourse.findFirst({
        where: { userId, courseId, isActive: true },
      });
      if (!enrollment) throw new Error('You are not enrolled in this course');

      // 2. Course content completion check
      const isComplete = await this._isCourseContentCompleted(userId, courseId);
      if (!isComplete)
        throw new Error('You must complete all course content before attempting the assessment');

      // 3. Active assessment
      const assessment = await this.prisma.assessment.findFirst({
        where: { courseId, isActive: true },
        include: {
          assessmentQuestions: {
            include: { question: true },
            orderBy: { orderIndex: 'asc' },
          },
        },
      });
      if (!assessment) throw new Error('No active assessment found for this course');

      // 4. Attempt limit check
      const attemptCount = await this.prisma.assessmentAttempt.count({
        where: { userId, assessmentId: assessment.id },
      });
      if (assessment.maxAttempts !== null && attemptCount >= assessment.maxAttempts)
        throw new Error(
          `Maximum attempts (${assessment.maxAttempts}) reached for this assessment`,
        );

      // 5. No existing IN_PROGRESS attempt
      const inProgress = await this.prisma.assessmentAttempt.findFirst({
        where: { userId, assessmentId: assessment.id, status: AssessmentAttemptStatus.IN_PROGRESS },
      });
      if (inProgress)
        throw new Error('You already have an in-progress attempt. Complete or submit it first.');

      // 6. Build question list
      const selectedQuestions = await this._buildQuestionList(assessment);

      // 7. Calculate totalMarks
      const totalMarks = selectedQuestions.reduce((sum, q) => sum + q.effectiveMarks, 0);

      // 8. Create attempt + snapshots in a transaction
      const attempt = await this.prisma.$transaction(async (tx) => {
        const newAttempt = await tx.assessmentAttempt.create({
          data: {
            assessmentId: assessment.id,
            userId,
            snapshotTitle: assessment.title,
            snapshotPassingPct: assessment.passingPercentage,
            snapshotMaxAttempts: assessment.maxAttempts,
            snapshotTimeLimitMin: assessment.timeLimitMinutes,
            totalMarks,
          },
        });

        await tx.attemptQuestionSnapshot.createMany({
          data: selectedQuestions.map((q, idx) => ({
            attemptId: newAttempt.id,
            questionId: q.id,
            orderIndex: idx,
            questionType: q.type,
            questionText: q.text,
            questionImageUrl: q.imageUrl ?? null,
            questionContent: q.content as any,
            maxMarks: q.effectiveMarks,
          })),
        });

        return tx.assessmentAttempt.findUnique({
          where: { id: newAttempt.id },
          include: { questionSnapshots: { orderBy: { orderIndex: 'asc' } } },
        });
      });

      // 9. Strip correct answers before returning
      const sanitized = this._stripCorrectAnswers(attempt);
      return { message: 'Attempt started successfully', statusCode: 200, data: sanitized };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to start attempt' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  async getAttempt(userId: string, attemptId: string) {
    try {
      const attempt = await this.prisma.assessmentAttempt.findUnique({
        where: { id: attemptId },
        include: { questionSnapshots: { orderBy: { orderIndex: 'asc' } } },
      });
      if (!attempt) throw new Error('Attempt not found');
      if (attempt.userId !== userId) throw new Error('You do not have access to this attempt');

      const sanitized = this._stripCorrectAnswers(attempt);
      return { message: 'Attempt fetched successfully', statusCode: 200, data: sanitized };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch attempt' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  async saveAnswer(userId: string, attemptId: string, body: SaveAnswerDto) {
    try {
      const attempt = await this.prisma.assessmentAttempt.findUnique({
        where: { id: attemptId },
      });
      if (!attempt) throw new Error('Attempt not found');
      if (attempt.userId !== userId) throw new Error('You do not have access to this attempt');
      if (attempt.status !== AssessmentAttemptStatus.IN_PROGRESS)
        throw new Error('This attempt is no longer in progress');

      const snapshot = await this.prisma.attemptQuestionSnapshot.findUnique({
        where: { id: body.snapshotId },
      });
      if (!snapshot) throw new Error('Question snapshot not found');
      if (snapshot.attemptId !== attemptId)
        throw new Error('This question does not belong to your attempt');
      if (snapshot.isLocked) throw new Error('This question has already been answered and is locked');

      const systemScore = this._calculateAutoScore(
        snapshot.questionType,
        snapshot.questionContent as any,
        body.studentAnswer,
        snapshot.maxMarks,
      );

      const updated = await this.prisma.attemptQuestionSnapshot.update({
        where: { id: body.snapshotId },
        data: {
          studentAnswer: body.studentAnswer as any,
          isAnswered: true,
          isLocked: true,
          systemScore,
        },
      });

      const { questionContent: _, ...safeSnapshot } = updated;
      return { message: 'Answer saved successfully', statusCode: 200, data: safeSnapshot };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to save answer' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  async submitAttempt(userId: string, attemptId: string) {
    try {
      const attempt = await this.prisma.assessmentAttempt.findUnique({
        where: { id: attemptId },
        include: { questionSnapshots: true },
      });
      if (!attempt) throw new Error('Attempt not found');
      if (attempt.userId !== userId) throw new Error('You do not have access to this attempt');
      if (attempt.status !== AssessmentAttemptStatus.IN_PROGRESS)
        throw new Error('This attempt is not in progress');

      const hasManualQuestions = attempt.questionSnapshots.some(
        (s) =>
          s.questionType === QuestionType.SHORT_ANSWER ||
          s.questionType === QuestionType.LONG_ANSWER,
      );

      let newStatus: AssessmentAttemptStatus;
      let marksObtained: number | null = null;
      let percentage: number | null = null;
      let isPassed: boolean | null = null;

      if (!hasManualQuestions) {
        marksObtained = attempt.questionSnapshots.reduce((sum, s) => sum + (s.systemScore ?? 0), 0);
        percentage =
          attempt.totalMarks && attempt.totalMarks > 0
            ? (marksObtained / attempt.totalMarks) * 100
            : 0;
        isPassed = percentage >= attempt.snapshotPassingPct;
        newStatus = AssessmentAttemptStatus.AUTO_GRADED;
      } else {
        newStatus = AssessmentAttemptStatus.SUBMITTED;
      }

      const updated = await this.prisma.assessmentAttempt.update({
        where: { id: attemptId },
        data: {
          status: newStatus,
          submittedAt: new Date(),
          ...(marksObtained !== null && { marksObtained }),
          ...(percentage !== null && { percentage }),
          ...(isPassed !== null && { isPassed }),
        },
      });

      // Upsert CourseCompletion if auto-graded and passed
      if (newStatus === AssessmentAttemptStatus.AUTO_GRADED && isPassed) {
        const assessmentRecord = await this.prisma.assessment.findUnique({
          where: { id: updated.assessmentId },
          select: { courseId: true },
        });
        if (assessmentRecord) {
          await this._upsertCourseCompletion(userId, assessmentRecord.courseId, attemptId, percentage!);
        }
      }

      // Notify the admin who created the assessment
      const assessment = await this.prisma.assessment.findUnique({
        where: { id: attempt.assessmentId },
      });
      if (assessment) {
        await this.notificationService.createAssessmentNotification(
          assessment.createdByAdminId,
          NotificationType.ASSESSMENT_SUBMITTED,
          `A student has submitted the assessment: ${attempt.snapshotTitle}`,
          attemptId,
        );
      }

      return { message: 'Assessment submitted successfully', statusCode: 200, data: updated };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to submit attempt' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
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

      return { message: 'Attempt history fetched', statusCode: 200, data: attempts };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch history' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  async getStudentCompletion(userId: string, courseId: string) {
    try {
      const completion = await this.prisma.courseCompletion.findUnique({
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
      });
      return { message: 'Completion fetched', statusCode: 200, data: completion ?? null };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch completion' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
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
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          assessment: { select: { id: true, title: true } },
        },
        orderBy: { submittedAt: 'desc' },
      });

      return { message: 'Attempts fetched', statusCode: 200, data: attempts };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch attempts' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  async getAdminAttemptDetail(attemptId: string) {
    try {
      const attempt = await this.prisma.assessmentAttempt.findUnique({
        where: { id: attemptId },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          questionSnapshots: { orderBy: { orderIndex: 'asc' } },
        },
      });
      if (!attempt) throw new Error('Attempt not found');
      return { message: 'Attempt fetched', statusCode: 200, data: attempt };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to fetch attempt' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
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
        const snapshot = attempt.questionSnapshots.find((s) => s.id === score.snapshotId);
        if (!snapshot) throw new Error(`Snapshot ${score.snapshotId} not found in this attempt`);
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
      const updatedSnapshots = await this.prisma.attemptQuestionSnapshot.findMany({
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
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to grade attempt' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
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

      await this.prisma.$transaction([
        ...snapshotUpdates,
        this.prisma.assessmentAttempt.update({
          where: { id: attemptId },
          data: {
            status: AssessmentAttemptStatus.FINALIZED,
            marksObtained,
            percentage,
            isPassed,
            gradedAt: new Date(),
            finalizedAt: new Date(),
          },
        }),
      ]);

      // Upsert CourseCompletion
      if (attempt.assessment) {
        await this._upsertCourseCompletion(
          attempt.userId,
          attempt.assessment.courseId,
          attemptId,
          percentage,
        );
      }

      // Notify student
      await this.notificationService.createAssessmentNotification(
        attempt.userId,
        NotificationType.ASSESSMENT_GRADED,
        `Your assessment "${attempt.snapshotTitle}" has been graded. You ${isPassed ? 'passed' : 'did not pass'}.`,
        attemptId,
      );

      const finalized = await this.prisma.assessmentAttempt.findUnique({
        where: { id: attemptId },
        include: { questionSnapshots: { orderBy: { orderIndex: 'asc' } } },
      });

      return { message: 'Assessment finalized successfully', statusCode: 200, data: finalized };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to finalize grade' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  async setCertificate(userId: string, courseId: string, body: SetCertificateDto) {
    try {
      const completion = await this.prisma.courseCompletion.update({
        where: { userId_courseId: { userId, courseId } },
        data: { certificateUrl: body.certificateUrl },
      });
      return { message: 'Certificate URL saved', statusCode: 200, data: completion };
    } catch (error) {
      throw new HttpException(
        { status: HttpStatus.FORBIDDEN, error: error?.message || 'Failed to set certificate' },
        HttpStatus.FORBIDDEN,
        { cause: error },
      );
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ────────────────────────────────────────────────────────────────────────────

  private async _isCourseContentCompleted(userId: string, courseId: string): Promise<boolean> {
    const totalSections = await this.prisma.section.count({
      where: { chapter: { module: { courseId } } },
    });
    if (totalSections === 0) return true;

    const completedSections = await this.prisma.userCourseProgress.count({
      where: { userId, courseId },
    });

    return completedSections >= totalSections;
  }

  private async _buildQuestionList(
    assessment: any,
  ): Promise<Array<{ id: string; type: QuestionType; text: string; imageUrl: string | null; content: any; effectiveMarks: number }>> {
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

    return this._shuffle(selected).slice(0, config.totalQuestions).map((q) => ({
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

  private _calculateAutoScore(
    type: QuestionType,
    content: any,
    answer: any,
    maxMarks: number,
  ): number | null {
    if (!answer) return null;

    switch (type) {
      case QuestionType.SINGLE_CHOICE:
        return answer.selectedOptionId === content.correctOptionId ? maxMarks : 0;

      case QuestionType.TRUE_FALSE:
        return answer.answer === content.correctAnswer ? maxMarks : 0;

      case QuestionType.FILL_IN_THE_BLANK:
        return (answer.selectedWord ?? '').toLowerCase().trim() ===
          (content.correctAnswer ?? '').toLowerCase().trim()
          ? maxMarks
          : 0;

      case QuestionType.MULTIPLE_CHOICE: {
        const correct: Set<string> = new Set(content.correctOptionIds ?? []);
        const selected: Set<string> = new Set(answer.selectedOptionIds ?? []);
        const intersection = [...correct].filter((x) => selected.has(x)).length;
        const union = new Set([...correct, ...selected]).size;
        return union === 0 ? 0 : (intersection / union) * maxMarks;
      }

      case QuestionType.VISUAL_ACTIVITY: {
        const correct: Set<string> = new Set(
          content.options?.filter((o: any) => o.isCorrect).map((o: any) => o.id) ?? [],
        );
        const selected: Set<string> = new Set(answer.selectedOptionIds ?? []);
        if (correct.size === 1 && !content.allowMultiple) {
          const [onlyCorrect] = correct;
          return selected.has(onlyCorrect) && selected.size === 1 ? maxMarks : 0;
        }
        const intersection = [...correct].filter((x) => selected.has(x)).length;
        const union = new Set([...correct, ...selected]).size;
        return union === 0 ? 0 : (intersection / union) * maxMarks;
      }

      case QuestionType.ORDERING: {
        const correct: string[] = content.correctOrder ?? [];
        const given: string[] = answer.orderedIds ?? [];
        const matches = correct.filter((id, idx) => given[idx] === id).length;
        return correct.length === 0 ? 0 : (matches / correct.length) * maxMarks;
      }

      case QuestionType.MATCHING: {
        const pairs: Array<{ id: string }> = content.pairs ?? [];
        const givenPairs: Array<{ leftId: string; rightId: string }> = answer.pairs ?? [];
        const correct = givenPairs.filter((gp) => gp.leftId === gp.rightId).length;
        return pairs.length === 0 ? 0 : (correct / pairs.length) * maxMarks;
      }

      case QuestionType.SHORT_ANSWER:
      case QuestionType.LONG_ANSWER:
        return null;

      default:
        return null;
    }
  }

  private _stripCorrectAnswers(attempt: any): any {
    if (!attempt) return attempt;
    return {
      ...attempt,
      questionSnapshots: (attempt.questionSnapshots ?? []).map((s: any) => {
        const { questionContent, ...rest } = s;
        const sanitizedContent = { ...questionContent };
        delete sanitizedContent.correctOptionId;
        delete sanitizedContent.correctOptionIds;
        delete sanitizedContent.correctAnswer;
        delete sanitizedContent.correctOrder;
        if (sanitizedContent.pairs) {
          const categories = this._shuffle(
            sanitizedContent.pairs.map((p: any) => ({ id: p.id, text: p.right })),
          );
          sanitizedContent.categories = categories;
          sanitizedContent.pairs = sanitizedContent.pairs.map((p: any) => ({
            id: p.id,
            left: p.left,
          }));
        }
        if (sanitizedContent.options) {
          sanitizedContent.options = sanitizedContent.options.map((o: any) => ({
            id: o.id,
            text: o.text,
          }));
        }
        return { ...rest, questionContent: sanitizedContent };
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

    const isBetter = !existing?.bestAttempt || percentage > (existing.bestAttempt.percentage ?? 0);

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
