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
import {  CourseParamDto, ParamsDto, QuizDto, ResponseDto, UpdateQuizDto } from 'src/dto';
import { AuthGuard } from '@nestjs/passport';


@Controller('quizzes')
export class QuizController {
  constructor(private readonly appService: QuizService) {}
  @Get('/:id')
  getQuiz(@Param() params: CourseParamDto): Promise<ResponseDto> {
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
}
