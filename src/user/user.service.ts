import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { ResponseDto, BodyDto, BodyUpdateDto, ChangePasswordDto } from '../dto';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async getUser(id: string): Promise<ResponseDto> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          photo: true,
          role: true,
          createdAt: true,
          updatedAt: true,
          timezone: true,
        },
      });
      if (!user) {
        throw new Error('User not found');
      }
      return {
        message: 'Successfully fetch user info',
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
  async getAllUsers(): Promise<ResponseDto> {
    try {
      const users = await this.prisma.user.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          UserCourse: {
            include: {
              course: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                },
              },
            },
          },
        },
      });

      if (users.length === 0) {
        throw new Error('No users found');
      }

      // Transform data to make it more user-friendly (optional)
      const transformedUsers = users.map((user) => ({
        ...user,
        courses: user.UserCourse.map((userCourse) => userCourse.course),
      }));

      return {
        message: 'Successfully fetched all users info',
        statusCode: 200,
        data: transformedUsers,
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

  async createUser(body: BodyDto): Promise<ResponseDto> {
    try {
      const isUserExist: User = await this.prisma.user.findUnique({
        where: { email: body?.email },
      });
      if (isUserExist) {
        throw new Error('User already exists in the system');
      }
      const password = await argon2.hash(body.password);
      delete body.password;

      const user: User = await this.prisma.user.create({
        data: {
          firstName: body?.firstName,
          lastName: body?.lastName,
          email: body?.email,
          password,
          phone: body.phone,
          role: body.role,
          photo: body?.photo ?? null,
          photoBase64: body?.photoBase64 ?? null,
        },
      });
      delete user.password;
      return {
        message: 'Successfully create user record',
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

  async updateUser(userId: string, body: BodyUpdateDto): Promise<ResponseDto> {
    try {
      const existingUser: User = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!existingUser) {
        throw new Error('User not found');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      const updateUser = {};

      for (const [key, value] of Object.entries(body)) {
        updateUser[key] = value;
      }

      // Save the updated user
      const updatedUser = await this.prisma.user.update({
        where: { id: userId }, // Specify the unique identifier for the user you want to update
        data: updateUser, // Pass the modified user object
      });

      return {
        message: 'Successfully updated user record',
        statusCode: 200,
        data: updatedUser,
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
  async changePassword(
    userId: string,
    body: ChangePasswordDto,
  ): Promise<ResponseDto> {
    try {
      const existingUser: User = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!existingUser) {
        throw new Error('User not found');
      }

      // Verify old password
      const isOldPasswordValid = await argon2.verify(
        existingUser.password, // Hashed old password from the database
        body.oldPassword, // Plain text old password from the request body
      );
      if (!isOldPasswordValid) {
        throw new Error('Old password is incorrect');
      }

      // Save the updated user
      await this.prisma.user.update({
        where: { id: userId }, // Specify the unique identifier for the user you want to update
        data: {
          password: await argon2.hash(body.password),
        }, // Pass the modified user object
      });

      return {
        message: 'Successfully updated user password',
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

  async updatePassword(userId: string, body: any): Promise<ResponseDto> {
    try {
      const existingUser = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!existingUser) {
        throw new Error('User not found');
      }

      // Save the updated user with new password
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          password: await argon2.hash(body.password),
        },
      });

      return {
        message: 'Successfully updated user password',
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

  async deleteUser(id: string): Promise<ResponseDto> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
      });
      if (!user?.id) {
        throw new Error('User not found');
      }

      await this.prisma.user.delete({
        where: { id },
      });

      return {
        message: 'Successfully deleted user record',
        statusCode: 200,
        data: user,
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

  async createUserMessage(body: any, user: User): Promise<ResponseDto> {
    try {
      const contactUsMessage: any = await this.prisma.contactMessage.create({
        data: {
          userId: user.id,
          message: body.message,
          isSeen: false, // Defaults to false when a message is created
        },
      });
      return {
        message: 'Successfully sent a message to admin',
        statusCode: 200,
        data: contactUsMessage,
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

  // async getAllUserMessages(userId: any): Promise<ResponseDto> {
  //   try {
  //     const users = await this.prisma.contactMessage.findMany({
  //       where: {
  //         userId,
  //       },

  //       orderBy: {
  //         createdAt: 'desc',
  //       },
  //     });
  //     if (!(users.length > 0)) {
  //       throw new Error('No user message found');
  //     }
  //     return {
  //       message: 'Successfully fetch all user',
  //       statusCode: 200,
  //       data: users,
  //     };
  //   } catch (error) {
  //     throw new HttpException(
  //       {
  //         status: HttpStatus.FORBIDDEN,
  //         error: error?.message || 'Something went wrong',
  //       },
  //       HttpStatus.FORBIDDEN,
  //       {
  //         cause: error,
  //       },
  //     );
  //   }
  // }

  async getAllUserMessages(userId: any, role: string): Promise<ResponseDto> {
    try {
      const users = await this.prisma.contactMessage.findMany({
        ...(role === 'user' && {
          where: {
            userId: userId,
          },
        }),
        select: {
          id: true,
          createdAt: true,
          isSeen: true,
          message: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
      });
      if (!(users.length > 0)) {
        throw new Error('No Userssdsds found');
      }
      return {
        message: 'Successfully fetch all users info',
        statusCode: 200,
        data: users,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
}
