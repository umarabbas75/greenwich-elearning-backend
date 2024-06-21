import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
// import { Forum } from '@prisma/client';
// import {
//   QuizDto,
//   ResponseDto,
// } from '../dto';
import { PrismaService } from '../prisma/prisma.service';
import { ForumThread, Prisma } from '@prisma/client';
// import { NotificationService } from 'src/notifiications/notification.service';

@Injectable()
export class ForumThreadService {
  constructor(
    private prisma: PrismaService,
    // private notificationService: NotificationService,
  ) {}

  async subscribeForumThread(body: any, userId: string): Promise<any> {
    try {
      const subscribe = await this.prisma.threadSubscription.create({
        data: {
          userId,
          threadId: body.threadId,
        },
      });
      return {
        message: 'Successfully subscribe the thread for user',
        statusCode: 200,
        data: subscribe,
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

  async unSubscribeForumThread(params: any, userId: string): Promise<any> {
    try {
      const subscribe = await this.prisma.threadSubscription.delete({
        where: {
          userId_threadId: {
            userId,
            threadId: params.id,
          },
        },
      });
      return {
        message: 'Successfully unsubscribe the thread for user',
        statusCode: 200,
        data: subscribe,
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

      // Step 2: Fetch subscribed thread IDs for the user
      const subscribedThreads = user
        ? await this.prisma.threadSubscription.findMany({
            where: {
              userId: user.id,
            },
            select: {
              threadId: true,
            },
          })
        : [];

      const subscribedThreadIds = new Set(
        subscribedThreads.map((sub) => sub.threadId),
      );

      // Step 3: Fetch all forum threads with comments and commenters
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

      // Step 4: Fetch all unique commenters for each thread
      const threadIds = forums.map((forum) => forum.id);
      const allComments = await this.prisma.forumComment.findMany({
        where: {
          threadId: {
            in: threadIds,
          },
        },
        select: {
          threadId: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      // Group commenters by threadId
      const commentersByThread: Record<
        string,
        Set<{ id: string; firstName: string; lastName: string }>
      > = {};
      allComments.forEach((comment) => {
        if (!commentersByThread[comment.threadId]) {
          commentersByThread[comment.threadId] = new Set();
        }
        commentersByThread[comment.threadId].add(comment.user);
      });

      // Step 5: Add `isFavorite`, `isSubscribed`, and `commenters` properties to each thread and sort favorite threads on top
      const sortedForums = forums
        .map((thread) => ({
          ...thread,
          isFavorite: favoriteThreadIds.has(thread.id),
          isSubscribed: subscribedThreadIds.has(thread.id),
          commenters: Array.from(commentersByThread[thread.id] || []),
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
      const newThread = await this.prisma.forumThread.create({
        data: {
          title: body.title,
          content: body.content,
          userId: userId,
          status: 'inActive',
        },
      });
      console.log({ newThread });

      //Notify all users if the thread is created by an admin

      // await this.notificationService.notifyAllUsersForNewThread(
      //   newThread.id,
      //   userId,
      // );

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

  async updateForumThread(
    forumThreadId: string,
    body: any,
    userId: any,
  ): Promise<any> {
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

      // Check if status is being changed from 'inactive' to 'active' and if notification has not been sent
      const statusChangingToActive =
        existingForumThread.status === 'inActive' &&
        updateForumThread['status'] === 'active';

      const shouldSendNotification =
        statusChangingToActive && !existingForumThread.notificationSent;

      if (shouldSendNotification) {
        updateForumThread['notificationSent'] = true;
      }
      // Save the updated user
      const updatedForumThread = await this.prisma.forumThread.update({
        where: { id: forumThreadId }, // Specify the unique identifier for the user you want to update
        data: updateForumThread, // Pass the modified user object
      });

      //If status is changing to active, notify users
      if (shouldSendNotification) {
        // Call a method to notify users about the thread becoming active
        try {
          const users = await this.prisma.user.findMany({
            select: {
              id: true,
            },
          });
          const notifications = users.map((user) => ({
            userId: user.id,
            threadId: forumThreadId,
            commenterId: userId, // Include the commenterId
            message: 'A new thread has been created by the admin.',
          }));
          console.log({ notifications });
          await this.prisma.notification.createMany({
            data: notifications,
          });
        } catch (error) {
          throw new HttpException(
            {
              status: HttpStatus.FORBIDDEN,
              error: error.message || 'Something went wrong',
            },
            HttpStatus.FORBIDDEN,
            {
              cause: error,
            },
          );
        }
      }

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
