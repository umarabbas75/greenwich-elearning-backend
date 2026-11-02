import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CourseDeliveryMode, Prisma, Quiz } from '@prisma/client';
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
  gradeChapterQuizFromStoredAnswers,
  recordChapterAndModuleCompletionIfNeeded,
  resolveChapterQuizIds,
  resolvePassingCriteria,
} from '../utils/chapter-progression';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { assertImportedCourseTreeLocked } from '../utils/assert-imported-course-tree-locked';
import {
  LIVE_PLACEMENT,
  nextPlacementOrderIndex,
  PLACEMENT_ORDER,
  VISIBLE_PLACEMENT,
  withoutLegacyQuizFields,
} from './chapter-quiz';
import {
  calculateAutoScore,
  stripCorrectAnswerFields,
} from '../utils/question-grading';

/** Every quiz question — legacy or typed — is worth 1 mark; partial credit is
 *  a fraction of this. Keeps the report's sum(score)/sum(maxMarks) identical
 *  to the pre-existing correctCount/totalQuestions math for legacy quizzes. */
const QUIZ_QUESTION_MAX_MARKS = 1;

/** Interactive transactions here hold row locks across a few round trips to
 *  a remote database; Prisma's 5s default is too tight (same budget as the
 *  other interactive transactions in this codebase). */
const QUIZ_TX_OPTIONS = { maxWait: 5000, timeout: 15000 } as const;

/** The chapters a bank quiz is used in (placements not removed, chapter and
 *  unit not archived), with the module/course path the admin UI shows —
 *  oldest placement first. */
