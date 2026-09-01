import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Put,
  Patch,
  Delete,
} from '@nestjs/common';
import { QuizService } from './quiz.service';
import {
  AssignQuizDto,
  BulkAssignQuizDto,
  CheckQuiz,
  ParamsDto,
  QuizDto,
  ResponseDto,
  UpdateChapterQuizOrderDto,
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
  getAllQuizzes(
    @GetUser() user: User,
    @Query('search') search?: string,
    @Query('page') page?: string,
    // Named to match the frontend's useServerTable, which always sends
    // `pageSize` (see EnrollmentsTable/ArchivedItemsTable for the convention).
    @Query('pageSize') pageSize?: string,
    @Query('courseId') courseId?: string,
    @Query('assigned') assigned?: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<ResponseDto> {
    // page/pageSize are opt-in: omitting both preserves the old "return every
    // quiz" behaviour so existing callers (e.g. AssignQuizModal, which needs
    // the full bank to build its options list) keep working unchanged.
    return this.appService.getAllQuizzes(user.role, {
      search,
      page: page ? Number(page) : undefined,
      limit: pageSize ? Number(pageSize) : undefined,
      courseId,
      assigned:
        assigned === 'true' ? true : assigned === 'false' ? false : undefined,
      includeArchived: includeArchived === 'true',
    });
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('/getAllAssignQuizzes/:id')
  getAllAssignQuizzes(
    @Param() params: ParamsDto,
    @GetUser() user: User,
  ): Promise<ResponseDto> {
    return this.appService.getAllAssignQuizzes(
      params.id,
      user.role,
      user.id,
      user.email,
    );
  }

  @UseGuards(AuthGuard('cJwt'))
  @Patch('/chapter/reorder')
  reorderChapterQuizzes(
    @Body() body: UpdateChapterQuizOrderDto,
  ): Promise<ResponseDto> {
    return this.appService.reorderChapterQuizzes(body);
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
      user.email,
    );
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('/retakeChapterQuiz')
  retakeChapterQuiz(
    @Body() body: any,
    @GetUser() user: User,
  ): Promise<ResponseDto> {
    return this.appService.retakeChapterQuiz(
      user.id,
      body.chapterId,
      user.email,
    );
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
  deleteQuiz(
    @GetUser() user: User,
    @Param() params: ParamsDto,
  ): Promise<ResponseDto> {
    return this.appService.deleteQuiz(params.id, user.id);
  }

  // POST /quiz/:id/restore — PR 1's un-archive endpoint. Mirrors the three
  // course-side restores (module, chapter, section) so FE's admin restore UI
  // has a single 4-way branch on entityType.
  @UseGuards(AuthGuard('jwt'))
  @Post('/:id/restore')
  restoreQuiz(
    @GetUser() user: User,
    @Param() params: ParamsDto,
  ): Promise<ResponseDto> {
    return this.appService.restoreQuiz(params.id, user.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('/assignQuiz/:quizId/:chapterId')
  assignQuiz(
    @GetUser() user: User,
    @Param() params: AssignQuizDto,
  ): Promise<ResponseDto> {
    return this.appService.assignQuiz(params.quizId, params.chapterId, user.id);
  }

  // Bulk variant of assignQuiz: assigns N quizzes to one chapter in a single
  // transaction and a single course-version publish, instead of the admin
  // (or the frontend, looping) hitting assignQuiz N times — which would
  // otherwise publish N course versions for one logical action.
  @UseGuards(AuthGuard('jwt'))
  @Put('/assignQuiz/bulk')
  bulkAssignQuiz(
    @GetUser() user: User,
    @Body() body: BulkAssignQuizDto,
  ): Promise<ResponseDto> {
    return this.appService.bulkAssignQuiz(
      body.chapterId,
      body.quizIds,
      user.id,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('/user/unAssignQuiz')
  unAssignQuiz(@GetUser() user: User, @Body() body: any): Promise<ResponseDto> {
    return this.appService.unAssignQuiz(body.quizId, body.chapterId, user.id);
  }

  @UseGuards(AuthGuard('uJwt'))
  @Post('/checkQuiz/')
  checkQuiz(
    @Body() body: CheckQuiz,
    @GetUser() user: User,
  ): Promise<ResponseDto> {
    return this.appService.checkQuiz(user.id, body, user.email);
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
