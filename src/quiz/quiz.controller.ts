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
import { QuizService } from './quiz.service';
import {
  AssignQuizDto,
  CheckQuiz,
  ParamsDto,
  QuizDto,
  ResponseDto,
  UpdateQuizDto,
} from '../dto';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from '../decorator';
import { User } from '@prisma/client';
import { JwtAdminStrategy, JwtCombineStrategy, JwtUserStrategy } from '../strategy';

@Controller('quizzes')
export class QuizController {
  constructor(private readonly appService: QuizService) {}
  @UseGuards(JwtCombineStrategy)
  @Get('/:id')
  getQuiz(@Param() params: ParamsDto,@GetUser() user: User): Promise<ResponseDto> {
    return this.appService.getQuiz(params.id,user.role);
  }
  @UseGuards(JwtCombineStrategy)
  @Get('/')
  getAllQuizzes(@GetUser() user: User): Promise<ResponseDto> {
    return this.appService.getAllQuizzes(user.role);
  }

  @UseGuards(JwtCombineStrategy)
  @Get('/getAllAssignQuizzes/:id')
  getAllAssignQuizzes(@Param() params: ParamsDto,@GetUser() user: User): Promise<ResponseDto> {
    return this.appService.getAllAssignQuizzes(params.id,user.role);
  }

  @UseGuards(JwtAdminStrategy)
  @Post('/')
  createQuiz(@Body() body: QuizDto): Promise<ResponseDto> {
    return this.appService.createQuiz(body);
  }
  @UseGuards(JwtAdminStrategy)
  @Put('/:id')
  updateQuiz(
    @Body() body: UpdateQuizDto,
    @Param() params: ParamsDto,
  ): Promise<ResponseDto> {
    return this.appService.updateQuiz(params.id, body);
  }
  @UseGuards(JwtAdminStrategy)
  @Delete('/:id')
  deleteQuiz(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.deleteQuiz(params.id);
  }

  @UseGuards(JwtAdminStrategy)
  @Put('/assignQuiz/:quizId/:chapterId')
  assignQuiz(@Param() params: AssignQuizDto): Promise<ResponseDto> {
    return this.appService.assignQuiz(params.quizId, params.chapterId);
  }


 

  @UseGuards(JwtUserStrategy)
  @Post('/checkQuiz/')
  checkQuiz(
    @Body() body: CheckQuiz,
    @GetUser() user: User,
  ): Promise<ResponseDto> {
    return this.appService.checkQuiz(user.id, body);
  }

  @UseGuards(JwtUserStrategy)
  @Get('/user/getQuizAnswers/:id')
  getUserQuizAnswers(@Param() params: ParamsDto,@GetUser() user: User): Promise<ResponseDto> {
    return this.appService.getUserQuizAnswers(user.id,params.id);
  }

}
