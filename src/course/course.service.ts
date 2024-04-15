import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Course, Module, Chapter, Section } from '@prisma/client';
import {
  AssignCourseDto,
  CourseDto,
  ModuleDto,
  ResponseDto,
  UpdateCourseDto,
  UpdateCourseProgress,
} from '../dto';
import { PrismaService } from '../prisma/prisma.service';
interface ExtendedCourse extends Course {
  totalSections?: number;
  percentage?: number;
}
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
          duration: body.duration,
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
  async getAllUserSections(
    id: string,
    userId: string,
    courseId: string,
  ): Promise<ResponseDto> {
    function insertQuizzes(sections: any, quizzes: any) {
      // Remove first and last indexes for quiz placement
      const availableIndexes = [];
      if (sections.length > 2) {
        for (let i = 1; i < sections.length - 1; i++) {
          availableIndexes.push(i);
        }
      }

      // Shuffle quizzes to randomize placement
      const shuffledQuizzes = quizzes.sort(() => Math.random() - 0.5);

      // Insert quizzes into available indexes
      for (let i = 0; i < shuffledQuizzes.length; i++) {
        const randomIndex = availableIndexes.splice(
          Math.floor(Math.random() * availableIndexes.length),
          1,
        )[0];
        sections.splice(randomIndex, 0, shuffledQuizzes[i]);
      }

      return sections;
    }

    try {
      const [
        sections,
        userCourseProgress,
        chapter,
        quizAnswer,
        lastSeenLesson,
      ] = await Promise.all([
        this.prisma.section.findMany({
          where: { chapterId: id },
        }),
        this.prisma.userCourseProgress.findMany({
          where: { userId, courseId, chapterId: id },
        }),
        this.prisma.chapter.findUnique({
          where: { id },
          include: {
            quizzes: {
              select: {
                id: true,
                question: true,
                options: true,
                answer: true,
              },
            },
          },
        }),
        this.prisma.quizAnswer.findMany({
          where: { userId, chapterId: id },
        }),
        this.prisma.lastSeenSection.findUnique({
          where: { userId_chapterId: { userId, chapterId: id } },
        }),
      ]);

      const allSections = sections?.length > 0 ? [...sections] : [];
      const completedSections =
        userCourseProgress?.length > 0 ? [...userCourseProgress] : [];
        const assignedQuizzesList =
        chapter?.quizzes?.length > 0 ? [...chapter?.quizzes] : [];
        const quizAnsweredList = quizAnswer?.length > 0 ? [...quizAnswer] : [];
      allSections.forEach((section: any) => {
        // Check if the section ID exists in completedSections
        const isCompleted = completedSections?.some(
          (completedSection: any) => completedSection.sectionId === section.id,
        );
        section.isLastSeen =
          lastSeenLesson?.sectionId === section.id ? true : false;
        // Insert the boolean value into the section object
        section.isCompleted = isCompleted;
      });

      assignedQuizzesList.forEach((quiz: any) => {
        // Check if the section ID exists in completedSections
        const isCorrect = quizAnsweredList?.some(
          (completedQuestion: any) => completedQuestion.id === quiz.id,
        );
        // Insert the boolean value into the section object
        quiz.isCorrect = isCorrect;
      });

      const mergedArray = insertQuizzes(allSections, assignedQuizzesList);

      console.log(
        'assignedQmergedArrayuizzesList',
        mergedArray,
        lastSeenLesson,
      );
      if (!(sections.length > 0)) {
        throw new Error('No Sections found');
      }
      return {
        message: 'Successfully fetch all Sections info against chapter',
        statusCode: 200,
        data: mergedArray,
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
      if (!isCourseExist) {
        throw new Error('Course does not exist');
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
      if (!isModuleExist) {
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
      if (!isChapterExist) {
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
      const updatedChapter = await this.prisma.chapter.update({
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
      if (!isSectionExist) {
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
      const updatedSection = await this.prisma.section.update({
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

  async assignCourse(userId: string, courseId: string): Promise<ResponseDto> {
    try {
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!course) {
        throw new Error('course not found');
      }
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        throw new Error('user not found');
      }

      // Assign the course to the user
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          courses: {
            connect: { id: courseId },
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
      let user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { courses: true }, // Include the courses relation
      });
      if (!user) {
        throw new Error('User not found');
      }

      const extendedCourses: ExtendedCourse[] = user.courses.map((course) => ({
        ...course,
      }));

      for (let i = 0; i < extendedCourses.length; i++) {
        let modules = await this.prisma.module.findMany({
          where: { courseId: extendedCourses[i].id },
          include: {
            chapters: {
              include: {
                sections: true,
              },
            },
          },
        });
        let sections = modules.flatMap((module) =>
          module.chapters.flatMap((chapter) => chapter.sections),
        );
        extendedCourses[i].totalSections = sections.length;

        let userCourseProgress = await this.prisma.userCourseProgress.findMany({
          where: {
            userId,
            courseId: extendedCourses[i].id,
          },
        });
        if (extendedCourses[i].totalSections > 0) {
          let percentage =
            (userCourseProgress.length / extendedCourses[i].totalSections) *
            100;
          extendedCourses[i].percentage = percentage;
        } else {
          extendedCourses[i].percentage = 0;
        }
      }

      return {
        message: 'Successfully retrieved assigned courses',
        statusCode: 200,
        data: extendedCourses,
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

  async updateUserChapterProgress(
    userId: string,
    body: UpdateCourseProgress,
  ): Promise<ResponseDto> {
    try {
      // Get total modules in the course
      const course = await this.prisma.course.findUnique({
        where: { id: body.courseId },
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
          userId: userId,
          courseId: body.courseId,
          chapterId: body.chapterId,
          sectionId: body.sectionId,
        },
      });
      if (!userCourseProgress) {
        userCourseProgress = await this.prisma.userCourseProgress.create({
          data: {
            userId: userId,
            courseId: body.courseId,
            chapterId: body.chapterId,
            sectionId: body.sectionId,
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

  async getUserChapterProgress(
    userId: string,
    courseId: string,
    chapterId: string,
  ): Promise<ResponseDto> {
    try {
      let userCourseProgress = await this.prisma.userCourseProgress.findMany({
        where: {
          userId,
          courseId,
          chapterId,
        },
      });

      let module = await this.prisma.module.findFirst({
        where: {
          courseId,
        },
      });
      let chapter = await this.prisma.chapter.findFirst({
        where: {
          moduleId: module.id,
        },
        include: {
          sections: true,
        },
      });
      let percentage = 0;
      if (chapter.sections.length > 0) {
        percentage =
          (userCourseProgress.length / chapter.sections.length) * 100;
      }
      return {
        message: 'User course progress updated successfully',
        statusCode: 200,
        data: {
          userCourseProgress: percentage,
          courseProgressData: userCourseProgress,
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

  async getLastSeenSection(
    userId: string,
    chapterId: string,
  ): Promise<ResponseDto> {
    try {
      let getLastSeenSection = await this.prisma.lastSeenSection.findUnique({
        where: {
          userId_chapterId: { userId, chapterId },
        },
      });

      return {
        message: 'success',
        statusCode: 200,
        data: getLastSeenSection,
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

  async updateLastSeenSection(
    userId: string,
    chapterId: string,
    sectionId: string,
  ): Promise<ResponseDto> {
    try {
      await this.prisma.lastSeenSection.upsert({
        where: {
          userId_chapterId: { userId, chapterId },
        },
        update: {
          sectionId,
        },
        create: {
          userId,
          chapterId,
          sectionId,
        },
      });

      return {
        message: 'success',
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
}
