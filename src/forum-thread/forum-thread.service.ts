import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ForumThread, ForumViewScope, Prisma } from '@prisma/client';
import { NotificationService } from '../notifications/notification.service';

@Injectable()
export class ForumThreadService {
  private static readonly logger = new Logger(ForumThreadService.name);

  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
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
      const [favoriteThreads, subscribedThreads, forums] = await Promise.all([
        this.prisma.favoriteForumThread.findMany({
          where: {
            userId: user.id,
          },
          select: {
            threadId: true,
          },
        }),
        this.prisma.threadSubscription.findMany({
          where: {
            userId: user.id,
          },
          select: {
            threadId: true,
          },
        }),
        this.prisma.forumThread.findMany({
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                photo: true,
              },
            },
            course: {
              select: {
                id: true,
                title: true,
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
                    photo: true,
                  },
                },
                createdAt: true,
              },
              orderBy: {
                createdAt: Prisma.SortOrder.desc,
              },
            },
          },
          where:
            user?.role === 'user'
              ? {
                  status: 'active',
                  OR: [
                    { courseId: null },
                    {
                      course: {
                        users: { some: { userId: user.id, isActive: true } },
                      },
                    },
                  ],
                }
              : undefined,
        }),
      ]);

      void this.recordForumView(user.id, { scope: ForumViewScope.list });

      const favoriteThreadIds = new Set(
        favoriteThreads.map((fav) => fav.threadId),
      );

      const subscribedThreadIds = new Set(
        subscribedThreads.map((sub) => sub.threadId),
      );

      // Step 5: Add `isFavorite`, `isSubscribed`, and `commenters` properties to each thread and sort favorite threads on top
      const sortedForums = forums
        .map((thread) => ({
          ...thread,
          isFavorite: favoriteThreadIds.has(thread.id),
          isSubscribed: subscribedThreadIds.has(thread.id),
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
      if (!body.courseId) {
        throw new Error('courseId is required');
      }
      const newThread = await this.prisma.forumThread.create({
        data: {
          title: body.title,
          content: body.content,
          userId: userId,
          courseId: body.courseId,
          status: 'inActive',
        },
      });
      console.log({ newThread });

      // Notification fan-out happens later when the thread is activated
      // (status: inActive → active). See updateForumThread below.

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

      if (shouldSendNotification) {
        const admin = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, firstName: true, lastName: true },
        });
        if (admin) {
          await this.notificationService.notifyAllUsersForNewThread({
            threadId: forumThreadId,
            threadTitle: existingForumThread.title,
            courseId: existingForumThread.courseId,
            creator: admin,
          });
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

  async getForumThread(forumThreadId: string, userId?: string): Promise<any> {
    try {
      const forum = await this.prisma.forumThread.findUnique({
        where: { id: forumThreadId },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              photo: true,
            },
          },
          course: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });

      if (userId && forum) {
        void this.recordForumView(userId, {
          scope: ForumViewScope.thread,
          threadId: forum.id,
          courseId: forum.courseId,
        });
      }

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

  /**
   * Append a forum view event. Best-effort: never throws into the caller.
   * List views are throttled to once per user per hour to avoid noisy refetches.
   */
  private async recordForumView(
    userId: string,
    args: {
      scope: ForumViewScope;
      threadId?: string | null;
      courseId?: string | null;
    },
  ): Promise<void> {
    try {
      if (args.scope === ForumViewScope.list) {
        const oneHourAgo = new Date(Date.now() - 3_600_000);
        const recent = await this.prisma.forumViewEvent.findFirst({
          where: {
            userId,
            scope: ForumViewScope.list,
            createdAt: { gte: oneHourAgo },
          },
          select: { id: true },
        });
        if (recent) return;
      }

      await this.prisma.forumViewEvent.create({
        data: {
          userId,
          scope: args.scope,
          threadId: args.threadId ?? null,
          courseId: args.courseId ?? null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ForumThreadService.logger.warn(
        `Failed to record forum view for user ${userId}: ${message}`,
      );
    }
  }
}
