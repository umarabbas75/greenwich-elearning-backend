import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Chapter, Prisma, Quiz } from '@prisma/client';
import { CheckQuiz, QuizDto, ResponseDto, UpdateQuizDto } from '../dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QuizService {
  constructor(private prisma: PrismaService) {}
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
  ): Promise<ResponseDto> {
    console.log({ role });
    try {
      const chapter = await this.prisma.chapter.findUnique({
        where: {
          id: chapterId,
        },

        include: {
          quizzes: {
            select: {
              id: true,
              question: true,
              options: true,
              answer: true,
            },
          },
        },
      });

      const userAnswers = await this.prisma.quizAnswer.findMany({
        where: {
          userId,
          chapterId,
        },
      });

      const updatedUserQuizData = chapter?.quizzes?.map((item) => {
        const userAnswer = userAnswers.find(
          (userAnswer) => userAnswer.quizId === item.id,
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

  async getAllQuizReport(
   
  ): Promise<ResponseDto> {
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
    totalAttempts: number,
    isPassed: boolean,
    score: any,
    passingCriteria: any,
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
      let newQuizProgress = null;
      if (!quizReport) {
        newQuizProgress = await this.prisma.quizProgress.create({
          data: {
            userId: userId,
            chapterId: chapterId,
            totalAttempts: totalAttempts,
            isPassed: isPassed,
            score: score,
            passingCriteria: passingCriteria,
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
            totalAttempts: (quizReport.totalAttempts ?? 0) + totalAttempts,
            isPassed: isPassed,
            score: score,
          },
        });
      }
      console.log({ newQuizProgress });
      return {
        message: 'Successfully fetch all Quizzes info related to chapter',
        statusCode: 200,
        data: newQuizProgress,
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

  async retakeChapterQuiz(
    userId: string,
    chapterId: string,
  ): Promise<ResponseDto> {
    try {
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

  async assignQuiz(quizId: string, chapterId: string): Promise<ResponseDto> {
    try {
      const isQuizExist: Quiz = await this.prisma.quiz.findUnique({
        where: { id: quizId },
      });
      if (!isQuizExist) {
        throw new Error('quiz not exist');
      }

      const isChapterExist: Chapter = await this.prisma.chapter.findUnique({
        where: { id: chapterId },
      });
      if (!isChapterExist) {
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
      return {
        message: 'Successfully assign quiz to chapter',
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
  async unAssignQuiz(quizId: string, chapterId: string): Promise<ResponseDto> {
    try {
      const isQuizExist: Quiz = await this.prisma.quiz.findUnique({
        where: { id: quizId },
      });
      if (!isQuizExist) {
        throw new Error('quiz not exist');
      }

      const isChapterExist: Chapter = await this.prisma.chapter.findUnique({
        where: { id: chapterId },
      });
      if (!isChapterExist) {
        throw new Error('chapter not exist');
      }

      // Remove the course from the user's list of assigned courses
      await this.prisma.chapter.update({
        where: { id: chapterId },
        data: {
          quizzes: {
            disconnect: { id: quizId },
          },
        },
      });
      return {
        message: 'Successfully unassigned quiz to module',
        statusCode: 200,
        data: {},
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
  async deleteQuiz(id: string): Promise<ResponseDto> {
    try {
      const quiz = await this.prisma.quiz.findUnique({
        where: { id },
      });
      if (!quiz) {
        throw new Error('Course not found');
      }

      await this.prisma.quiz.delete({
        where: { id },
      });

      return {
        message: 'Successfully deleted quiz record',
        statusCode: 200,
        data: {},
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

  async checkQuiz(userId: string, body: CheckQuiz): Promise<ResponseDto> {
    try {
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
