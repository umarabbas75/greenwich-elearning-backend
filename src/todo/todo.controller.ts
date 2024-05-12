import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Put,
  Delete,
} from '@nestjs/common';
import { TodoService } from './todo.service';
import { ParamsDto, ResponseDto } from '../dto';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from '../decorator';
import { User } from '@prisma/client';

@Controller('todos')
export class TodoController {
  constructor(private readonly appService: TodoService) {}

  @UseGuards(AuthGuard('cJwt'))
  @Get('/')
  getTodos(@GetUser() user: User): Promise<ResponseDto> {
    return this.appService.getTodos(user.id);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('/:id')
  getTodo(@GetUser() user: User, @Param() params: any): Promise<ResponseDto> {
    return this.appService.getTodo(user.id, params?.id);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('/')
  createTodo(@Body() body: any, @GetUser() user: User): Promise<ResponseDto> {
    return this.appService.createTodo(user.id, body);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Put('/')
  updateTodo(@Body() body: any): Promise<ResponseDto> {
    const { todoId, ...rest } = body;
    return this.appService.updateTodo(todoId, rest);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Delete('/:id')
  deleteTodo(@Param() params: any): Promise<ResponseDto> {
    return this.appService.deleteTodo(params.id);
  }
}
