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
  CourseParamDto,
  ModuleDto,
  ParamsDto,
  ResponseDto,
  UpdateCourseDto,
} from 'src/dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('courses')
export class CourseController {
  constructor(private readonly appService: CourseService) {}

  @Get('/:id')
  getCourse(@Param() params: CourseParamDto): Promise<ResponseDto> {
    return this.appService.getCourse(params.id);
  }

  @Get('/module/:id')
  getModule(@Param() params: CourseParamDto): Promise<ResponseDto> {
    return this.appService.getModule(params.id);
  }
  @Get('/chapter/:id')
  getChapter(@Param() params: CourseParamDto): Promise<ResponseDto> {
    return this.appService.getChapter(params.id);
  }

  @Get('/section/:id')
  getSection(@Param() params: CourseParamDto): Promise<ResponseDto> {
    return this.appService.getSection(params.id);
  }

  @Get('/')
  getAllCourses(): Promise<ResponseDto> {
    return this.appService.getAllCourses();
  }
  @Get('/allModules/:id')
  getAllModules(@Param() params: CourseParamDto): Promise<ResponseDto> {
    return this.appService.getAllModules(params.id);
  }
  @Get('/module/allChapters/:id')
  getAllChapters(@Param() params: CourseParamDto): Promise<ResponseDto> {
    return this.appService.getAllChapters(params.id);
  }
  @Get('/module/chapter/allSections/:id')
  getAllSections(@Param() params: CourseParamDto): Promise<ResponseDto> {
    return this.appService.getAllSections(params.id);
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
  @Put('/:id')
  updateModule(
    @Body() body: UpdateCourseDto,
    @Param() params: ParamsDto,
  ): Promise<ResponseDto> {
    return this.appService.updateModule(params.id, body);
  }
  @UseGuards(AuthGuard('jwt'))
  @Put('/:id')
  updateChapter(
    @Body() body: UpdateCourseDto,
    @Param() params: ParamsDto,
  ): Promise<ResponseDto> {
    return this.appService.updateChapter(params.id, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('/:id')
  updateSection(
    @Body() body: UpdateCourseDto,
    @Param() params: ParamsDto,
  ): Promise<ResponseDto> {
    return this.appService.updateSection(params.id, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('/assignCourse')
  assignCourse(@Body() body: AssignCourseDto): Promise<ResponseDto> {
    return this.appService.assignCourse(body);
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
  @Delete('/:id')
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
}
