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
import { CourseService } from './course.service';
import {
  AssignCourseDto,
  CourseDto,
  GetUpdateLastSeen,
  ModuleDto,
  ParamsDto,
  ParamsDto1,
  ResponseDto,
  UpdateCourseDto,
} from '../dto';
import { User } from '@prisma/client';
import { GetUser } from '../decorator';
import { AuthGuard } from '@nestjs/passport';
@Controller('courses')
export class CourseController {
  constructor(private readonly appService: CourseService) {}

  @UseGuards(AuthGuard('cJwt'))
  @Post('/markFormComplete')
  markFormComplete(@GetUser() user: User, @Body() body: any): Promise<any> {
    return this.appService.markFormComplete(
      user?.id,
      body.courseId,
      body.formId,
      body?.metaData,
      body.courseFormId,
    );
  }

  @Get('/public')
  getAllPublicCourses(): Promise<ResponseDto> {
    return this.appService.getAllPublicCourses();
  }

  @Get('/public/:id')
  getCourseDetailPublic(@Param() params: any): Promise<any> {
    return this.appService.getCourseDetailPublic(params.id);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/report/:courseId/:userId')
  getCourseReport(@Param() params: any): Promise<any> {
    return this.appService.getCourseReport(params.courseId, params.userId);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('/report/dates/:courseId/:userId')
  getCourseDates(@Param() params: any): Promise<any> {
    return this.appService.getCourseDates(params.courseId, params.userId);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('/postComment/:postId')
  createPostComment(
    @Param() params: any,
    @GetUser() user: User,
    @Body() body: any,
  ): Promise<any> {
    return this.appService.createPostComment(params.postId, user?.id, body);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('/postComment/:postId')
  getPostComments(@Param() params: any): Promise<any> {
    return this.appService.getPostComments(params.postId);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Put('/postComment/:postId/:commentId')
  updatePostComment(@Param() params: any, @Body() body: any): Promise<any> {
    return this.appService.updatePostComment(
      params?.postId,
      params?.commentId,
      body,
    );
  }

  @UseGuards(AuthGuard('cJwt'))
  @Delete('/postComment/:postId/:commentId')
  deletePostComment(@Param() params: any): Promise<any> {
    return this.appService.deletePostComment(params.postId, params.commentId);
  }
  // posts
  @UseGuards(AuthGuard('cJwt'))
  @Get('/post/:id')
  getPost(@Param('id') id: string): Promise<any> {
    return this.appService.getPost(id);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/posts/:courseId')
  getAllPosts(@Param() params: any): Promise<ResponseDto> {
    return this.appService.getAllPosts(params.courseId);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('/post/:courseId')
  createPost(
    @Param() params: any,
    @GetUser() user: User,
    @Body() body: any,
  ): Promise<any> {
    return this.appService.createPost(params.courseId, user?.id, body);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('/policies')
  createPolicies(@GetUser() user: User, @Body() body: any): Promise<any> {
    return this.appService.createPolicies(user?.id, body);
  }
  // @UseGuards(AuthGuard('cJwt'))
  @UseGuards(AuthGuard('cJwt'))
  @Delete('/policies/delete')
  deletePolicies(): Promise<any> {
    return this.appService.deletePolicies();
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/getUserPolicies')
  getUserPolicies(@GetUser() user: User): Promise<any> {
    return this.appService.getUserPolicies(user?.id);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Put('/post/:id')
  updatePost(@Body() body: any, @Param('id') id: string): Promise<any> {
    return this.appService.updatePost(id, body);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Delete('/post/:id')
  deletePost(@Param('id') id: string): Promise<any> {
    return this.appService.deletePost(id);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/:id')
  getCourse(@Param() params: any): Promise<any> {
    return this.appService.getCourse(params.id);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('/canAccessCourseContent/:id')
  canAccessCourseContent(
    @GetUser() user: User,
    @Param() params: any,
  ): Promise<any> {
    return this.appService.canAccessCourseContent(user.id, params.id);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/module/:id')
  getModule(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getModule(params.id);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/chapter/:id')
  getChapter(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getChapter(params.id);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/section/:id')
  getSection(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getSection(params.id);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/')
  getAllCourses(): Promise<ResponseDto> {
    return this.appService.getAllCourses();
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/allModules/:id')
  getAllModules(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getAllModules(params.id);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/user/allModules/:id')
  getAllUserModules(
    @Param() params: ParamsDto,
    @GetUser() user: User,
  ): Promise<ResponseDto> {
    return this.appService.getAllUserModules(params.id, user.id);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/module/allChapters/:id')
  getAllChapters(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getAllChapters(params.id);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/module/chapter/allSections/:id')
  getAllSections(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getAllSections(params.id);
  }

  @UseGuards(AuthGuard('uJwt'))
  @Get('/user/module/chapter/allSections/:id/:courseId')
  getAllUserSections(
    @Param() params: ParamsDto1,
    @GetUser() user: User,
  ): Promise<ResponseDto> {
    return this.appService.getAllUserSections(
      params?.id,
      user.id,
      params?.courseId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('/')
  createCourse(@Body() body: CourseDto): Promise<ResponseDto> {
    return this.appService.createCourse(body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('/:id')
  updateCourse(
    @Body() body: CourseDto,
    @Param() params: ParamsDto,
  ): Promise<ResponseDto> {
    return this.appService.updateCourse(params.id, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('/module/:id')
  updateModule(
    @Body() body: UpdateCourseDto,
    @Param() params: ParamsDto,
  ): Promise<ResponseDto> {
    return this.appService.updateModule(params.id, body);
  }
  @UseGuards(AuthGuard('jwt'))
  @Put('/chapter/:id')
  updateChapter(
    @Body() body: UpdateCourseDto,
    @Param() params: ParamsDto,
  ): Promise<ResponseDto> {
    return this.appService.updateChapter(params.id, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('/section/update/:id')
  updateSection(
    @Body() body: any,
    @Param() params: ParamsDto,
  ): Promise<ResponseDto> {
    return this.appService.updateSection(params.id, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('/assignCourse/:userId/:courseId')
  assignCourse(@Param() params: AssignCourseDto): Promise<ResponseDto> {
    return this.appService.assignCourse(params.userId, params.courseId);
  }

  @Put('/assignCourse/public/:userId/:courseId')
  assignCoursePublic(@Param() params: any): Promise<ResponseDto> {
    return this.appService.assignCoursePublic(params.userId, params.courseId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('/unAssignCourse/user')
  unAssignCourse(@Body() body: any): Promise<ResponseDto> {
    return this.appService.unAssignCourse(body.userId, body.courseId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('/updateStatus/user')
  toggleCourseStatus(@Body() body: any): Promise<ResponseDto> {
    return this.appService.toggleCourseStatus(
      body.userId,
      body.courseId,
      body.isActive,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('/updatePayment/user')
  toggleCoursePaymentStatus(@Body() body: any): Promise<ResponseDto> {
    return this.appService.toggleCoursePaymentStatus(
      body.userId,
      body.courseId,
      body.isPaid,
    );
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/getAllAssignedCourses/:id')
  getAllAssignedCourses(
    @Param() params: ParamsDto,
    @GetUser() user: User,
  ): Promise<ResponseDto> {
    return this.appService.getAllAssignedCourses(params.id, user.role);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/getAllAssignedCourses/public/:id')
  getAllAssignedCoursesPublic(
    @Param() params: ParamsDto,
  ): Promise<ResponseDto> {
    return this.appService.getAllAssignedCoursesPublic(params.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('/module')
  createModule(@Body() body: ModuleDto): Promise<ResponseDto> {
    return this.appService.createModule(body);
  }
  @UseGuards(AuthGuard('jwt'))
  @Post('/chapter')
  createChapter(@Body() body: ModuleDto): Promise<ResponseDto> {
    return this.appService.createChapter(body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('/section')
  createSection(@Body() body: any): Promise<ResponseDto> {
    return this.appService.createSection(body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('/:id')
  deleteCourse(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.deleteCourse(params.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('/module/:id')
  deleteModule(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.deleteModule(params.id);
  }
  @UseGuards(AuthGuard('jwt'))
  @Delete('/chapter/:id')
  deleteChapter(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.deleteChapter(params.id);
  }
  @UseGuards(AuthGuard('jwt'))
  @Delete('/section/:id')
  deleteSection(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.deleteSection(params.id);
  }

  @UseGuards(AuthGuard('uJwt'))
  @Put('/updateUserChapter/progress')
  updateUserChapterProgress(
    @Body() body: any,
    @GetUser() user: User,
  ): Promise<ResponseDto> {
    return this.appService.updateUserChapterProgress(user.id, body);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/getUserChapterProgress/:userId/:courseId/:chapterId')
  getUserChapterProgress(
    @Param() params: AssignCourseDto,
  ): Promise<ResponseDto> {
    return this.appService.getUserChapterProgress(
      params.userId,
      params.courseId,
      params.chapterId,
    );
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/section/getLastSeen/:userId/:chapterId')
  getLastSeen(@Param() param: GetUpdateLastSeen) {
    return this.appService.getLastSeenSection(param.userId, param.chapterId);
  }
  @UseGuards(AuthGuard('uJwt'))
  @Post('/section/updateLastSeen/')
  updateLastSeen(@Body() body: any, @GetUser() user: User) {
    return this.appService.updateLastSeenSection(
      user.id,
      body.chapterId,
      body.sectionId,
      body.moduleId,
      body.courseId,
    );
  }
}
