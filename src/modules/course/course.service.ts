import { Injectable } from '@nestjs/common';
import { Course,Module,Chapter,Section } from 'src/database/database.providers';
import { CourseDto, ResponseDto } from 'src/dto';

@Injectable()
export class CourseService {

    async createCourse(body: CourseDto): Promise<ResponseDto> {
        try {
          // console.log(req.user)
          let required = ['title', 'description'];
          for (let key of required) {
            if (!body?.[key])
              return { message: `${key} is required`, statusCode: 400, data: {} };
          }
     
          let course:any = await Course.create({
            title:body.title,
            description:body.description,
            timestamp: Date.now(),
          });
          return {
            message: 'Successfully create course record',
            statusCode: 200,
            data:course
          };
        } catch (error) {
          console.log(error);
          return { message: 'Something went wrong', statusCode: 500, data: {} };
        }
      }
      async createModule(body: CourseDto): Promise<ResponseDto> {
        try {
          // console.log(req.user)
          let required = ['title', 'description','id'];
          for (let key of required) {
            if (!body?.[key])
              return { message: `${key} is required`, statusCode: 400, data: {} };
          }
     
          let course:any = await Module.create({
            title:body.title,
            description:body.description,
            timestamp: Date.now(),
            courseId:body.id
          });
          return {
            message: 'Successfully create course record',
            statusCode: 200,
            data:course
          };
        } catch (error) {
          console.log(error);
          return { message: 'Something went wrong', statusCode: 500, data: {} };
        }
      }
      async createChapter(body: CourseDto): Promise<ResponseDto> {
        try {
          // console.log(req.user)
          let required = ['title', 'description','id'];
          for (let key of required) {
            if (!body?.[key])
              return { message: `${key} is required`, statusCode: 400, data: {} };
          }
     
          let course:any = await Chapter.create({
            title:body.title,
            description:body.description,
            timestamp: Date.now(),
            moduleId:body.id
          });
          return {
            message: 'Successfully create course record',
            statusCode: 200,
            data:course
          };
        } catch (error) {
          console.log(error);
          return { message: 'Something went wrong', statusCode: 500, data: {} };
        }
      }
      async createSection(body: CourseDto): Promise<ResponseDto> {
        try {
          // console.log(req.user)
          let required = ['title', 'description','id'];
          for (let key of required) {
            if (!body?.[key])
              return { message: `${key} is required`, statusCode: 400, data: {} };
          }
     
          let course:any = await Section.create({
            title:body.title,
            description:body.description,
            timestamp: Date.now(),
            chapterId:body.id
          });
          return {
            message: 'Successfully create course record',
            statusCode: 200,
            data:course
          };
        } catch (error) {
          console.log(error);
          return { message: 'Something went wrong', statusCode: 500, data: {} };
        }
      }
}
