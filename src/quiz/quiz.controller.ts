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
import {  AssignQuizDto, CheckQuiz, ParamsDto, QuizDto, ResponseDto, UpdateQuizDto } from '../dto';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from '../decorator';
import { User } from '@prisma/client';


@Controller('quizzes')
export class QuizController {
  constructor(private readonly appService: QuizService) {}
  @Get('/:id')
  getQuiz(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getQuiz(params.id);
  }

  @Get('/')
  getAllQuizzes(): Promise<ResponseDto> {
    return this.appService.getAllQuizzes();
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('/')
  createQuiz(@Body() body: QuizDto): Promise<ResponseDto> {
  
    return this.appService.createQuiz(body);
  }
  @UseGuards(AuthGuard('jwt'))
  @Put('/:id')
  updateQuiz(
    @Body() body: UpdateQuizDto,
    @Param() params: ParamsDto,
  ): Promise<ResponseDto> {
    return this.appService.updateQuiz(params.id, body);
  }
  @UseGuards(AuthGuard('jwt'))
  @Delete('/:id')
  deleteQuiz(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.deleteQuiz(params.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('/assignQuiz/:quizId/:chapterId')
  assignQuiz(
    @Param() params: AssignQuizDto,
  ): Promise<ResponseDto> {
    return this.appService.assignQuiz(params.quizId, params.chapterId);
  }


  @Get('/getAllAssignQuizzes/:chapterId')
  getAllAssignQuizzes(
    @Param() params: ParamsDto
  ): Promise<ResponseDto> {
    return this.appService.getAllAssignQuizzes(params.id);
  }
  
  @UseGuards(AuthGuard('uJwt'))
  @Post('/checkQuiz/')
  checkQuiz(@Body() body: CheckQuiz,    @GetUser() user:User): Promise<ResponseDto> {
  
    return this.appService.checkQuiz(user.id,body);
  }
  
}
