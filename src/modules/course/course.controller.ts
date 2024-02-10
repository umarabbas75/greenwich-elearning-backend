import { Controller, Get,Post,Body,Param, UseGuards } from '@nestjs/common';
import { CourseService } from './course.service';
import {  CourseDto, CourseParamDto, ResponseDto } from 'src/dto';
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

  @UseGuards(AuthGuard('jwt'))
  @Post("/")
  createCourse(@Body() body:CourseDto):Promise<ResponseDto> {
    return this.appService.createCourse(body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post("/module")
  createModule(@Body() body:CourseDto):Promise<ResponseDto> {
    return this.appService.createModule(body);
  }
  @UseGuards(AuthGuard('jwt'))
  @Post("/chapter")
  createChapter(@Body() body:CourseDto):Promise<ResponseDto> {
    return this.appService.createChapter(body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post("/section")
  createSection(@Body() body:CourseDto):Promise<ResponseDto> {
    return this.appService.createSection(body);
  }

}
