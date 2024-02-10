import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  Course,
  Module,
  Chapter,
  Section,
} from 'src/database/database.providers';
import { CourseDto, ResponseDto } from 'src/dto';

@Injectable()
export class CourseService {
  async getCourse(id: string): Promise<ResponseDto> {
    try {
      let course = await Course.findOne({ where: { id } });
      if (!course) {
        throw new Error('course not found');
      }
      return {
        message: 'Successfully fetch Course info',
        statusCode: 200,
        data: course,
      };
    } catch (error) {
      throw new HttpException({
        status: HttpStatus.FORBIDDEN,
        error: error?.message || "Something went wrong",
      }, HttpStatus.FORBIDDEN, {
        cause: error
      });
    }
  }

  async getModule(id: string): Promise<ResponseDto> {
    try {
      let module = await Module.findOne({ where: { id } });
      if (!module) {
        throw new Error('Module not found');
      }
      return {
        message: 'Successfully fetch module info',
        statusCode: 200,
        data: module,
      };
    } catch (error) {
      throw new HttpException({
        status: HttpStatus.FORBIDDEN,
        error: error?.message || "Something went wrong",
      }, HttpStatus.FORBIDDEN, {
        cause: error
      });
    }
  }

  async getChapter(id: string): Promise<ResponseDto> {
    try {
      let chapter = await Chapter.findOne({ where: { id } });
      if (!chapter) {
        throw new Error('Chapter not found');
      }
      return {
        message: 'Successfully fetch Chapter info',
        statusCode: 200,
        data: chapter,
      };
    } catch (error) {
      throw new HttpException({
        status: HttpStatus.FORBIDDEN,
        error: error?.message || "Something went wrong",
      }, HttpStatus.FORBIDDEN, {
        cause: error
      });
    }
  }

  async getSection(id: string): Promise<ResponseDto> {
    try {
      let section = await Section.findOne({ where: { id } });
      if (!section) {
        throw new Error('section not found');
      }
      return {
        message: 'Successfully fetch user info',
        statusCode: 200,
        data: section,
      };
    } catch (error) {
      throw new HttpException({
        status: HttpStatus.FORBIDDEN,
        error: error?.message || "Something went wrong",
      }, HttpStatus.FORBIDDEN, {
        cause: error
      });
    }
  }
  async getAllCourses(): Promise<ResponseDto> {
    try {
      let courses = await Course.findAll({
        limit: 10,
        // offset: 10,
      });
      if (!(courses.length > 0)) {
        throw new Error('No Courses found');
      }
      return {
        message: 'Successfully fetch all Courses info',
        statusCode: 200,
        data: courses,
      };
    } catch (error) {
      throw new HttpException({
        status: HttpStatus.FORBIDDEN,
        error: error?.message || "Something went wrong",
      }, HttpStatus.FORBIDDEN, {
        cause: error
      });
    }
  }
  async createCourse(body: CourseDto): Promise<ResponseDto> {
    try {
      // console.log(req.user)
      let required = ['title', 'description'];
      for (let key of required) {
        if (!body?.[key]) {
          throw new Error(`${key} is required`);
        }
      }
      let isCourseExist: any = await Course.findOne({ where:{title:body.title}})
      if(isCourseExist){
        throw new Error('Course already exist with specified title')
      }
      let course: any = await Course.create({
        title: body.title,
        description: body.description,
        timestamp: Date.now(),
      });
      return {
        message: 'Successfully create course record',
        statusCode: 200,
        data: course,
      };
    } catch (error) {
      throw new HttpException({
        status: HttpStatus.FORBIDDEN,
        error: error?.message || "Something went wrong",
      }, HttpStatus.FORBIDDEN, {
        cause: error
      });
    }
  }
  async createModule(body: CourseDto): Promise<ResponseDto> {
    try {
      // console.log(req.user)
      let required = ['title', 'description', 'id'];
      for (let key of required) {
        if (!body?.[key]) {
          throw new Error(`${key} is required`);
        }
      }
      let isModuleExist: any = await Module.findOne({ where:{title:body.title}})
      if(isModuleExist){
        throw new Error('Module already exist with specified title')
      }
      let module: any = await Module.create({
        title: body.title,
        description: body.description,
        timestamp: Date.now(),
        courseId: body.id,
      });
      return {
        message: 'Successfully create module record',
        statusCode: 200,
        data: module,
      };
    } catch (error) {
      throw new HttpException({
        status: HttpStatus.FORBIDDEN,
        error: error?.message || "Something went wrong",
      }, HttpStatus.FORBIDDEN, {
        cause: error
      });
    }
  }
  async createChapter(body: CourseDto): Promise<ResponseDto> {
    try {
      // console.log(req.user)
      let required = ['title', 'description', 'id'];
      for (let key of required) {
        if (!body?.[key]) {
          throw new Error(`${key} is required`);
        }
      }
      let isChapterExist: any = await Chapter.findOne({ where:{title:body.title}})
      if(isChapterExist){
        throw new Error('Chapter already exist with specified title')
      }
      let chapter: any = await Chapter.create({
        title: body.title,
        description: body.description,
        timestamp: Date.now(),
        moduleId: body.id,
      });
      return {
        message: 'Successfully create chapter record',
        statusCode: 200,
        data: chapter,
      };
    } catch (error) {
      throw new HttpException({
        status: HttpStatus.FORBIDDEN,
        error: error?.message || "Something went wrong",
      }, HttpStatus.FORBIDDEN, {
        cause: error
      });
    }
  }
  async createSection(body: CourseDto): Promise<ResponseDto> {
    try {
      // console.log(req.user)
      let required = ['title', 'description', 'id'];
      for (let key of required) {
        if (!body?.[key]) {
          throw new Error(`${key} is required`);
        }
      }
      let isSectionExist: any = await Section.findOne({ where:{title:body.title}})
      if(isSectionExist){
        throw new Error('Section already exist with specified title')
      }
      let section: any = await Section.create({
        title: body.title,
        description: body.description,
        timestamp: Date.now(),
        chapterId: body.id,
      });
      return {
        message: 'Successfully create section record',
        statusCode: 200,
        data: section,
      };
    } catch (error) {
      throw new HttpException({
        status: HttpStatus.FORBIDDEN,
        error: error?.message || "Something went wrong",
      }, HttpStatus.FORBIDDEN, {
        cause: error
      });
    }
  }
}
