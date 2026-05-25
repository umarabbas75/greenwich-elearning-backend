import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';

/** Truncate to N chars after stripping HTML-ish tags. Cheap defensive scrub
 * — comment content is plain text today but this protects against future
 * rich-text edits leaking markup into notification payloads. */
function buildExcerpt(content: string, maxLen = 140): string {
  return content.replace(/<[^>]*>/g, '').slice(0, maxLen);
}

@Injectable()
export class ForumCommentService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  async createForumThreadComment(body: any, userId: string): Promise<any> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!user) throw new Error('User not found');

      const thread = await this.prisma.forumThread.findUnique({
        where: { id: body?.threadId },
        select: { id: true, title: true },
      });
      if (!thread) throw new Error('Forum thread not found');

      const comment = await this.prisma.forumComment.create({
        data: {
          content: body?.content,
          user: { connect: { id: userId } },
          thread: { connect: { id: body.threadId } },
        },
        select: { id: true },
      });

      const subscribedUsers = await this.prisma.threadSubscription.findMany({
        where: { threadId: body.threadId, userId: { not: userId } },
        select: { userId: true },
      });

      await this.notificationService.createNotificationForMany({
        userIds: subscribedUsers.map((s) => s.userId),
        type: NotificationType.FORUM_COMMENT,
        message: body.content,
        payload: {
          threadId: thread.id,
          threadTitle: thread.title,
          commentId: comment.id,
          commentExcerpt: buildExcerpt(body.content ?? ''),
          commenterFirstName: user.firstName,
          commenterLastName: user.lastName,
        },
        groupKey: `forum-comment:${thread.id}`,
        threadId: thread.id,
        commenterId: userId,
        dedupeKeyFor: (recipientId) =>
          `comment:${comment.id}:${recipientId}`,
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
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            photo: true,
            timezone: true,
            createdAt: true,
            updatedAt: true,
            role: true,
          },
        }, // Include user details for each comment
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
