import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Put,
  Delete,
  Query,
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
  UpdateCourseProgress,
  UpdateLastSeen,
} from '../dto';
import { User } from '@prisma/client';
import { GetUser } from '../decorator';
import { AuthGuard } from '@nestjs/passport';
@Controller('courses')
export class CourseController {
  constructor(private readonly appService: CourseService) {}

  @Get('/:id')
  getCourse(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getCourse(params.id);
  }

  @Get('/module/:id')
  getModule(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getModule(params.id);
  }
  @Get('/chapter/:id')
  getChapter(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getChapter(params.id);
  }

  @Get('/section/:id')
  getSection(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getSection(params.id);
  }

  @Get('/')
  getAllCourses(): Promise<ResponseDto> {
    return this.appService.getAllCourses();
  }
  @Get('/allModules/:id')
  getAllModules(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getAllModules(params.id);
  }
  @Get('/module/allChapters/:id')
  getAllChapters(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getAllChapters(params.id);
  }
  @Get('/module/chapter/allSections/:id')
  getAllSections(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getAllSections(params.id);
  }

  @UseGuards(AuthGuard('uJwt'))
  @Get('/user/module/chapter/allSections/:id/:courseId')
  getAllUserSections(@Param() params: ParamsDto1, @GetUser() user:User): Promise<ResponseDto> {
    console.log({params,user})
    return this.appService.getAllUserSections(params?.id,user.id,params?.courseId);
  }

  

  @UseGuards(AuthGuard('jwt'))
  @Post('/')
  createCourse(@Body() body: CourseDto): Promise<ResponseDto> {
    return this.appService.createCourse(body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('/:id')
  updateCourse(
    @Body() body: UpdateCourseDto,
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
    @Body() body: UpdateCourseDto,
    @Param() params: ParamsDto,
  ): Promise<ResponseDto> {
    return this.appService.updateSection(params.id, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('/assignCourse/:userId/:courseId')
  assignCourse(@Param() params: AssignCourseDto): Promise<ResponseDto> {
    return this.appService.assignCourse(params.userId,params.courseId);
  }
  @Get('/getAllAssignedCourses/:id')
  getAllAssignedCourses(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.getAllAssignedCourses(params.id);
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
  createSection(@Body() body: ModuleDto): Promise<ResponseDto> {
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
  @Delete('/:id')
  deleteChapter(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.deleteChapter(params.id);
  }
  @UseGuards(AuthGuard('jwt'))
  @Delete('/:id')
  deleteSection(@Param() params: ParamsDto): Promise<ResponseDto> {
    return this.appService.deleteSection(params.id);
  }

  @UseGuards(AuthGuard('uJwt'))
  @Put('/updateUserChapter/progress')
  updateUserChapterProgress(
    @Body() body: UpdateCourseProgress,
    @GetUser() user:User
  ): Promise<ResponseDto> {
    return this.appService.updateUserChapterProgress(user.id,body);
  }
  @Get('/getUserChapterProgress/:userId/:courseId/:chapterId')
  getUserChapterProgress(@Param() params: AssignCourseDto): Promise<ResponseDto> {
    return this.appService.getUserChapterProgress(params.userId,params.courseId,params.chapterId);
  }

  @Get("/section/getLastSeen/:userId/:chapterId")
  getLastSeen(@Param() param:GetUpdateLastSeen) {
    return this.appService.getLastSeenSection(param.userId, param.chapterId);
  }
  @UseGuards(AuthGuard('uJwt'))
  @Post("/section/updateLastSeen/")
  updateLastSeen(@Body() body:UpdateLastSeen,@GetUser() user:User) {
    return this.appService.updateLastSeenSection(user.id, body.chapterId, body.sectionId);
  }
}
