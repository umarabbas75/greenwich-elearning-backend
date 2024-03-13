import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Chapter, Quiz } from '@prisma/client';
import {
  AssignQuizDto,
  QuizDto,
  ResponseDto,
  UpdateQuizDto,
} from '../dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QuizService {
  constructor(private prisma: PrismaService) {}
  async getQuiz(id: string): Promise<ResponseDto> {
    try {
      const quiz = await this.prisma.quiz.findUnique({ where: { id },select:{
        id:true,
        question:true,
        options:true
      } });
      if (!quiz) {
        throw new Error('quiz not found');
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
  async getAllQuizzes(): Promise<ResponseDto> {
    try {
      const courses = await this.prisma.quiz.findMany({
        // limit: 10,
        // offset: 10,
      });
      if (!(courses.length > 0)) {
        throw new Error('No Quizzes found');
      }
      return {
        message: 'Successfully fetch all Quizzes info',
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
  async createQuiz(body: QuizDto): Promise<ResponseDto> {
    try {
      const isCourseExist: Quiz = await this.prisma.quiz.findUnique({
        where: { question: body.question },
      });
      if (isCourseExist) {
        throw new Error('Course already exist with specified title');
      }
      const course: Quiz = await this.prisma.quiz.create({
        data: {
          question: body.question,
          options: body.options,
          answer: body.answer
        },
      });
      return {
        message: 'Successfully create course record',
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


  async assignQuiz(quizId:string,chapterId:string): Promise<ResponseDto> {
    try {
      const isCourseExist: Quiz = await this.prisma.quiz.findUnique({
        where: { id: quizId },
      });
      if (isCourseExist) {
        throw new Error('quiz not exist');
      }

      const isChapterExist: Chapter = await this.prisma.chapter.findUnique({
        where: { id: chapterId },
      });
      if (isChapterExist) {
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


  async getAllAssignQuizzes(chapterId:string): Promise<ResponseDto> {
    try {
      const chapter = await this.prisma.chapter.findUnique({
        where:{
          id:chapterId
        },

        include: { quizzes: true }
        // limit: 10,
        // offset: 10,
      });
      let quizzesWithOutAnswer = Promise.all(chapter.quizzes.map((quiz)=>{
        quiz.answer = "";
        return quiz
      }))
      return {
        message: 'Successfully fetch all Quizzes info related to chapter',
        statusCode: 200,
        data: quizzesWithOutAnswer,
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
      const isCourseExist: Quiz = await this.prisma.quiz.findUnique({
        where: { id: id },
      });
      if (isCourseExist) {
        throw new Error('Quizzes already exist with specified title');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      let updateCourse = {};

      for (const [key, value] of Object.entries(body)) {
        updateCourse[key] = value;
      }

      // Save the updated user
      const updatedCourse = await this.prisma.quiz.update({
        where: { id }, // Specify the unique identifier for the user you want to update
        data: updateCourse, // Pass the modified user object
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
      const user = await this.prisma.quiz.findUnique({
        where: { id },
      });
      if (!user) {
        throw new Error('Course not found');
      }

      await this.prisma.quiz.delete({
        where: { id },
      });

      return {
        message: 'Successfully deleted quiz record',
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

  async checkQuiz(body:{quizId:string,userId:string,answer:string}): Promise<ResponseDto> {
    try {
      const quiz: Quiz = await this.prisma.quiz.findUnique({
        where: { id: body.quizId },
      });

      const user = await this.prisma.user.findUnique({
        where: { id: body.userId },
      });
      
      if (!quiz || !user) {
        throw new Error('Quiz or user not found');
      }

    let quizAnswer = await this.prisma.quizAnswer.findFirst({
      where:{
      quizId:body.quizId,
      userId:body.userId
      }
    })
    if(!quizAnswer){  
    await this.prisma.quizAnswer.create({
      data: {
        quizId:body.quizId,
        userId:body.userId,
        answer:body.answer,
        isAnswerCorrect:body.answer == quiz.answer
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
}