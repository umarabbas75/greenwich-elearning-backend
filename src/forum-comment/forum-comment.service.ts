import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
// import { Forum } from '@prisma/client';
// import {
//   QuizDto,
//   ResponseDto,
// } from '../dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ForumCommentService {
  constructor(private prisma: PrismaService) {}

  async createForumThreadComment(body: any, userId: string): Promise<any> {
    try {
      // Check if the user exists
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        throw new Error('User not found');
      }

      // Check if the thread exists
      const thread = await this.prisma.forumThread.findUnique({
        where: { id: body?.threadId },
      });
      if (!thread) {
        throw new Error('Forum thread not found');
      }

      await this.prisma.forumComment.create({
        data: {
          content: body?.content,
          user: { connect: { id: userId } }, // Connects the user by userId
          thread: { connect: { id: body.threadId } }, // Connects the thread by threadId
        },
      });

      // Fetch all subscribed users except the commenter
      const subscribedUsers = await this.prisma.threadSubscription.findMany({
        where: {
          threadId: body.threadId,
          userId: { not: userId },
        },
        select: {
          userId: true,
        },
      });

      // Prepare notifications
      const notifications = subscribedUsers.map((sub) => ({
        userId: sub.userId,
        threadId: body.threadId,
        message: body.content,
        commenterId: userId,
      }));
      console.log({ notifications, subscribedUsers });

      await this.prisma.notification.createMany({
        data: notifications,
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

  async getForumCommentsByThreadId(threadId: string) {
    const comments = await this.prisma.forumComment.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      where: {
        threadId,
      },
      include: {
        user: true, // Include user details for each comment
      },
    });

    return {
      message: 'Successfully fetch all forum comments',
      statusCode: 200,
      data: comments,
    };
  }

  async getAllForumThreads(): Promise<any> {
    try {
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
        },
      });

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

  async updateForumThreadComment(
    forumThreadId: string,
    body: any,
  ): Promise<any> {
    try {
      const existingForumThread = await this.prisma.forumComment.findUnique({
        where: { id: forumThreadId },
      });
      if (!existingForumThread) {
        throw new Error('Forum comment not found');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      const updateForumThread = {};

      for (const [key, value] of Object.entries(body)) {
        updateForumThread[key] = value;
      }

      // Save the updated user
      const updatedForumThread = await this.prisma.forumComment.update({
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

  async deleteForumThreadComment(forumThreadId: any): Promise<any> {
    try {
      const quiz = await this.prisma.forumComment.findUnique({
        where: { id: forumThreadId },
      });
      if (!quiz) {
        throw new Error('Forum Thread not found');
      }

      await this.prisma.forumComment.delete({
        where: { id: forumThreadId },
      });

      return {
        message: 'Successfully deleted forum thread comment record',
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
