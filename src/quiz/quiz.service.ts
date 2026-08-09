import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Quiz } from '@prisma/client';
import {
  CheckQuiz,
  QuizDto,
  ResponseDto,
  UpdateChapterQuizOrderDto,
  UpdateQuizDto,
} from '../dto';
import { PrismaService } from '../prisma/prisma.service';
import { CourseVersionService } from '../course-version/course-version.service';
import {
  parseManifest,
  isIdReferencedInManifest,
} from '../course-version/course-version.manifest';
import {
  assertChapterAccessible,
  enrichQuizProgressReport,
  getCourseIdForChapter,
  gradeChapterQuizFromStoredAnswers,
  recordChapterAndModuleCompletionIfNeeded,
  resolveChapterQuizIds,
  resolvePassingCriteria,
} from '../utils/chapter-progression';
import { CourseCompletionService } from '../course-completion/course-completion.service';

@Injectable()
export class QuizService {
  private static readonly logger = new Logger(QuizService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private courseVersionService: CourseVersionService,
    private courseCompletion: CourseCompletionService,
  ) {}

  /**
   * Best-effort auto-publish after a structural quiz change. The structural
   * mutation has ALREADY committed by the time this runs, so a publish failure
   * must NOT fail the request (previously it propagated and returned a 403 to
   * the admin even though the quiz change had persisted). We log it instead; the
   * version self-heals on the next structural edit (the fingerprint dedup
   * captures the current live state) or via the reconcile job. Mirrors
   * CourseService.autoPublishAfterStructureChange.
   */
  private async autoPublishAfterQuizChange(
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
      if (published) {
        QuizService.logger.log(
          `Auto-published v${published.versionNumber} for course ${courseId}`,
        );
      }
      return published;
    } catch (error) {
      QuizService.logger.error(
        `Auto-publish failed for course ${courseId} after "${changeNotes}": ${
          error?.message ?? error
        }`,
      );
      return null;
    }
  }
  async getQuiz(id: string, role: string): Promise<ResponseDto> {
    try {
      let quiz = {};
      if (role == 'admin') {
        quiz = await this.prisma.quiz.findUnique({ where: { id } });
      } else if (role == 'user') {
        quiz = await this.prisma.quiz.findUnique({
          where: { id },
          select: {
            id: true,
            question: true,
            options: true,
          },
        });
      }

      return {
        message: 'Successfully fetch Quiz info',
        statusCode: 200,
        data: quiz,
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
  async getAllQuizzes(role: string): Promise<ResponseDto> {
    try {
      let quizzes = [];
      if (role == 'admin') {
        quizzes = await this.prisma.quiz.findMany({
          orderBy: {
            createdAt: 'desc',
          },
          // limit: 10,
          // offset: 10,
        });
      } else if (role == 'user') {
        quizzes = await this.prisma.quiz.findMany({
          orderBy: {
            createdAt: 'desc',
          },
          select: {
            id: true,
            question: true,
            options: true,
          },
          // limit: 10,
          // offset: 10,
        });
      }

      return {
        message: 'Successfully fetch all Quizzes info',
        statusCode: 200,
        data: quizzes,
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

  async getAllAssignQuizzes(
    chapterId: string,
    role: string,
    userId: string,
    userEmail?: string | null,
  ): Promise<ResponseDto> {
    try {
      const chapterMeta = await this.prisma.chapter.findUnique({
        where: { id: chapterId },
        select: {
          id: true,
          module: { select: { courseId: true } },
        },
      });

      if (!chapterMeta) {
        throw new Error('Chapter not found');
      }

      const courseId = chapterMeta.module?.courseId;
      let quizzes: Array<{
        id: string;
        question: string;
        options: string[];
        answer?: string;
      }> = [];
      let userAnswers: Array<{
        quizId: string;
        answer: string;
        isAnswerCorrect: boolean;
      }> = [];
      // True once we have an authoritative set from the user's pinned version.
      // A pinned learner's empty set is a real "no quizzes in your version" —
      // it must NOT fall through to the live quizzes below (cross-version leak).
      let resolvedFromVersion = false;

      if (role === 'user') {
        const uc = courseId
          ? await this.prisma.userCourse.findUnique({
              where: { userId_courseId: { userId, courseId } },
              select: { id: true, enrolledVersionId: true },
            })
          : null;

        const versionId =
          courseId && uc?.enrolledVersionId
            ? await this.courseVersionService.resolveEnrolledVersionId(
                userId,
                courseId,
                uc,
              )
            : null;

        // Use `versionId` directly — it is resolveEnrolledVersionId's result,
        // which is already null for BOTH unpinned learners and a dangling pin
        // (version row gone). Falling back to `uc.enrolledVersionId` here would
        // re-inject the dangling id and defeat the degrade-to-live, serving zero
        // quizzes / silently opening the progression gate.
        const gateCtx = courseId
          ? {
              courseId,
              enrolledVersionId: versionId,
            }
          : undefined;

        const [, versionQuizzes, answers] = await Promise.all([
          assertChapterAccessible(
            this.prisma,
            this.config,
            userId,
            chapterId,
            userEmail,
            gateCtx,
          ),
          courseId
            ? this.courseVersionService.getVersionQuizzesForChapter(
                userId,
                courseId,
                chapterId,
                false,
                versionId,
              )
            : Promise.resolve(null),
          this.prisma.quizAnswer.findMany({
            where: { userId, chapterId },
          }),
        ]);
        userAnswers = answers;
        // null = unpinned (fall back to live). A non-null array (even empty) is
        // the authoritative pinned set.
        if (versionQuizzes !== null) {
          quizzes = versionQuizzes;
          resolvedFromVersion = true;
        }
      } else {
        userAnswers = await this.prisma.quizAnswer.findMany({
          where: { userId, chapterId },
        });
      }

      // Live fallback only for unpinned learners and non-user (admin) callers.
      if (!resolvedFromVersion && quizzes.length === 0) {
        const chapter = await this.prisma.chapter.findUnique({
          where: { id: chapterId },
          include: {
            quizzes: {
              where: { isArchived: false },
              orderBy: [
                { orderIndex: 'asc' },
                { createdAt: 'asc' },
                { id: 'asc' },
              ],
              select: {
                id: true,
                question: true,
                options: true,
                answer: true,
              },
            },
          },
        });
        quizzes = chapter?.quizzes ?? [];
      }

      const updatedUserQuizData = quizzes?.map((item) => {
        const userAnswer = userAnswers.find((ua) => ua.quizId === item.id);
        return {
          ...item,
          userAnswered: userAnswer?.answer ? true : false,
          isAnswerCorrect: userAnswer?.isAnswerCorrect,
        };
      });

      return {
        message: 'Successfully fetch all Quizzes info related to chapter',
        statusCode: 200,
        data: updatedUserQuizData?.length > 0 ? updatedUserQuizData : [],
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

  async getChapterQuizzesReport(
    chapterId: string,
    userId: string,
  ): Promise<ResponseDto> {
    try {
      const quizReport = await this.prisma.quizProgress.findUnique({
        where: {
          userId_chapterId: {
            userId,
            chapterId,
          },
        },
      });

      console.log({ quizReport });

      return {
        message: 'Successfully fetch chapter quiz report',
        statusCode: 200,
        data: enrichQuizProgressReport(quizReport),
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

  async getAllQuizReport(): Promise<ResponseDto> {
    try {
      const quizReport = await this.prisma.quizProgress.findMany();

      console.log({ quizReport });

      return {
        message: 'Successfully fetch all Quizzes info related to chapter',
        statusCode: 200,
        data: quizReport,
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

  async createChapterQuizzesReport(
    userId: string,
    chapterId: string,
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

      const quizReport = await this.prisma.quizProgress.findUnique({
        where: {
          userId_chapterId: {
            userId,
            chapterId,
          },
        },
      });

      const grade = await gradeChapterQuizFromStoredAnswers(
        this.prisma,
        userId,
        chapterId,
        quizReport?.passingCriteria,
      );

      if (grade.answeredQuestions < grade.totalQuestions) {
        throw new BadRequestException(
          'Answer all chapter quiz questions before submitting the report',
        );
      }

      const stickyPassed = (quizReport?.isPassed ?? false) || grade.isPassed;
      const bestScore = Math.max(quizReport?.score ?? 0, grade.score);
      const passingCriteria = grade.passingCriteria;

      let newQuizProgress = null;
      if (!quizReport) {
        newQuizProgress = await this.prisma.quizProgress.create({
          data: {
            userId,
            chapterId,
            totalAttempts: 1,
            isPassed: stickyPassed,
            score: bestScore,
            passingCriteria,
          },
        });
      } else {
        newQuizProgress = await this.prisma.quizProgress.update({
          where: {
            userId_chapterId: {
              userId,
              chapterId,
            },
          },
          data: {
            totalAttempts: (quizReport.totalAttempts ?? 0) + 1,
            isPassed: stickyPassed,
            score: bestScore,
            passingCriteria: resolvePassingCriteria(
              quizReport.passingCriteria || passingCriteria,
            ),
          },
        });
      }

      // Passing a chapter quiz can be the LAST act that completes a course —
      // on a course where every chapter carries a quiz, it always is. Course
      // completion used to be re-evaluated only when a section-progress row
      // was created, so a learner finishing on a quiz was never stamped
      // complete. Gated on stickyPassed so failed submissions don't pay for
      // the check.
      //
      // Wrapped defensively: the quiz answers and QuizProgress are ALREADY
      // committed by this point, so a failure in completion bookkeeping must
      // not turn a successful submission into a 403 via the outer catch.
      // checkContentCompletion swallows its own errors, but the courseId
      // lookup and chapter/module rollup can still throw.
      try {
        const courseId = await getCourseIdForChapter(this.prisma, chapterId);

        await recordChapterAndModuleCompletionIfNeeded(
          this.prisma,
          userId,
          chapterId,
          courseId ? { courseId } : undefined,
        );

        if (stickyPassed && courseId) {
          await this.courseCompletion.checkContentCompletion(userId, courseId);
        }
      } catch (completionError) {
        const message =
          completionError instanceof Error
            ? completionError.message
            : String(completionError);
        QuizService.logger.warn(
          `Post-quiz completion bookkeeping failed for user ${userId}, chapter ${chapterId}: ${message}`,
        );
      }

      return {
        message: 'Chapter quiz report saved',
        statusCode: 200,
        data: enrichQuizProgressReport(newQuizProgress),
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

  async retakeChapterQuiz(
    userId: string,
    chapterId: string,
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

      await this.prisma.quizAnswer.deleteMany({
        where: {
          userId,
          chapterId,
        },
      });
      return {
        message: 'all entries deleted successfully',
        statusCode: 200,
        data: null,
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

  async createQuiz(body: QuizDto): Promise<ResponseDto> {
    try {
      await this.prisma.quiz.create({
        data: {
          question: body.question,
          options: body.options,
          answer: body.answer,
        },
      });
      return {
        message: 'Successfully create quiz record',
        statusCode: 200,
        data: {},
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

  /**
   * Reorder active quizzes within a chapter. Does not publish a course version
   * (quiz order is not structural). Pinned learners see new order via live orderIndex.
   */
  async reorderChapterQuizzes(
    body: UpdateChapterQuizOrderDto,
  ): Promise<ResponseDto> {
    try {
      const { chapterId, quizzes: items } = body;
      const quizIds = items.map((q) => q.id);

      const active = await this.prisma.quiz.findMany({
        where: { chapterId, isArchived: false },
        select: { id: true },
      });
      const activeIds = new Set(active.map((q) => q.id));

      if (active.length !== quizIds.length) {
        throw new BadRequestException(
          'Quiz list must include every active quiz in the chapter exactly once',
        );
      }
      for (const id of quizIds) {
        if (!activeIds.has(id)) {
          throw new BadRequestException(
            `Quiz ${id} is not an active quiz in this chapter`,
          );
        }
      }
      if (new Set(quizIds).size !== quizIds.length) {
        throw new BadRequestException('Duplicate quiz ids in reorder payload');
      }

      await this.prisma.$transaction(
        items.map((item) =>
          this.prisma.quiz.update({
            where: { id: item.id },
            data: { orderIndex: item.orderIndex },
          }),
        ),
      );

      return {
        message: 'Successfully updated chapter quiz order',
        statusCode: 200,
        data: { chapterId, updatedCount: items.length },
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
        { cause: error },
      );
    }
  }

  async assignQuiz(
    quizId: string,
    chapterId: string,
    adminId?: string,
  ): Promise<ResponseDto> {
    try {
      const isQuizExist: Quiz = await this.prisma.quiz.findUnique({
        where: { id: quizId },
      });
      if (!isQuizExist) {
        throw new Error('quiz not exist');
      }

      const chapter = await this.prisma.chapter.findUnique({
        where: { id: chapterId },
        include: { module: { select: { courseId: true } } },
      });
      if (!chapter) {
        throw new Error('chapter not exist');
      }

      const maxOrder = await this.prisma.quiz.aggregate({
        where: {
          chapterId,
          isArchived: false,
          id: { not: quizId },
        },
        _max: { orderIndex: true },
      });
      const orderIndex = (maxOrder._max.orderIndex ?? -1) + 1;

      // Re-assign must clear isArchived — unAssignQuiz archives referenced quizzes
      // (chapterId cleared) while keeping the row for version history. connect alone
      // leaves isArchived true, so getAllChapters/_count and getAllAssignQuizzes
      // (both filter isArchived: false) report 0 despite a 200 from this endpoint.
      await this.prisma.quiz.update({
        where: { id: quizId },
        data: { chapterId, isArchived: false, orderIndex },
      });

      const publishedVersion = await this.autoPublishAfterQuizChange(
        chapter.module.courseId,
        adminId,
        `Assigned quiz to chapter "${chapter.title}"`,
      );

      return {
        message: publishedVersion
          ? `Successfully assigned quiz to chapter (published v${publishedVersion.versionNumber})`
          : 'Successfully assign quiz to chapter',
        statusCode: 200,
        data: {},
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
  async unAssignQuiz(
    quizId: string,
    chapterId: string,
    adminId?: string,
  ): Promise<ResponseDto> {
    try {
      const isQuizExist: Quiz = await this.prisma.quiz.findUnique({
        where: { id: quizId },
      });
      if (!isQuizExist) {
        throw new Error('quiz not exist');
      }

      const chapter = await this.prisma.chapter.findUnique({
        where: { id: chapterId },
        include: { module: { select: { courseId: true } } },
      });
      if (!chapter) {
        throw new Error('chapter not exist');
      }

      const references =
        await this.courseVersionService.getReferencingVersionsWithEnrollments(
          'quiz',
          quizId,
          chapter.module.courseId,
        );
      const referenced = references.versions.length > 0;
      if (referenced) {
        await this.prisma.quiz.update({
          where: { id: quizId },
          data: {
            isArchived: true,
            chapterId: null,
            // archivedAt: set on the archive branch of unAssignQuiz for
            // symmetry with deleteQuiz and with module/chapter/section
            // archives. Both branches ultimately produce an archived row,
            // and the inventory endpoint's sort would be broken if only one
            // of the two entry points wrote the timestamp.
            archivedAt: new Date(),
          },
        });
        const publishedVersion = await this.autoPublishAfterQuizChange(
          chapter.module.courseId,
          adminId,
          `Archived quiz from chapter "${chapter.title}"`,
        );
        // Archive is high-consequence: a quiz that "disappeared" from the
        // admin list is still being served to every learner pinned to a
        // referencing version. Log who did it — best-effort via writeAudit.
        if (adminId) {
          await this.courseVersionService.writeAudit({
            adminId,
            action: 'ARCHIVE_QUIZ',
            targetType: 'Quiz',
            targetId: quizId,
            courseId: chapter.module.courseId,
            metadata: {
              via: 'unAssignQuiz',
              chapterId,
              chapterTitle: chapter.title,
              stillServedTo: references.stillServedTo,
              versions: references.versions.map((v) => ({
                versionNumber: v.versionNumber,
                status: v.status,
                enrollmentCount: v.enrollmentCount,
              })),
            },
          });
        }
        return {
          message: this.courseVersionService.buildArchiveMessage(
            'Quiz',
            references.stillServedTo,
            references.versions,
          ),
          statusCode: 200,
          data: {},
          outcome: 'archived',
          stillServedTo: references.stillServedTo,
          versionsReferencing: references.versions,
          publishedVersion: publishedVersion ?? undefined,
        };
      }

      // Remove the quiz from the chapter
      await this.prisma.chapter.update({
        where: { id: chapterId },
        data: {
          quizzes: {
            disconnect: { id: quizId },
          },
        },
      });

      const publishedVersion = await this.autoPublishAfterQuizChange(
        chapter.module.courseId,
        adminId,
        `Unassigned quiz from chapter "${chapter.title}"`,
      );

      return {
        message: publishedVersion
          ? `Successfully unassigned quiz (published v${publishedVersion.versionNumber})`
          : 'Successfully unassigned quiz to module',
        statusCode: 200,
        data: {},
        // Not 'deleted' — the quiz row survives in the bank and can be
        // re-assigned to another chapter via assignQuiz. Rendering "deleted"
        // for a reversible detach was the exact confusion `outcome` exists
        // to prevent.
        outcome: 'unassigned',
        stillServedTo: 0,
        publishedVersion: publishedVersion ?? undefined,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to unassign course from user',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async updateQuiz(id: string, body: UpdateQuizDto): Promise<ResponseDto> {
    try {
      const isQuizExist: Quiz = await this.prisma.quiz.findUnique({
        where: { id: id },
      });
      if (!isQuizExist) {
        throw new Error('Quizzes does not exist ');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      const updateQuiz = {};

      for (const [key, value] of Object.entries(body)) {
        updateQuiz[key] = value;
      }

      // Save the updated user
      await this.prisma.quiz.update({
        where: { id }, // Specify the unique identifier for the user you want to update
        data: updateQuiz, // Pass the modified user object
      });

      return {
        message: 'Successfully create quiz record',
        statusCode: 200,
        data: {},
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
  async deleteQuiz(id: string, adminId?: string): Promise<ResponseDto> {
    try {
      const quiz = await this.prisma.quiz.findUnique({
        where: { id },
        include: {
          chapter: { include: { module: { select: { courseId: true } } } },
        },
      });
      if (!quiz) {
        throw new Error('Course not found');
      }

      const courseId = quiz.chapter?.module?.courseId ?? null;

      const references =
        await this.courseVersionService.getReferencingVersionsWithEnrollments(
          'quiz',
          id,
          courseId ?? undefined,
        );
      const referenced = references.versions.length > 0;
      if (referenced) {
        const archived = await this.prisma.quiz.update({
          where: { id },
          data: { isArchived: true, archivedAt: new Date() },
        });
        const publishedVersion = courseId
          ? await this.autoPublishAfterQuizChange(
              courseId,
              adminId,
              'Archived quiz',
            )
          : null;
        if (adminId && courseId) {
          await this.courseVersionService.writeAudit({
            adminId,
            action: 'ARCHIVE_QUIZ',
            targetType: 'Quiz',
            targetId: id,
            courseId,
            metadata: {
              via: 'deleteQuiz',
              stillServedTo: references.stillServedTo,
              versions: references.versions.map((v) => ({
                versionNumber: v.versionNumber,
                status: v.status,
                enrollmentCount: v.enrollmentCount,
              })),
            },
          });
        }
        return {
          message: this.courseVersionService.buildArchiveMessage(
            'Quiz',
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

      await this.prisma.quiz.delete({
        where: { id },
      });

      const publishedVersion = courseId
        ? await this.autoPublishAfterQuizChange(
            courseId,
            adminId,
            'Removed quiz',
          )
        : null;

      return {
        message: publishedVersion
          ? `Successfully deleted quiz (published v${publishedVersion.versionNumber})`
          : 'Successfully deleted quiz record',
        statusCode: 200,
        data: {},
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

  /**
   * Restore an archived quiz — flip `isArchived: false`, clear `archivedAt`,
   * and (best-effort) publish a new version so the quiz reappears for new
   * enrollments. Rejects if the quiz is already live.
   *
   * Parent guard: a quiz's `chapterId` can legitimately be null (either
   * because it's an in-the-bank quiz never assigned, or because
   * `unAssignQuiz` niled the FK on archive). We only reject when the
   * quiz is currently attached to an archived chapter — restoring a
   * chapter-less quiz is fine and lands it back in the "unassigned" pool
   * where `assignQuiz` can put it into a chapter.
   */
  async restoreQuiz(id: string, adminId?: string): Promise<ResponseDto> {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id },
      select: {
        id: true,
        chapterId: true,
        isArchived: true,
        question: true,
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
    if (!quiz) {
      throw new HttpException(
        { status: HttpStatus.NOT_FOUND, error: 'Quiz not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    if (!quiz.isArchived) {
      throw new HttpException(
        {
          status: HttpStatus.CONFLICT,
          error: 'Cannot restore: Quiz is already live (not archived)',
          details: { id: quiz.id, isArchived: false },
        },
        HttpStatus.CONFLICT,
      );
    }

    // Parent-chain guard (only when the quiz is currently attached to a
    // chapter). Same shape as CourseService.restoreSection so the FE's
    // 409 handler stays identical across entity types.
    if (quiz.chapter) {
      const chain: Array<{ entityType: string; id: string; title: string }> =
        [];
      if (quiz.chapter.module?.isArchived) {
        chain.push({
          entityType: 'module',
          id: quiz.chapter.module.id,
          title: quiz.chapter.module.title,
        });
      }
      if (quiz.chapter.isArchived) {
        chain.push({
          entityType: 'chapter',
          id: quiz.chapter.id,
          title: quiz.chapter.title,
        });
      }
      if (chain.length > 0) {
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
    }

    const restored = await this.prisma.quiz.update({
      where: { id },
      data: { isArchived: false, archivedAt: null },
    });

    const courseId = quiz.chapter?.module?.courseId ?? null;
    // `publishedInLatest` is true only if the latest published version's
    // manifest already includes this quiz's id. For a quiz that was
    // unassigned-and-archived (chapterId nulled), this will typically be
    // false — publishing a new version after the restore + reassign is the
    // path that gets it back into the live tree.
    let publishedInLatest = false;
    let latest: Awaited<
      ReturnType<typeof this.courseVersionService.getLatestPublishedVersion>
    > = null;
    if (courseId) {
      latest =
        await this.courseVersionService.getLatestPublishedVersion(courseId);
      if (latest) {
        const parsed = parseManifest(latest.manifest);
        publishedInLatest = parsed
          ? isIdReferencedInManifest(parsed, 'quiz', id)
          : false;
      }
    }

    if (adminId) {
      await this.courseVersionService.writeAudit({
        adminId,
        action: 'RESTORE_ENTITY',
        targetType: 'Quiz',
        targetId: id,
        courseId: courseId ?? undefined,
        metadata: {
          entityType: 'quiz',
          priorIsArchived: true,
          parentWasArchived: false,
          publishedInLatest,
          questionSnippet:
            quiz.question.length > 100
              ? quiz.question.slice(0, 100) + '…'
              : quiz.question,
        },
      });
    }

    return {
      message: 'Restored',
      statusCode: 200,
      data: {
        ...restored,
        entityType: 'quiz',
        latestPublishedVersionId: latest?.id ?? null,
        latestPublishedVersionNumber: latest?.versionNumber ?? null,
        publishedInLatest,
        note: publishedInLatest
          ? undefined
          : this.courseVersionService.buildRestoreNote(latest?.versionNumber),
      },
    };
  }

  async checkQuiz(
    userId: string,
    body: CheckQuiz,
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

      // Fetch quiz, user, and quizAnswer in parallel
      const [quiz, user, existingQuizAnswer] = await Promise.all([
        this.prisma.quiz.findUnique({ where: { id: body.quizId } }),
        this.prisma.user.findUnique({ where: { id: userId } }),
        this.prisma.quizAnswer.findFirst({
          where: {
            quizId: body.quizId,
            userId: userId,
          },
        }),
      ]);

      if (!quiz || !user) {
        throw new Error('Quiz or user not found');
      }

      // Validate against the quiz set this learner was actually SERVED — never
      // against the live quiz.chapterId. A pinned learner reads from their
      // version manifest, so once an admin moves or unassigns a quiz, live and
      // manifest legitimately diverge: the manifest still lists it under the
      // pinned chapter and getAllAssignQuizzes still returns it. Comparing to
      // quiz.chapterId would reject an answer for a quiz we had just handed
      // them — measured against production as 21 pinned (learner,quiz) pairs
      // across 7 chapter-cases on 4 live accounts, worst case 7 of 12 quizzes
      // in a chapter, making that chapter unpassable.
      //
      // resolveChapterQuizIds is the SAME version-aware resolver grading uses
      // (gradeChapterQuizFromStoredAnswers), so what we accept here and what we
      // grade later agree by construction; it falls back to the live
      // non-archived set for unpinned learners.
      const servedQuizIds = await resolveChapterQuizIds(
        this.prisma,
        userId,
        body.chapterId,
      );
      if (!servedQuizIds.includes(body.quizId)) {
        throw new BadRequestException(
          'This quiz does not belong to the chapter you are viewing.',
        );
      }

      // Determine the promise for creating or updating the quizAnswer
      const quizAnswerPromise = existingQuizAnswer
        ? this.prisma.quizAnswer.update({
            where: {
              userId_quizId: {
                userId: userId,
                quizId: body.quizId,
              },
            },
            data: {
              chapterId: body.chapterId,
              answer: body.answer,
              isAnswerCorrect: body.answer == quiz.answer,
            },
          })
        : this.prisma.quizAnswer.create({
            data: {
              quizId: body.quizId,
              chapterId: body.chapterId,
              userId: userId,
              answer: body.answer,
              isAnswerCorrect: body.answer == quiz.answer,
            },
          });

      // Await the result of the create or update operation
      const quizAnswer = await quizAnswerPromise;

      return {
        message: 'Success',
        statusCode: 200,
        data: quizAnswer,
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

  async getUserQuizAnswers(
    userId: string,
    chapterId: string,
  ): Promise<ResponseDto> {
    try {
      const quizAnswer = await this.prisma.quizAnswer.findMany({
        where: {
          userId: userId,
          chapterId: chapterId,
        },
      });

      return {
        message: 'Success',
        statusCode: 200,
        data: quizAnswer,
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
}
