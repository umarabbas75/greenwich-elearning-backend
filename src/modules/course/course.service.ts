import { Injectable } from '@nestjs/common';
import { Course,Module,Chapter,Section } from 'src/database/database.providers';
import { CourseDto, ResponseDto } from 'src/dto';

@Injectable()
export class CourseService {
  async getCourse(id: string): Promise<ResponseDto> {
    try {
      let user = await Course.findOne({ where: { id } });
      if (!user)
        return { message: 'User not found', statusCode: 400, data: {} };
      return {
        message: 'Successfully fetch user info',
        statusCode: 200,
        data: user,
      };
    } catch (error) {
      return { message: 'Something went wrong', statusCode: 500, data: {} };
    }
  }

  async getModule(id: string): Promise<ResponseDto> {
    try {
      let user = await Module.findOne({ where: { id } });
      if (!user)
        return { message: 'User not found', statusCode: 400, data: {} };
      return {
        message: 'Successfully fetch user info',
        statusCode: 200,
        data: user,
      };
    } catch (error) {
      return { message: 'Something went wrong', statusCode: 500, data: {} };
    }
  }

  async getChapter(id: string): Promise<ResponseDto> {
    try {
      let user = await Chapter.findOne({ where: { id } });
      if (!user)
        return { message: 'User not found', statusCode: 400, data: {} };
      return {
        message: 'Successfully fetch user info',
        statusCode: 200,
        data: user,
      };
    } catch (error) {
      return { message: 'Something went wrong', statusCode: 500, data: {} };
    }
  }

  async getSection(id: string): Promise<ResponseDto> {
    try {
      let user = await Section.findOne({ where: { id } });
      if (!user)
        return { message: 'User not found', statusCode: 400, data: {} };
      return {
        message: 'Successfully fetch user info',
        statusCode: 200,
        data: user,
      };
    } catch (error) {
      return { message: 'Something went wrong', statusCode: 500, data: {} };
    }
  }
  async getAllCourses(): Promise<ResponseDto> {
    try {
      let users = await Course.findAll({});
      if (!users)
        return { message: 'No Users found', statusCode: 400, data: {} };
      return {
        message: 'Successfully fetch all users info',
        statusCode: 200,
        data: users,
      };
    } catch (error) {
      return { message: 'Something went wrong', statusCode: 500, data: {} };
    }
  }
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
