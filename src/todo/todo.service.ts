import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ResponseDto } from '../dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TodoService {
  constructor(private prisma: PrismaService) {}

  async getTodos(
    userId: string,
    // pageSize: number,
    // page: number,
  ): Promise<ResponseDto> {
    try {
      // const skip = pageSize * (page - 1);
      const todos = await this.prisma.todoItem.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        where: { userId: userId },
      });

      return {
        message: 'Successfully fetch all todos info',
        statusCode: 200,
        data: { todos, totalCount: todos?.length },
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
  async getTodo(userId: string, todoId: any): Promise<ResponseDto> {
    try {
      const todos = await this.prisma.todoItem.findUnique({
        where: { userId: userId, id: todoId },
      });

      return {
        message: 'Successfully fetch all todos info',
        statusCode: 200,
        data: todos,
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

  async createTodo(userId: any, body: any): Promise<ResponseDto> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        throw new Error('User not found');
      }

      const newTodo = await this.prisma.todoItem.create({
        data: {
          title: body.title,
          content: body.content,
          dueDate: body.dueDate,
          userId,
        },
      });

      return {
        message: 'Successfully created new todo item',
        statusCode: 200,
        data: newTodo,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error?.message || 'Failed to create todo',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async updateTodo(id: string, body: any): Promise<ResponseDto> {
    try {
      const isTodoExist: any = await this.prisma.todoItem.findUnique({
        where: { id: id },
      });
      if (!isTodoExist) {
        throw new Error('Todo item does not exist ');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      const updateTodo = {};

      for (const [key, value] of Object.entries(body)) {
        updateTodo[key] = value;
      }

      // Save the updated user
      await this.prisma.todoItem.update({
        where: { id }, // Specify the unique identifier for the user you want to update
        data: updateTodo, // Pass the modified user object
      });

      return {
        message: 'Successfully updated todo record',
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
  async deleteTodo(id: string): Promise<ResponseDto> {
    try {
      const todo = await this.prisma.todoItem.findUnique({
        where: { id },
      });
      if (!todo) {
        throw new Error('Todo item not found');
      }

      await this.prisma.todoItem.delete({
        where: { id },
      });

      return {
        message: 'Successfully deleted todo record',
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
}
