import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
// import { Forum } from '@prisma/client';
// import {
//   QuizDto,
//   ResponseDto,
// } from '../dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationService {
  constructor(private prisma: PrismaService) {}

  async getUserNotifications(userId: string): Promise<any> {
    try {
      const notifications = await this.prisma.notification.findMany({
        where: {
          userId: userId,
        },
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          thread: {
            select: {
              title: true,
            },
          },
          commenter: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              photo: true,
            },
          },
        },
      });

      return {
        message: 'Successfully fetched all notifications for the user',
        statusCode: 200,
        data: notifications,
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
  //New method to create notifications for all users
  async notifyAllUsersForNewThread(
    threadId: string,
    commenterId: string,
  ): Promise<void> {
    try {
      const users = await this.prisma.user.findMany({
        select: {
          id: true,
        },
      });

      const notifications = users.map((user) => ({
        userId: user.id,
        threadId,
        commenterId, // Include the commenterId
        message: 'A new thread has been created by the admin.',
      }));

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

  async markNotificationAsRead(notificationId: string): Promise<any> {
    try {
      const updatedNotification = await this.prisma.notification.update({
        where: { id: notificationId },
        data: { isRead: true },
      });

      return {
        message: 'Notification marked as read successfully',
        statusCode: 200,
        data: updatedNotification,
      };
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
}
