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

  async createFavoriteForumThread(body: any, userId: string): Promise<any> {
    try {
      const favorite = await this.prisma.favoriteForumThread.create({
        data: {
          userId,
          threadId: body.threadId,
        },
      });
      return {
        message: 'Successfully favorite the thread for user',
        statusCode: 200,
        data: favorite,
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

  async unFavoriteForumThread(params: any, userId: string): Promise<any> {
    try {
      const favorite = await this.prisma.favoriteForumThread.delete({
        where: {
          userId_threadId: {
            userId,
            threadId: params.id,
          },
        },
      });
      return {
        message: 'Successfully unfavorite the thread for user',
        statusCode: 200,
        data: favorite,
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

  async getAllForumThreads(user: any): Promise<any> {
    try {
      // Step 1: Fetch favorite thread IDs for the user
      const favoriteThreads = user
        ? await this.prisma.favoriteForumThread.findMany({
            where: {
              userId: user.id,
            },
            select: {
              threadId: true,
            },
          })
        : [];

      const favoriteThreadIds = new Set(
        favoriteThreads.map((fav) => fav.threadId),
      );

      // Step 2: Fetch all forum threads
      const forums = await this.prisma.forumThread.findMany({
        orderBy: {
          createdAt: 'desc',
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
              createdAt: Prisma.SortOrder.desc,
            },
          },
        },
        where: user?.role === 'user' ? { status: 'active' } : undefined,
      });

      // Step 3: Add `isFavorite` property to each thread and sort favorite threads on top
      const sortedForums = forums
        .map((thread) => ({
          ...thread,
          isFavorite: favoriteThreadIds.has(thread.id),
        }))
        .sort((a, b) => {
          if (a.isFavorite && !b.isFavorite) {
            return -1;
          }
          if (!a.isFavorite && b.isFavorite) {
            return 1;
          }
          return 0;
        });

      return {
        message: 'Successfully fetched all forum threads',
        statusCode: 200,
        data: sortedForums,
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
