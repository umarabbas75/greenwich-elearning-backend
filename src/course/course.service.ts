import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Course, Module, Chapter, Section } from '@prisma/client';
import {
  AssignCourseDto,
  CourseDto,
  ModuleDto,
  ResponseDto,
  UpdateCourseDto,
} from 'src/dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CourseService {
  constructor(private prisma: PrismaService) {}
 


  async createCourse(body: CourseDto): Promise<ResponseDto> {
    try {
      const isCourseExist: Course = await this.prisma.course.findUnique({
        where: { title: body.title },
      });
      if (isCourseExist) {
        throw new Error('Course already exist with specified title');
      }
      const course: Course = await this.prisma.course.create({
        data: {
          title: body.title,
          description: body.description,
          assessment: body.assessment,
          overview: body.overview,
          image: body.image,
        },
      });
      return {
        message: 'Successfully create course record',
        statusCode: 200,
        data: course,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async createModule(body: ModuleDto): Promise<ResponseDto> {
    try {
      const module: Module = await this.prisma.module.create({
        data: {
          title: body.title,
          description: body.description,

          courseId: body.id,
        },
      });
      return {
        message: 'Successfully create module record',
        statusCode: 200,
        data: module,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async createChapter(body: ModuleDto): Promise<ResponseDto> {
    try {
      const chapter: Chapter = await this.prisma.chapter.create({
        data: {
          title: body.title,
          description: body.description,
          
          moduleId: body.id,
        },
      });
      return {
        message: 'Successfully create chapter record',
        statusCode: 200,
        data: chapter,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async createSection(body: ModuleDto): Promise<ResponseDto> {
    try {
      const section: Section = await this.prisma.section.create({
        data: {
          title: body.title,
          description: body.description,

          chapterId: body.id,
        },
      });
      return {
        message: 'Successfully create section record',
        statusCode: 200,
        data: section,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }


  async getCourse(id: string): Promise<ResponseDto> {
    try {
      const course = await this.prisma.course.findUnique({ where: { id } });
      if (!course) {
        throw new Error('course not found');
      }
      return {
        message: 'Successfully fetch Course info',
        statusCode: 200,
        data: course,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async getModule(id: string): Promise<ResponseDto> {
    try {
      const module = await this.prisma.module.findUnique({ where: { id } });
      if (!module) {
        throw new Error('Module not found');
      }
      return {
        message: 'Successfully fetch module info',
        statusCode: 200,
        data: module,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async getChapter(id: string): Promise<ResponseDto> {
    try {
      const chapter = await this.prisma.chapter.findUnique({ where: { id } });
      if (!chapter) {
        throw new Error('Chapter not found');
      }
      return {
        message: 'Successfully fetch Chapter info',
        statusCode: 200,
        data: chapter,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async getSection(id: string): Promise<ResponseDto> {
    try {
      const section = await this.prisma.section.findUnique({ where: { id } });
      if (!section) {
        throw new Error('section not found');
      }
      return {
        message: 'Successfully fetch section info',
        statusCode: 200,
        data: section,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async getAllCourses(): Promise<ResponseDto> {
    try {
      const courses = await this.prisma.course.findMany({
        // limit: 10,
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
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async getAllModules(id: string): Promise<ResponseDto> {
    try {
      const modules = await this.prisma.module.findMany({
        where: {
          courseId: id,
        },
        // limit: 10,
        // offset: 10,
      });
      if (!(modules.length > 0)) {
        throw new Error('No Modules found');
      }
      return {
        message: 'Successfully fetch all Modules info against course',
        statusCode: 200,
        data: modules,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async getAllChapters(id: string): Promise<ResponseDto> {
    try {
      const chapters = await this.prisma.chapter.findMany({
        where: {
          moduleId: id,
        },
        // limit: 10,
        // offset: 10,
      });
      if (!(chapters.length > 0)) {
        throw new Error('No Chapters found');
      }
      return {
        message: 'Successfully fetch all Chapters info against module',
        statusCode: 200,
        data: chapters,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async getAllSections(id: string): Promise<ResponseDto> {
    try {
      const sections = await this.prisma.section.findMany({
        where: {
          chapterId: id,
        },
        // limit: 10,
        // offset: 10,
      });
      if (!(sections.length > 0)) {
        throw new Error('No Sections found');
      }
      return {
        message: 'Successfully fetch all Sections info against chapter',
        statusCode: 200,
        data: sections,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }


  async updateCourse(id: string, body: UpdateCourseDto): Promise<ResponseDto> {
    try {
      const isCourseExist: Course = await this.prisma.course.findUnique({
        where: { id: id },
      });
      if (isCourseExist) {
        throw new Error('Course already exist with specified title');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      let updateCourse = {};

      for (const [key, value] of Object.entries(body)) {
        updateCourse[key] = value;
      }

      // Save the updated user
      const updatedCourse = await this.prisma.course.update({
        where: { id }, // Specify the unique identifier for the user you want to update
        data: updateCourse, // Pass the modified user object
      });

      return {
        message: 'Successfully updated course record',
        statusCode: 200,
        data: updatedCourse,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async updateModule(id: string, body: UpdateCourseDto): Promise<ResponseDto> {
    try {
      const isModuleExist: Module = await this.prisma.module.findUnique({
        where: { id: id },
      });
      if (isModuleExist) {
        throw new Error('Module already exist with specified title');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      let updateModule = {};

      for (const [key, value] of Object.entries(body)) {
        updateModule[key] = value;
      }

      // Save the updated user
      const updatedModule = await this.prisma.module.update({
        where: { id }, // Specify the unique identifier for the user you want to update
        data: updateModule, // Pass the modified user object
      });

      return {
        message: 'Successfully updated module record',
        statusCode: 200,
        data: updatedModule,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async updateChapter(id: string, body: UpdateCourseDto): Promise<ResponseDto> {
    try {
      const isChapterExist: Chapter = await this.prisma.chapter.findUnique({
        where: { id: id },
      });
      if (isChapterExist) {
        throw new Error('Chapter already exist with specified title');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      let updateChapter = {};

      for (const [key, value] of Object.entries(body)) {
        updateChapter[key] = value;
      }

      // Save the updated user
      const updatedChapter = await this.prisma.module.update({
        where: { id }, // Specify the unique identifier for the user you want to update
        data: updateChapter, // Pass the modified user object
      });

      return {
        message: 'Successfully updated chapter record',
        statusCode: 200,
        data: updatedChapter,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async updateSection(id: string, body: UpdateCourseDto): Promise<ResponseDto> {
    try {
      const isSectionExist: Section = await this.prisma.section.findUnique({
        where: { id: id },
      });
      if (isSectionExist) {
        throw new Error('Section already exist with specified title');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      let updateSection = {};

      for (const [key, value] of Object.entries(body)) {
        updateSection[key] = value;
      }

      // Save the updated user
      const updatedSection = await this.prisma.module.update({
        where: { id }, // Specify the unique identifier for the user you want to update
        data: updateSection, // Pass the modified user object
      });

      return {
        message: 'Successfully update section record',
        statusCode: 200,
        data: updatedSection,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }


  async deleteCourse(id: string): Promise<ResponseDto> {
    try {
      const user = await this.prisma.course.findUnique({
        where: { id },
      });
      if (!user) {
        throw new Error('Course not found');
      }

      await this.prisma.course.delete({
        where: { id },
      });

      return {
        message: 'Successfully deleted course record',
        statusCode: 200,
        data: user,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async deleteModule(id: string): Promise<ResponseDto> {
    try {
      const user = await this.prisma.module.findUnique({
        where: { id },
      });
      if (!user) {
        throw new Error('Module not found');
      }

      await this.prisma.module.delete({
        where: { id },
      });

      return {
        message: 'Successfully deleted module record',
        statusCode: 200,
        data: user,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async deleteChapter(id: string): Promise<ResponseDto> {
    try {
      const user = await this.prisma.chapter.findUnique({
        where: { id },
      });
      if (!user) {
        throw new Error('Chapter not found');
      }

      await this.prisma.chapter.delete({
        where: { id },
      });

      return {
        message: 'Successfully deleted chapter record',
        statusCode: 200,
        data: user,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async deleteSection(id: string): Promise<ResponseDto> {
    try {
      const user = await this.prisma.section.findUnique({
        where: { id },
      });
      if (!user) {
        throw new Error('Section not found');
      }

      await this.prisma.section.delete({
        where: { id },
      });

      return {
        message: 'Successfully deleted section record',
        statusCode: 200,
        data: user,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }


  async assignCourse(body: AssignCourseDto): Promise<ResponseDto> {
    try {
      const course = await this.prisma.course.findUnique({
        where: { id: body.courseId },
      });
      if (!course) {
        throw new Error('course not found');
      }
      const user = await this.prisma.user.findUnique({
        where: { id: body.userId },
      });
      if (!user) {
        throw new Error('user not found');
      }

      // Assign the course to the user
      await this.prisma.user.update({
        where: { id: body.userId },
        data: {
          courses: {
            connect: { id: body.courseId },
          },
        },
      });

      return {
        message: 'Successfully assigned course to user',
        statusCode: 200,
        data: {},
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }
  async getAllAssignedCourses(userId: string): Promise<ResponseDto> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { courses: true }, // Include the courses relation
      });
      if (!user) {
        throw new Error('User not found');
      }

      return {
        message: 'Successfully retrieved assigned courses',
        statusCode: 200,
        data: user.courses, // Return the courses associated with the user
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async updateUserCourseProgress(
    userId: string,
    courseId: string,
    chapterId: string,
    sectionId: string,
  ): Promise<ResponseDto> {
    try {
      // Get total modules in the course
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
        include: { modules: true },
      });
      if (!course) {
        throw new Error('Course not found');
      }
  
  
      // Get completed modules by the user
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
       
      });
  
      if (!user) {
        throw new Error('user not found');
      }
      // Update or create progress record
      let userCourseProgress = await this.prisma.userCourseProgress.findFirst({
        where: {
          userId,
          courseId,
          chapterId,
          sectionId
        },
      });
      if (!userCourseProgress) {
        userCourseProgress = await this.prisma.userCourseProgress.create({
          data: {
            userId,
            courseId,
            chapterId,
            sectionId
          },
        });
      } 
  
      return {
        message: 'User course progress updated successfully',
        statusCode: 200,
        data: {
          userCourseProgress,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async getUserCourseProgress(userId: string,courseId:string): Promise<ResponseDto> {
    try{
      let userCourseProgress = await this.prisma.userCourseProgress.findMany({
        where: {
          userId,
          courseId
        }
      })
   
      let module = await this.prisma.module.findFirst({
        where: {
          courseId
        },
        include:{
          chapters:true
        }
      })
        

      let percentage = (userCourseProgress.length/module.chapters.length)*100
      return {
        message: 'User course progress updated successfully',
        statusCode: 200,
        data: {
          userCourseProgress:percentage,
        }
      };
    }catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

}
