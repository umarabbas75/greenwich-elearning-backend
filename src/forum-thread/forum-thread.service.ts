import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
// import { Forum } from '@prisma/client';
// import {
//   QuizDto,
//   ResponseDto,
// } from '../dto';
import { PrismaService } from '../prisma/prisma.service';
import { ForumThread, Prisma } from '@prisma/client';

@Injectable()
export class ForumThreadService {
  constructor(private prisma: PrismaService) {}

  async getAllForumThreads(user: any): Promise<any> {
    try {
      let forums = {};
      if (user?.role === 'user') {
        forums = await this.prisma.forumThread.findMany({
          orderBy: {
            createdAt: 'desc',
          },
          where: {
            status: 'active',
          },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
            ForumComment: {
              select: {
                id: true,
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                  },
                },
                createdAt: true,
              },
              orderBy: {
                createdAt: Prisma.SortOrder.desc, // Order comments by createdAt in descending order
              },
            },
          },
        });
      } else {
        forums = await this.prisma.forumThread.findMany({
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
            ForumComment: {
              select: {
                id: true,
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                  },
                },
                createdAt: true,
              },
              orderBy: {
                createdAt: Prisma.SortOrder.desc, // Order comments by createdAt in descending order
              },
            },
          },
        });
      }

      return {
        message: 'Successfully fetch all forum threads',
        statusCode: 200,
        data: forums,
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

  async createForumThread(body: any, userId: string): Promise<any> {
    try {
      await this.prisma.forumThread.create({
        data: {
          title: body.title,
          content: body.content,
          userId: userId,
          status: 'inActive',
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

  async updateForumThread(forumThreadId: string, body: any): Promise<any> {
    try {
      const existingForumThread: ForumThread =
        await this.prisma.forumThread.findUnique({
          where: { id: forumThreadId },
        });
      if (!existingForumThread) {
        throw new Error('Forum thread not found');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      const updateForumThread = {};

      for (const [key, value] of Object.entries(body)) {
        updateForumThread[key] = value;
      }

      // Save the updated user
      const updatedForumThread = await this.prisma.forumThread.update({
        where: { id: forumThreadId }, // Specify the unique identifier for the user you want to update
        data: updateForumThread, // Pass the modified user object
      });

      return {
        message: 'Successfully updated forum record',
        statusCode: 200,
        data: updatedForumThread,
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

  async deleteForumThread(forumThreadId: any): Promise<any> {
    try {
      const quiz: ForumThread = await this.prisma.forumThread.findUnique({
        where: { id: forumThreadId },
      });
      if (!quiz) {
        throw new Error('Forum Thread not found');
      }

      await this.prisma.forumThread.delete({
        where: { id: forumThreadId },
      });

      return {
        message: 'Successfully deleted forum thread record',
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
              'Cannot delete course because it is associated with other records.',
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

  async getForumThread(forumThreadId: any): Promise<any> {
    try {
      const forum = await this.prisma.forumThread.findUnique({
        where: { id: forumThreadId },
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
        message: 'Successfully fetch Quiz info',
        statusCode: 200,
        data: forum,
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
