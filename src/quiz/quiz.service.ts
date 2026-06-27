import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Chapter, Prisma, Quiz } from '@prisma/client';
import { CheckQuiz, QuizDto, ResponseDto, UpdateQuizDto } from '../dto';
import { PrismaService } from '../prisma/prisma.service';
import { CourseVersionService } from '../course-version/course-version.service';
import {
  assertChapterAccessible,
  enrichQuizProgressReport,
  gradeChapterQuizFromStoredAnswers,
  resolvePassingCriteria,
} from '../utils/chapter-progression';

@Injectable()
export class QuizService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private courseVersionService: CourseVersionService,
  ) {}
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
      if (role === 'user') {
        await assertChapterAccessible(
          this.prisma,
          this.config,
          userId,
          chapterId,
          userEmail,
        );
      }

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

      if (courseId && role === 'user') {
        const versionQuizzes =
          await this.courseVersionService.getVersionQuizzesForChapter(
            userId,
            courseId,
            chapterId,
            false,
          );
        if (versionQuizzes !== null) {
          quizzes = versionQuizzes;
        }
      }

      if (quizzes.length === 0) {
        const chapter = await this.prisma.chapter.findUnique({
          where: { id: chapterId },
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
        });
        quizzes = chapter?.quizzes ?? [];
      }

      const userAnswers = await this.prisma.quizAnswer.findMany({
        where: {
          userId,
          chapterId,
        },
      });

      const updatedUserQuizData = quizzes?.map((item) => {
        const userAnswer = userAnswers.find(
          (ua) => ua.quizId === item.id,
        );
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

      await this.prisma.chapter.update({
        where: { id: chapterId },
        data: {
          quizzes: {
            connect: { id: quizId },
          },
        },
      });

      const publishedVersion =
        await this.courseVersionService.autoPublishAfterStructuralChange(
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

      const referenced =
        await this.courseVersionService.isReferencedByAnyVersion('quiz', quizId);
      if (referenced) {
        await this.prisma.quiz.update({
          where: { id: quizId },
          data: { isArchived: true, chapterId: null },
        });
        const publishedVersion =
          await this.courseVersionService.autoPublishAfterStructuralChange(
            chapter.module.courseId,
            adminId,
            `Archived quiz from chapter "${chapter.title}"`,
          );
        return {
          message:
            'Quiz is part of a published course version and was archived instead of unassigned',
          statusCode: 200,
          data: {},
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

      const publishedVersion =
        await this.courseVersionService.autoPublishAfterStructuralChange(
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

      await this.courseVersionService.syncQuizToLatestVersion(id);

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

      const referenced =
        await this.courseVersionService.isReferencedByAnyVersion('quiz', id);
      if (referenced) {
        const archived = await this.prisma.quiz.update({
          where: { id },
          data: { isArchived: true },
        });
        const publishedVersion = courseId
          ? await this.courseVersionService.autoPublishAfterStructuralChange(
              courseId,
              adminId,
              'Archived quiz',
            )
          : null;
        return {
          message:
            'Quiz is part of a published course version and was archived instead of deleted',
          statusCode: 200,
          data: archived,
          publishedVersion: publishedVersion ?? undefined,
        };
      }

      await this.prisma.quiz.delete({
        where: { id },
      });

      const publishedVersion = courseId
        ? await this.courseVersionService.autoPublishAfterStructuralChange(
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
