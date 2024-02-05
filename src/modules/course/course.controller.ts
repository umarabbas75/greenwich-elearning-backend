import { Controller, Get,Post,Body,Param,Query, UseGuards } from '@nestjs/common';
import { CourseService } from './course.service';
import { BodyDto, CourseDto, ResponseDto } from 'src/dto';
import { AuthGuard } from '@nestjs/passport';


@Controller('courses')
export class CourseController {
  constructor(private readonly appService: CourseService) {}

 
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