const QUIZ_CHAPTERS_INCLUDE = {
  placements: {
    where: VISIBLE_PLACEMENT,
    orderBy: { createdAt: 'asc' },
    select: {
      chapter: {
        select: {
          id: true,
          title: true,
          module: {
            select: {
              id: true,
              title: true,
              courseId: true,
              course: { select: { id: true, title: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.QuizInclude;

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
        // The editor shows where the (shared) quiz is used: an edit changes
        // it in every one of these chapters.
        const row = await this.prisma.quiz.findUnique({
          where: { id },
          include: QUIZ_CHAPTERS_INCLUDE,
        });
        if (row) {
          const { placements, ...rest } = row;
          quiz = {
            ...withoutLegacyQuizFields(rest),
            chapters: placements.map((p) => p.chapter),
          };
        } else {
          quiz = row;
        }
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
  async getAllQuizzes(
    role: string,
    query?: {
      search?: string;
      page?: number;
      limit?: number;
      /** Filter to quizzes used in a chapter of this course. */
      courseId?: string;
      /** Filter to quizzes used in this chapter. */
      chapterId?: string;
      /** Hide quizzes already used in this chapter (the assign picker). */
      excludeChapterId?: string;
      /** true = used in at least one chapter, false = in no chapter (bank only). */
      assigned?: boolean;
      /** Archived quizzes are kept-for-version-history rows, not live content —
       *  hidden by default everywhere (paginated or not) unless explicitly
       *  requested, so a soft-deleted quiz can never be picked as an
       *  assign-to-chapter option by accident. */
      includeArchived?: boolean;
    },
  ): Promise<ResponseDto> {
    try {
      // Pagination is opt-in — only applied when the caller passes page/limit.
      // Callers that fetch the whole bank today (e.g. the assign-to-chapter
      // dropdown) keep getting every row until they're updated to page too.
      const paginate = query?.page !== undefined || query?.limit !== undefined;
      const page = Math.max(1, query?.page ?? 1);
      const limit = Math.min(Math.max(query?.limit ?? 50, 1), 100);

      const conditions: Prisma.QuizWhereInput[] = [];
      if (query?.search) {
        conditions.push({
          question: { contains: query.search, mode: 'insensitive' },
        });
      }
      // "Used" = listed in a live chapter, matching what the list shows.
      if (query?.assigned === true) {
        conditions.push({ placements: { some: VISIBLE_PLACEMENT } });
      } else if (query?.assigned === false) {
        conditions.push({ placements: { none: VISIBLE_PLACEMENT } });
      }
      if (query?.courseId) {
        conditions.push({
          placements: {
            some: {
              isArchived: false,
              chapter: {
                isArchived: false,
                module: { isArchived: false, courseId: query.courseId },
              },
            },
          },
        });
      }
      if (query?.chapterId) {
        conditions.push({
          placements: {
            some: { chapterId: query.chapterId, isArchived: false },
          },
        });
      }
      if (query?.excludeChapterId) {
        conditions.push({
          placements: {
            none: { chapterId: query.excludeChapterId, isArchived: false },
          },
        });
      }
      if (!query?.includeArchived) {
        conditions.push({ isArchived: false });
      }

      const where: Prisma.QuizWhereInput = conditions.length
        ? { AND: conditions }
        : {};

      // Lets the admin list show every "used in: <chapter> (<course>)" / bank
      // status without a separate lookup, and lets deleteQuiz's confirm step
      // be pre-empted client-side instead of only learned after the DELETE call.
      let quizzes = [];
      let total: number | undefined;
      if (role == 'admin') {
        let rows: Array<
          Prisma.QuizGetPayload<{ include: typeof QUIZ_CHAPTERS_INCLUDE }>
        >;
        [rows, total] = await Promise.all([
          this.prisma.quiz.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: QUIZ_CHAPTERS_INCLUDE,
            ...(paginate ? { skip: (page - 1) * limit, take: limit } : {}),
          }),
          this.prisma.quiz.count({ where }),
        ]);
        quizzes = rows.map(({ placements, ...quiz }) => {
          const chapters = placements.map((p) => p.chapter);
          return {
            ...withoutLegacyQuizFields(quiz),
            // Every chapter the quiz is used in.
            chapters,
            // Deprecated single-chapter fields (first chapter) for clients
            // that predate shared quizzes.
            chapterId: chapters[0]?.id ?? null,
            chapter: chapters[0] ?? null,
          };
        });
      } else if (role == 'user') {
        [quizzes, total] = await Promise.all([
          this.prisma.quiz.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              question: true,
              options: true,
            },
            ...(paginate ? { skip: (page - 1) * limit, take: limit } : {}),
          }),
          this.prisma.quiz.count({ where }),
        ]);
      }

      return {
        message: 'Successfully fetch all Quizzes info',
        statusCode: 200,
        data: quizzes,
        total,
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
        type?: string | null;
        content?: any;
      }> = [];
      let userAnswers: Array<{
        quizId: string;
        answer: string | null;
        studentAnswer?: any;
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
        const placements = await this.prisma.chapterQuiz.findMany({
          where: { chapterId, ...LIVE_PLACEMENT },
          orderBy: PLACEMENT_ORDER,
          select: {
            quiz: {
              select: {
                id: true,
                question: true,
                options: true,
                answer: true,
                type: true,
                content: true,
              },
            },
          },
        });
        // Learners never get the legacy answer key (the pinned path above
        // strips it too); admins authored it.
        quizzes = placements.map(({ quiz }) => {
          if (role === 'admin') return quiz;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { answer, ...forLearner } = quiz;
          return forLearner;
        });
      }

      // Students never see the answer key: strip correct-answer fields from a
      // typed quiz's content before it goes out. Admin callers get the full
      // content (they authored it). Legacy `options`/`answer` stripping is
      // untouched — this only adds the new `type`/`content` behavior.
      const isStudentRole = role !== 'admin';
      const updatedUserQuizData = quizzes?.map((item) => {
        const userAnswer = userAnswers.find((ua) => ua.quizId === item.id);
        const isTyped = Boolean(item.type);
        return {
          ...item,
          content:
            isTyped && isStudentRole
              ? stripCorrectAnswerFields(item.content)
              : item.content,
          userAnswered: isTyped
            ? userAnswer?.studentAnswer != null
            : Boolean(userAnswer?.answer),
          isAnswerCorrect: userAnswer?.isAnswerCorrect,
          studentAnswer: userAnswer?.studentAnswer ?? null,
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
      // Chapter → course and existing progress are independent; fetch together
      // so the gate, grader, and completion roll-up can reuse the same context
      // instead of each re-reading chapter + enrollment.
      const [chapter, quizReport] = await Promise.all([
        this.prisma.chapter.findUnique({
          where: { id: chapterId },
          select: { module: { select: { courseId: true } } },
        }),
        this.prisma.quizProgress.findUnique({
          where: { userId_chapterId: { userId, chapterId } },
        }),
      ]);

      const courseId = chapter?.module?.courseId;
      if (!courseId) {
        throw new ForbiddenException('Chapter not found');
      }

      const enrollment = await this.prisma.userCourse.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: { enrolledVersionId: true },
      });
      const progressCtx = {
        courseId,
        enrolledVersionId: enrollment?.enrolledVersionId ?? null,
      };

      const [, grade] = await Promise.all([
        assertChapterAccessible(
          this.prisma,
          this.config,
          userId,
          chapterId,
          userEmail,
          progressCtx,
        ),
        gradeChapterQuizFromStoredAnswers(
          this.prisma,
          userId,
          chapterId,
          quizReport?.passingCriteria ?? null,
          progressCtx,
        ),
      ]);

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
      // checkContentCompletion swallows its own errors, but the chapter/module
      // rollup can still throw.
      try {
        await Promise.all([
          recordChapterAndModuleCompletionIfNeeded(
            this.prisma,
            userId,
            chapterId,
            progressCtx,
          ),
          stickyPassed
            ? this.courseCompletion.checkContentCompletion(userId, courseId)
            : Promise.resolve(),
        ]);
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
      // `type` set = multi-type quiz (content-graded, no legacy options/answer
      // needed); omitted = legacy single-correct-answer MCQ. QuizDto's
      // @ValidateIf already enforces which fields are required for each shape.
      const quiz = await this.prisma.quiz.create({
        data: body.type
          ? {
              question: body.question,
              options: [],
              type: body.type,
              content: body.content,
            }
          : {
              question: body.question,
              options: body.options,
              answer: body.answer,
            },
      });
      return {
        message: 'Successfully create quiz record',
        statusCode: 200,
        data: withoutLegacyQuizFields(quiz),
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

      const active = await this.prisma.chapterQuiz.findMany({
        where: { chapterId, ...LIVE_PLACEMENT },
        select: { quizId: true },
      });
      const activeIds = new Set(active.map((p) => p.quizId));

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

      // Order is per chapter: moving a shared quiz here leaves its position
      // in other chapters alone.
      await this.prisma.$transaction(
        items.map((item) =>
          this.prisma.chapterQuiz.update({
            where: { chapterId_quizId: { chapterId, quizId: item.id } },
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
      const result = await this.placeQuizzes(chapterId, [quizId], adminId);
      return {
        message: result.publishedVersion
          ? `Successfully assigned quiz to chapter (published v${result.publishedVersion.versionNumber})`
          : result.placedCount === 0
            ? 'Quiz is already in this chapter'
            : 'Successfully assign quiz to chapter',
        statusCode: 200,
        data: {},
        publishedVersion: result.publishedVersion ?? undefined,
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
   * Bulk variant of assignQuiz. Assigns every id in `quizIds` to `chapterId`
   * in one transaction and publishes at most one course version — looping
   * assignQuiz N times would instead publish N versions for a single admin
   * action (see autoPublishAfterQuizChange above).
   */
  async bulkAssignQuiz(
    chapterId: string,
    quizIds: string[],
    adminId?: string,
  ): Promise<ResponseDto> {
    try {
      const uniqueIds = Array.from(new Set(quizIds));
      if (uniqueIds.length === 0) {
        throw new Error('No quizzes provided');
      }
      const result = await this.placeQuizzes(chapterId, uniqueIds, adminId);
      const already = uniqueIds.length - result.placedCount;
      const alreadyNote =
        already > 0 ? `; ${already} already in this chapter` : '';

      return {
        message: result.publishedVersion
          ? `Successfully assigned ${result.placedCount} quiz(zes) to chapter (published v${result.publishedVersion.versionNumber})${alreadyNote}`
          : `Successfully assigned ${result.placedCount} quiz(zes) to chapter${alreadyNote}`,
        statusCode: 200,
        data: {
          chapterId,
          quizIds: uniqueIds,
          assignedCount: result.placedCount,
          alreadyInChapterCount: already,
        },
        publishedVersion: result.publishedVersion ?? undefined,
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
   * Put bank quizzes into a chapter. A quiz already used in another course
   * stays there too — this adds a placement, it never moves the quiz. Within
   * one course a quiz is in at most one chapter (version references and diffs
   * are per course): a quiz in another LIVE chapter of this course is
   * rejected, while one left in an archived chapter/unit of this course is
   * moved (that placement is marked removed), as assigning always did.
   * Quizzes already live in this chapter are left exactly as they are; the
   * rest are appended in the given order. A placement removed earlier is
   * revived rather than duplicated, and an archived (bank-deleted) quiz is
   * restored, as assigning it always did — which also brings it back in every
   * chapter it was still placed in, so those courses are published too.
   */
  private async placeQuizzes(
    chapterId: string,
    quizIds: string[],
    adminId?: string,
  ): Promise<{
    placedCount: number;
    publishedVersion: { versionNumber: number; versionId: string } | null;
  }> {
    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: {
        module: {
          select: {
            courseId: true,
            course: { select: { deliveryMode: true } },
          },
        },
      },
    });
    if (!chapter) {
      throw new Error('chapter not exist');
    }
    const courseId = chapter.module.courseId;
    await assertImportedCourseTreeLocked(
      this.prisma,
      { courseId },
      { deliveryMode: chapter.module.course?.deliveryMode },
    );

    const { placed, restored } = await this.prisma.$transaction(async (tx) => {
      // Serialise with a concurrent unassign/assign of the same quizzes, which
      // decide "used anywhere else?" from the same rows. Fixed lock order so
      // two overlapping bulk assigns cannot deadlock.
      await tx.$queryRaw`SELECT id FROM "quizzes" WHERE id IN (${Prisma.join(
        quizIds,
      )}) ORDER BY id FOR UPDATE`;
      const [existing, placementsHere, inOtherChapters] = await Promise.all([
        tx.quiz.findMany({
          where: { id: { in: quizIds } },
          select: { id: true, isArchived: true, question: true },
        }),
        tx.chapterQuiz.findMany({
          where: { chapterId, quizId: { in: quizIds } },
          select: { quizId: true, isArchived: true },
        }),
        tx.chapterQuiz.findMany({
          where: {
            quizId: { in: quizIds },
            chapterId: { not: chapterId },
            isArchived: false,
            chapter: { module: { courseId } },
          },
          select: {
            id: true,
            quizId: true,
            chapter: {
              select: {
                title: true,
                isArchived: true,
                module: { select: { isArchived: true } },
              },
            },
          },
        }),
      ]);
      const quizById = new Map(existing.map((q) => [q.id, q]));
      const missing = quizIds.filter((id) => !quizById.has(id));
      if (missing.length > 0) {
        throw new Error(
          missing.length === 1 && quizIds.length === 1
            ? 'quiz not exist'
            : `Quiz(zes) not found: ${missing.join(', ')}`,
        );
      }
      // Placements left in an archived chapter/unit of this course: the chapter
      // is gone from the course and the admin cannot reach it to unassign, so
      // the quiz moves from there (pinned learners keep the removed row).
      const stale = inOtherChapters.filter(
        (p) => p.chapter.isArchived || p.chapter.module.isArchived,
      );
      const blocking = inOtherChapters.filter((p) => !stale.includes(p));
      if (blocking.length > 0) {
        const list = blocking
          .map(
            (p) =>
              `"${quizById.get(p.quizId)?.question.slice(0, 60)}" (in "${
                p.chapter.title
              }")`,
          )
          .join(', ');
        throw new Error(
          `A quiz can be in only one chapter of a course. Unassign it from its current chapter first: ${list}`,
        );
      }

      const liveHere = new Set(
        placementsHere
          .filter((p) => !p.isArchived && !quizById.get(p.quizId)?.isArchived)
          .map((p) => p.quizId),
      );
      const toPlace = quizIds.filter((id) => !liveHere.has(id));
      if (toPlace.length === 0) {
        return { placed: [] as string[], restored: [] as string[] };
      }

      const now = new Date();
      if (stale.length > 0) {
        await tx.chapterQuiz.updateMany({
          where: { id: { in: stale.map((p) => p.id) } },
          data: { isArchived: true, archivedAt: now },
        });
      }
      const firstOrder = await nextPlacementOrderIndex(tx, chapterId, toPlace);
      const archivedQuizIds = toPlace.filter(
        (id) => quizById.get(id)?.isArchived,
      );
      // Assigning an archived quiz restores it (it was hidden everywhere).
      if (archivedQuizIds.length > 0) {
        await tx.quiz.updateMany({
          where: { id: { in: archivedQuizIds } },
          data: { isArchived: false, archivedAt: null },
        });
      }
      // One statement for the whole batch (a chapter can hold dozens of
      // questions): create each placement, or revive a removed one, appended
      // in the given order. Timestamps in UTC like Prisma writes them.
      const orders = toPlace.map((_, i) => firstOrder + i);
      await tx.$executeRaw`
        INSERT INTO "chapter_quizzes"
          ("id", "chapterId", "quizId", "orderIndex", "isArchived", "archivedAt", "createdAt", "updatedAt")
        SELECT gen_random_uuid()::text, ${chapterId}, t.quiz_id, t.order_index, false, NULL,
               (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
        FROM unnest(${toPlace}::text[], ${orders}::int[]) AS t(quiz_id, order_index)
        ON CONFLICT ("chapterId", "quizId") DO UPDATE
        SET "orderIndex" = EXCLUDED."orderIndex",
            "isArchived" = false,
            "archivedAt" = NULL,
            "updatedAt" = (now() AT TIME ZONE 'UTC')`;
      return { placed: toPlace, restored: archivedQuizIds };
    }, QUIZ_TX_OPTIONS);

    if (placed.length === 0) {
      return { placedCount: 0, publishedVersion: null };
    }
    const publishedVersion = await this.autoPublishAfterQuizChange(
      courseId,
      adminId,
      placed.length === 1
        ? `Assigned quiz to chapter "${chapter.title}"`
        : `Assigned ${placed.length} quiz(zes) to chapter "${chapter.title}"`,
    );
    // A restored quiz reappears wherever it was still placed.
    const otherCourses = new Set<string>();
    for (const quizId of restored) {
      for (const c of await this.findQuizCourses(quizId, {
        includeRemoved: false,
      })) {
        if (c.courseId !== courseId) otherCourses.add(c.courseId);
      }
    }
    for (const otherCourseId of otherCourses) {
      await this.autoPublishAfterQuizChange(
        otherCourseId,
        adminId,
        'Restored quiz',
      );
    }
    return { placedCount: placed.length, publishedVersion };
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
        include: {
          module: {
            select: {
              courseId: true,
              course: { select: { deliveryMode: true } },
            },
          },
        },
      });
      if (!chapter) {
        throw new Error('chapter not exist');
      }
      await assertImportedCourseTreeLocked(
        this.prisma,
        { courseId: chapter.module.courseId },
        { deliveryMode: chapter.module.course?.deliveryMode },
      );

      const references =
        await this.courseVersionService.getReferencingVersionsWithEnrollments(
          'quiz',
          quizId,
          chapter.module.courseId,
        );
      const referenced = references.versions.length > 0;

      // Only this chapter's placement is touched — a quiz shared with other
      // courses stays in them. Locked so a concurrent assign elsewhere cannot
      // slip between "is it used anywhere else?" and the archive below.
      const { archiveQuiz, otherLivePlacements } =
        await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "quizzes" WHERE id = ${quizId} FOR UPDATE`;
          const placement = await tx.chapterQuiz.findUnique({
            where: { chapterId_quizId: { chapterId, quizId } },
            select: { isArchived: true },
          });
          if (!placement || placement.isArchived) {
            throw new Error('This quiz is not assigned to this chapter');
          }
          // The placement is always kept, marked removed — never deleted. A
          // version published concurrently may already list it here, and the
          // row is what keeps its pinned learners' order and keeps a course
          // delete elsewhere from taking the quiz with it. Removed placements
          // are invisible everywhere live and are revived by re-assigning.
          const now = new Date();
          await tx.chapterQuiz.update({
            where: { chapterId_quizId: { chapterId, quizId } },
            data: { isArchived: true, archivedAt: now },
          });
          if (!referenced) {
            // Not pinned anywhere in this course: the quiz stays in the bank
            // (and in any other chapter that uses it).
            return { archiveQuiz: false, otherLivePlacements: 0 };
          }
          // A published version still lists the quiz under this chapter, so
          // pinned learners keep being served it. If no other chapter uses
          // the quiz, archive the quiz itself too — the same "hidden but
          // still served" state unassigning has always produced.
          const others = await tx.chapterQuiz.count({
            where: { quizId, isArchived: false, chapterId: { not: chapterId } },
          });
          if (others === 0) {
            await tx.quiz.update({
              where: { id: quizId },
              data: { isArchived: true, archivedAt: now },
            });
          }
          return { archiveQuiz: others === 0, otherLivePlacements: others };
        }, QUIZ_TX_OPTIONS);

      if (referenced) {
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
              quizArchived: archiveQuiz,
              stillUsedInOtherChapters: otherLivePlacements,
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
      // Content is shared: an edit changes the quiz in every chapter (and
      // course) that uses it, so every one of those courses must be editable.
      await this.assertQuizCoursesEditable(
        await this.findQuizCourses(id, { includeRemoved: true }),
      );
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      const updateQuiz = {};

      for (const [key, value] of Object.entries(body)) {
        updateQuiz[key] = value;
      }

      // Save the updated user
      const updated = await this.prisma.quiz.update({
        where: { id }, // Specify the unique identifier for the user you want to update
        data: updateQuiz, // Pass the modified user object
      });

      return {
        message: 'Successfully create quiz record',
        statusCode: 200,
        data: withoutLegacyQuizFields(updated),
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
        select: { id: true },
      });
      if (!quiz) {
        throw new Error('Course not found');
      }

      // Deleting from the bank removes the quiz from every chapter that uses
      // it, so every such course must be editable and gets a new version.
      const [allCourses, liveCourses] = await Promise.all([
        this.findQuizCourses(id, { includeRemoved: true }),
        this.findQuizCourses(id, { includeRemoved: false }),
      ]);
      await this.assertQuizCoursesEditable(allCourses);

      // Any course's version may pin it (a shared quiz, or one unassigned
      // before placements existed and so with no placement to name the
      // course) — scan every version.
      const references =
        await this.courseVersionService.getReferencingVersionsWithEnrollments(
          'quiz',
          id,
        );
      const referenced = references.versions.length > 0;
      if (referenced) {
        // Placements are kept: the quiz-level archive hides it everywhere and
        // a restore puts it back in the same chapters.
        const archived = await this.prisma.quiz.update({
          where: { id },
          data: { isArchived: true, archivedAt: new Date() },
        });
        let publishedVersion: Awaited<
          ReturnType<typeof this.autoPublishAfterQuizChange>
        > = null;
        for (const course of liveCourses) {
          const published = await this.autoPublishAfterQuizChange(
            course.courseId,
            adminId,
            'Archived quiz',
          );
          publishedVersion = publishedVersion ?? published;
          if (adminId) {
            await this.courseVersionService.writeAudit({
              adminId,
              action: 'ARCHIVE_QUIZ',
              targetType: 'Quiz',
              targetId: id,
              courseId: course.courseId,
              metadata: {
                via: 'deleteQuiz',
                usedInCourses: liveCourses.length,
                stillServedTo: references.stillServedTo,
                versions: references.versions.map((v) => ({
                  versionNumber: v.versionNumber,
                  status: v.status,
                  enrollmentCount: v.enrollmentCount,
                })),
              },
            });
          }
        }
        return {
          message: this.courseVersionService.buildArchiveMessage(
            'Quiz',
            references.stillServedTo,
            references.versions,
          ),
          statusCode: 200,
          data: withoutLegacyQuizFields(archived),
          outcome: 'archived',
          stillServedTo: references.stillServedTo,
          versionsReferencing: references.versions,
          publishedVersion: publishedVersion ?? undefined,
        };
      }

      // Placements cascade with the quiz.
      await this.prisma.quiz.delete({
        where: { id },
      });

      let publishedVersion: Awaited<
        ReturnType<typeof this.autoPublishAfterQuizChange>
      > = null;
      for (const course of liveCourses) {
        const published = await this.autoPublishAfterQuizChange(
          course.courseId,
          adminId,
          'Removed quiz',
        );
        publishedVersion = publishedVersion ?? published;
      }

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
   * Courses whose chapters use this quiz, one entry per course. With
   * `includeRemoved`, placements removed from a chapter but kept for pinned
   * learners count too (their course still serves the quiz).
   */
  private async findQuizCourses(
    quizId: string,
    opts: { includeRemoved: boolean },
  ): Promise<Array<{ courseId: string; deliveryMode: CourseDeliveryMode }>> {
    const placements = await this.prisma.chapterQuiz.findMany({
      where: { quizId, ...(opts.includeRemoved ? {} : { isArchived: false }) },
      orderBy: { createdAt: 'asc' },
      select: {
        chapter: {
          select: {
            module: {
              select: {
                courseId: true,
                course: { select: { deliveryMode: true } },
              },
            },
          },
        },
      },
    });
    const byCourse = new Map<
      string,
      { courseId: string; deliveryMode: CourseDeliveryMode }
    >();
    for (const p of placements) {
      const { courseId, course } = p.chapter.module;
      if (!byCourse.has(courseId)) {
        byCourse.set(courseId, { courseId, deliveryMode: course.deliveryMode });
      }
    }
    return Array.from(byCourse.values());
  }

  private async assertQuizCoursesEditable(
    courses: Array<{ courseId: string; deliveryMode: CourseDeliveryMode }>,
  ): Promise<void> {
    for (const course of courses) {
      await assertImportedCourseTreeLocked(
        this.prisma,
        { courseId: course.courseId },
        { deliveryMode: course.deliveryMode },
      );
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
        isArchived: true,
        question: true,
        // Chapters it is still placed in (a bank delete keeps placements, so
        // a restore puts it back there). Removed placements are not restored.
        placements: {
          where: { isArchived: false },
          orderBy: { createdAt: 'asc' },
          select: {
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
                    course: { select: { deliveryMode: true } },
                  },
                },
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
    const chapters = quiz.placements.map((p) => p.chapter);
    const courseIds = Array.from(
      new Set(chapters.map((c) => c.module.courseId)),
    );
    for (const chapter of chapters) {
      await assertImportedCourseTreeLocked(
        this.prisma,
        { courseId: chapter.module.courseId },
        { deliveryMode: chapter.module.course?.deliveryMode },
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

    // Parent-chain guard. Same shape as CourseService.restoreSection so the
    // FE's 409 handler stays identical across entity types. A quiz in no
    // chapter just returns to the bank; a quiz in several chapters is only
    // blocked when every one of them is archived (otherwise it reappears in
    // the live ones).
    const parentChain = (chapter: (typeof chapters)[number]) => {
      const chain: Array<{ entityType: string; id: string; title: string }> =
        [];
      if (chapter.module?.isArchived) {
        chain.push({
          entityType: 'module',
          id: chapter.module.id,
          title: chapter.module.title,
        });
      }
      if (chapter.isArchived) {
        chain.push({
          entityType: 'chapter',
          id: chapter.id,
          title: chapter.title,
        });
      }
      return chain;
    };
    const chains = chapters.map(parentChain);
    if (chains.length > 0 && chains.every((chain) => chain.length > 0)) {
      const chain = chains[0];
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

    const restored = await this.prisma.quiz.update({
      where: { id },
      data: { isArchived: false, archivedAt: null },
    });

    const courseId = courseIds[0] ?? null;
    // `publishedInLatest` is true only if the latest published version of
    // every course the quiz is placed in already includes it. For a quiz that
    // was unassigned-and-archived (no live placement) this is false —
    // publishing after the restore + reassign is the path that gets it back
    // into the live tree.
    let publishedInLatest = false;
    let latest: Awaited<
      ReturnType<typeof this.courseVersionService.getLatestPublishedVersion>
    > = null;
    for (const cid of courseIds) {
      latest = await this.courseVersionService.getLatestPublishedVersion(cid);
      const parsed = latest ? parseManifest(latest.manifest) : null;
      publishedInLatest = parsed
        ? isIdReferencedInManifest(parsed, 'quiz', id)
        : false;
      // Stop at the first course that still needs a publish, so the note
      // names that course's latest version.
      if (!publishedInLatest) break;
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
          usedInCourses: courseIds.length,
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
        ...withoutLegacyQuizFields(restored),
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
        // Per chapter: a quiz shared with another course has its own answer
        // row there.
        this.prisma.quizAnswer.findFirst({
          where: {
            quizId: body.quizId,
            userId: userId,
            chapterId: body.chapterId,
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

      // Grading branches on the QUIZ's own `type` (server-side truth), not on
      // which field the client happened to send — see CheckQuiz in ../dto.
      const isTyped = Boolean(quiz.type);
      let isAnswerCorrect: boolean;
      let systemScore: number | null = null;

      if (isTyped) {
        if (body.studentAnswer == null) {
          throw new BadRequestException(
            'studentAnswer is required for this quiz question',
          );
        }
        const score = calculateAutoScore(
          quiz.type,
          quiz.content,
          body.studentAnswer,
          QUIZ_QUESTION_MAX_MARKS,
        );
        systemScore = score ?? 0;
        isAnswerCorrect = systemScore >= QUIZ_QUESTION_MAX_MARKS;
      } else {
        if (!body.answer) {
          throw new BadRequestException(
            'answer is required for this quiz question',
          );
        }
        isAnswerCorrect = body.answer == quiz.answer;
      }

      // Determine the promise for creating or updating the quizAnswer. Legacy
      // and typed write disjoint field sets — kept as separate literals
      // (rather than one spread) so the legacy shape stays byte-identical to
      // before.
      const quizAnswerPromise = existingQuizAnswer
        ? this.prisma.quizAnswer.update({
            where: {
              userId_chapterId_quizId: {
                userId: userId,
                chapterId: body.chapterId,
                quizId: body.quizId,
              },
            },
            data: isTyped
              ? {
                  chapterId: body.chapterId,
                  studentAnswer: body.studentAnswer,
                  isAnswerCorrect,
                  systemScore,
                }
              : {
                  chapterId: body.chapterId,
                  answer: body.answer,
                  isAnswerCorrect,
                },
          })
        : this.prisma.quizAnswer.create({
            data: isTyped
              ? {
                  quizId: body.quizId,
                  chapterId: body.chapterId,
                  userId: userId,
                  studentAnswer: body.studentAnswer,
                  isAnswerCorrect,
                  systemScore,
                }
              : {
                  quizId: body.quizId,
                  chapterId: body.chapterId,
                  userId: userId,
                  answer: body.answer,
                  isAnswerCorrect,
                },
          });

      // Await the result of the create or update operation
      const quizAnswer = await quizAnswerPromise;

      return {
        message: 'Success',
        statusCode: 200,
        data: isTyped
          ? {
              ...quizAnswer,
              isAnswerCorrect,
              systemScore,
              maxMarks: QUIZ_QUESTION_MAX_MARKS,
            }
          : quizAnswer,
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
