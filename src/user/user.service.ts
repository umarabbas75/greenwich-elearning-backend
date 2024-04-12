import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
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
        },
        // offset: 10,
        // limit: 10,
      });
      if (!(users.length > 0)) {
        throw new Error('No Users found');
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
        throw new Error('credentials already taken');
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
          photo:
            body?.photo ??
            'https://avatar.iran.liara.run/public/boy?username=Ash',
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
      let updateUser = {};

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

  async deleteUser(id: string): Promise<ResponseDto> {
    console.log('my id ',id)
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
      });
      console.log('my id ',id,user)
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
      console.log({error})
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
