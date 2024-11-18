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

@Controller('quizzes')
export class QuizController {
  constructor(private readonly appService: QuizService) {}
  @UseGuards(AuthGuard('cJwt'))
  @Get('/:id')
  getQuiz(
    @Param() params: ParamsDto,
    @GetUser() user: User,
  ): Promise<ResponseDto> {
    return this.appService.getQuiz(params.id, user.role);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/')
  getAllQuizzes(@GetUser() user: User): Promise<ResponseDto> {
    return this.appService.getAllQuizzes(user.role);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('/getAllAssignQuizzes/:id')
  getAllAssignQuizzes(
    @Param() params: ParamsDto,
    @GetUser() user: User,
  ): Promise<ResponseDto> {
    return this.appService.getAllAssignQuizzes(params.id, user.role, user.id);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('/getChapterQuizzesReport/:chapterId')
  getChapterQuizzesReport(
    @Param() params: any,
    @GetUser() user: User,
  ): Promise<ResponseDto> {
    return this.appService.getChapterQuizzesReport(params.chapterId, user.id);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('/getAllQuizReport')
  getAllQuizReport(): Promise<ResponseDto> {
    return this.appService.getAllQuizReport();
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('/createChapterQuizzesReport')
  createChapterQuizzesReport(
    @Body() body: any,
    @GetUser() user: User,
  ): Promise<ResponseDto> {
    return this.appService.createChapterQuizzesReport(
      user.id,
      body.chapterId,
      body.totalAttempts,
      body.isPassed,
      body.score,
      body.passingCriteria,
    );
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('/retakeChapterQuiz')
  retakeChapterQuiz(
    @Body() body: any,
    @GetUser() user: User,
  ): Promise<ResponseDto> {
    return this.appService.retakeChapterQuiz(user.id, body.chapterId);
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
  assignQuiz(@Param() params: AssignQuizDto): Promise<ResponseDto> {
    return this.appService.assignQuiz(params.quizId, params.chapterId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('/user/unAssignQuiz')
  unAssignQuiz(@Body() body: any): Promise<ResponseDto> {
    return this.appService.unAssignQuiz(body.quizId, body.chapterId);
  }

  @UseGuards(AuthGuard('uJwt'))
  @Post('/checkQuiz/')
  checkQuiz(
    @Body() body: CheckQuiz,
    @GetUser() user: User,
  ): Promise<ResponseDto> {
    return this.appService.checkQuiz(user.id, body);
  }

  @UseGuards(AuthGuard('uJwt'))
  @Get('/user/getQuizAnswers/:id')
  getUserQuizAnswers(
    @Param() params: ParamsDto,
    @GetUser() user: User,
  ): Promise<ResponseDto> {
    return this.appService.getUserQuizAnswers(user.id, params.id);
  }
}
