import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Chapter, Quiz } from '@prisma/client';
import {
  AssignQuizDto,
  CheckQuiz,
  QuizDto,
  ResponseDto,
  UpdateQuizDto,
} from '../dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QuizService {
  constructor(private prisma: PrismaService) {}
  async getQuiz(id: string, role: string): Promise<ResponseDto> {
    try {
      let quiz ={};
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
      let quizzes =[];
      if (role == 'admin') {
        quizzes = await this.prisma.quiz.findMany({
          
          // limit: 10,
          // offset: 10,
        });
      } else if (role == 'user') {
         quizzes = await this.prisma.quiz.findMany({
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
  ): Promise<ResponseDto> {
    try {
      let chapter
      if (role == 'admin') {
        chapter = await this.prisma.chapter.findUnique({
          where: {
            id: chapterId,
          },
  
         
          // limit: 10,
          // offset: 10,
        });
      } else if (role == 'user') {
        chapter = await this.prisma.chapter.findUnique({
          where: {
            id: chapterId,
          },
  
          include: {
            quizzes: {
              select: {
                id: true,
                question: true,
                options: true,
              },
            },
          },
  
          // limit: 10,
          // offset: 10,
        });
      }
     
    
      return {
        message: 'Successfully fetch all Quizzes info related to chapter',
        statusCode: 200,
        data: chapter?.quizzes || [],
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

  async updateQuiz(id: string, body: UpdateQuizDto): Promise<ResponseDto> {
    try {
      const isQuizExist: Quiz = await this.prisma.quiz.findUnique({
        where: { id: id },
      });
      if (isQuizExist) {
        throw new Error('Quizzes already exist with specified title');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      let updateQuiz = {};

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

  async checkQuiz(userId: string, body: CheckQuiz): Promise<ResponseDto> {
    try {
      const quiz: Quiz = await this.prisma.quiz.findUnique({
        where: { id: body.quizId },
      });

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!quiz || !user) {
        throw new Error('Quiz or user not found');
      }

      let quizAnswer = await this.prisma.quizAnswer.findFirst({
        where: {
          quizId: body.quizId,
          userId: userId,
        },
      });
      if (!quizAnswer) {
        await this.prisma.quizAnswer.create({
          data: {
            quizId: body.quizId,
            chapterId: body.chapterId,
            userId: userId,
            answer: body.answer,
            isAnswerCorrect: body.answer == quiz.answer,
          },
        });
      }
      return {
        message: 'Success',
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
  async getUserQuizAnswers(userId: string,chapterId:string): Promise<ResponseDto> {
    try {
      

      let quizAnswer = await this.prisma.quizAnswer.findMany({
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
