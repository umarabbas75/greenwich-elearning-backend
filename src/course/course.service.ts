import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Course, Module, Chapter, Section, Prisma } from '@prisma/client';
import {
  // AssignCourseDto,
  CourseDto,
  ModuleDto,
  ResponseDto,
  UpdateCourseDto,
  UpdateCourseProgress,
} from '../dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CourseService {
  constructor(private prisma: PrismaService) {}
  async getCourseReport(courseId: any): Promise<any> {
    try {
      const report = await this.prisma.module.findMany({
        where: {
          courseId: courseId,
        },
        include: {
          chapters: {
            select: {
              id: true,
              title: true,
              quizzes: true,
              QuizAnswer: true,
              UserCourseProgress: true,
              LastSeenSection: true,
              sections: true,
              // quizzes : true,

              // Add other fields you want to include here
            },
          },
        },
      });

      return {
        message: 'Successfully retrieved data',
        statusCode: 200,
        data: report,
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
  // apis related to comments
  async deletePostComment(postId: any, commentId: any): Promise<ResponseDto> {
    try {
      const post = await this.prisma.comment.findUnique({
        where: { id: commentId, postId },
      });
      if (!post) {
        throw new Error('Post not found');
      }

      await this.prisma.comment.delete({
        where: { id: commentId, postId },
      });

      return {
        message: 'Successfully deleted post comment record',
        statusCode: 200,
        data: post,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        // Foreign key constraint violation
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error:
              'Cannot delete course because it is associated with other records.',
          },
          HttpStatus.FORBIDDEN,
        );
      } else {
        // Other errors
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

  async getPostComments(postId: any): Promise<any> {
    try {
      const postComments = await this.prisma.comment.findMany({
        where: {
          postId: postId,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      return {
        message: 'Successfully retrieved data',
        statusCode: 200,
        data: postComments,
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

  async createPostComment(
    postId: any,
    userId: any,
    body: any,
  ): Promise<ResponseDto> {
    try {
      const comment = await this.prisma.comment.create({
        data: {
          content: body.content, // Assuming 'content' is the main content of the post
          postId: postId,
          userId, // Assuming you also have a userId field in the request body
        },
      });
      return {
        message: 'Successfully created post comment record',
        statusCode: 200,
        data: comment,
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

  async updatePostComment(
    postId: string,
    commentId: any,
    body: any,
  ): Promise<ResponseDto> {
    try {
      const doesCommentExist = await this.prisma.comment.findUnique({
        where: { id: commentId, postId },
      });
      if (!doesCommentExist) {
        throw new Error('Comment does not exist');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      const updatePost = {};

      for (const [key, value] of Object.entries(body)) {
        updatePost[key] = value;
      }
      // Save the updated user
      const updatedPostComment = await this.prisma.comment.update({
        where: { id: commentId, postId }, // Specify the unique identifier for the user you want to update
        data: updatePost, // Pass the modified user object
      });

      return {
        message: 'Successfully updated post record',
        statusCode: 200,
        data: updatedPostComment,
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

  // api related to post
  async deletePost(id: string): Promise<ResponseDto> {
    try {
      const post = await this.prisma.post.findUnique({
        where: { id },
      });
      if (!post) {
        throw new Error('Post not found');
      }

      await this.prisma.post.delete({
        where: { id },
      });

      return {
        message: 'Successfully deleted post record',
        statusCode: 200,
        data: post,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        // Foreign key constraint violation
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error:
              'Cannot delete course because it is associated with other records.',
          },
          HttpStatus.FORBIDDEN,
        );
      } else {
        // Other errors
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

  async getPost(postId: any): Promise<any> {
    try {
      const posts = await this.prisma.post.findUnique({
        where: {
          id: postId,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      return {
        message: 'Successfully retrieved data',
        statusCode: 200,
        data: posts,
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
  async getAllPosts(courseId: any): Promise<any> {
    try {
      const posts = await this.prisma.post.findMany({
        where: {
          courseId,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          comments: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return {
        message: 'Successfully fetch all posts',
        statusCode: 200,
        data: posts,
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

  async createPost(
    courseId: any,
    userId: any,
    body: any,
  ): Promise<ResponseDto> {
    try {
      const post = await this.prisma.post.create({
        data: {
          title: body.title,
          content: body.content, // Assuming 'content' is the main content of the post
          courseId: courseId,
          userId, // Assuming you also have a userId field in the request body
        },
      });
      return {
        message: 'Successfully create post record',
        statusCode: 200,
        data: post,
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
  async createPolicies(userId: any, body: any): Promise<ResponseDto> {
    try {
      const isCourseExist: any =
        await this.prisma.policiesAndProcedures.findUnique({
          where: { policiesId: body.policiesId },
        });
      if (isCourseExist) {
        throw new Error('Course already exist with specified title');
      }

      const policiesAndProcedures =
        await this.prisma.policiesAndProcedures.create({
          data: {
            policiesId: body?.policiesId,
            userId,
          },
        });
      return {
        message: 'Successfully updated record',
        statusCode: 200,
        data: policiesAndProcedures,
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
  async getUserPolicies(userId: any): Promise<ResponseDto> {
    try {
      const policiesAndProcedures =
        await this.prisma.policiesAndProcedures.findMany({
          where: {
            userId,
          },
        });
      return {
        message: 'Record fetched successfully',
        statusCode: 200,
        data: policiesAndProcedures,
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
  async deletePolicies(): Promise<ResponseDto> {
    try {
      const user = await this.prisma.policiesAndProcedures.deleteMany();

      return {
        message: 'Successfully deleted policies record',
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

  async updatePost(id: string, body: UpdateCourseDto): Promise<ResponseDto> {
    try {
      const isPostExist = await this.prisma.post.findUnique({
        where: { id: id },
      });
      if (!isPostExist) {
        throw new Error('Post does not exist');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }
      const updatePost = {};

      for (const [key, value] of Object.entries(body)) {
        updatePost[key] = value;
      }
      // Save the updated user
      const updatedPost = await this.prisma.post.update({
        where: { id }, // Specify the unique identifier for the user you want to update
        data: updatePost, // Pass the modified user object
      });

      return {
        message: 'Successfully updated post record',
        statusCode: 200,
        data: updatedPost,
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
          syllabusOverview: body.syllabusOverview,
          resourcesOverview: body.resourcesOverview,
          assessments: body.assessments,
          resources: body.resources,
          syllabus: body.syllabus,
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
          pdfFile: body.pdfFile,
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
  async createSection(body: any): Promise<ResponseDto> {
    try {
      const section: Section = await this.prisma.section.create({
        data: {
          title: body.title,
          description: body.description,
          shortDescription: body?.shortDescription ?? '',
          chapterId: body.id,
          moduleId: body.moduleId,
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
      console.log({ error });
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
        include: {
          _count: {
            select: {
              modules: true,
            },
          },
        },

        orderBy: {
          createdAt: 'desc',
        },

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
        include: {
          _count: {
            select: {
              chapters: true,
            },
          },
          // chapters: {

          // },
        },
        orderBy: {
          createdAt: 'asc',
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
      console.log({ error });
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
  async getAllUserModules(id: string, userId: string): Promise<ResponseDto> {
    try {
      const courses: any = await this.prisma.course.findFirst({
        where: { id },
        select: {
          id: true,
          title: true,
          modules: {
            select: {
              id: true,
              title: true,
              chapters: {
                select: {
                  id: true,
                  title: true,
                  _count: {
                    select: {
                      UserCourseProgress: {
                        where: { userId }, // Filter by userId
                      },
                      sections: true,
                    },
                  },
                },
              },
              // Get the count of user course progress for each module
              _count: {
                select: {
                  UserCourseProgress: {
                    where: { userId }, // Filter by userId
                  },
                  sections: true,
                },
              },
            },
          },
        },
      });

      // if (courses?.modules?.length === 0) {
      //   throw new HttpException(
      //     {
      //       status: HttpStatus.NOT_FOUND,
      //       error: 'No Modules found',
      //     },
      //     HttpStatus.NOT_FOUND,
      //   );
      // }
      console.log('modules', courses, courses?.modules);
      return {
        message: 'Successfully fetched all Modules info against course',
        statusCode: 200,
        data: courses?.modules,
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
        include: {
          _count: {
            select: {
              sections: true,
              quizzes: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
        // limit: 10,
        // offset: 10,
      });

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
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          // Add select object to specify desired fields
          id: true,
          // Include other fields you want to fetch (replace with actual field names)
          title: true,
          shortDescription: true,
          chapterId: true,
          createdAt: true,
          updatedAt: true,
          // ...other fields
        },
        // limit: 10,
        // offset: 10,
      });
      // if (!(sections.length > 0)) {
      //   throw new Error('No Sections found');
      // }
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
  ): Promise<any> {
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
          orderBy: {
            createdAt: 'asc',
          },
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
      let assignedQuizzesList =
        chapter?.quizzes?.length > 0 ? [...chapter?.quizzes] : [];
      const quizAnsweredList = quizAnswer?.length > 0 ? [...quizAnswer] : [];
      allSections?.forEach((section: any) => {
        // Check if the section ID exists in completedSections
        const isCompleted = completedSections?.some(
          (completedSection: any) => completedSection.sectionId === section.id,
        );
        section.isLastSeen =
          lastSeenLesson?.sectionId === section.id ? true : false;
        // Insert the boolean value into the section object
        section.isCompleted = isCompleted;
      });

      assignedQuizzesList?.forEach((quiz: any) => {
        // Check if the section ID exists in completedSections
        const isCorrect = quizAnsweredList?.some((completedQuestion: any) =>
          completedQuestion.quizId === quiz.id &&
          completedQuestion?.isAnswerCorrect === true
            ? true
            : false,
        );
        // Insert the boolean value into the section object
        quiz.isCorrect = isCorrect;
      });

      assignedQuizzesList = assignedQuizzesList.filter(
        (item: any) => !item?.isCorrect,
      );

      const mergedArray = insertQuizzes(allSections, assignedQuizzesList);

      if (!(sections.length > 0)) {
        throw new Error('No Sections found');
      }
      return {
        message: 'Successfully fetch all Sections info against chapter',
        statusCode: 200,
        data: mergedArray,
        chapter: chapter,
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
      const updateCourse = {};

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
      const updateModule = {};

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
      const updateChapter = {};

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
      const updateSection = {};

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
      const course = await this.prisma.course.findUnique({
        where: { id },
      });
      if (!course) {
        throw new Error('Course not found');
      }

      await this.prisma.course.delete({
        where: { id },
      });

      return {
        message: 'Successfully deleted course record',
        statusCode: 200,
        data: course,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        // Foreign key constraint violation
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error:
              'Cannot delete course because it is associated with other records.',
          },
          HttpStatus.FORBIDDEN,
        );
      } else {
        // Other errors
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
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        // Foreign key constraint violation
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error:
              'Cannot delete course because it is associated with other records.',
          },
          HttpStatus.FORBIDDEN,
        );
      } else {
        // Other errors
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
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        // Foreign key constraint violation
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error:
              'Cannot delete course because it is associated with other records.',
          },
          HttpStatus.FORBIDDEN,
        );
      } else {
        // Other errors
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

  async deleteSection(id: string): Promise<ResponseDto> {
    // try {
    //   const user = await this.prisma.section.findUnique({
    //     where: { id },
    //   });
    //   if (!user) {
    //     throw new Error('Section not found');
    //   }

    //   await this.prisma.section.delete({
    //     where: { id },
    //   });

    //   return {
    //     message: 'Successfully deleted section record',
    //     statusCode: 200,
    //     data: user,
    //   };
    // } catch (error) {
    //   throw new HttpException(
    //     {
    //       status: HttpStatus.FORBIDDEN,
    //       error: error?.message || 'Something went wrong',
    //     },
    //     HttpStatus.FORBIDDEN,
    //     {
    //       cause: error,
    //     },
    //   );
    // }

    try {
      const section = await this.prisma.section.findUnique({
        where: { id },
      });
      if (!section) {
        throw new Error('Section not found');
      }

      // Find dependent records in LastSeenSection table
      const dependentRecords = await this.prisma.lastSeenSection.findMany({
        where: { sectionId: id },
      });

      // Delete dependent records
      await Promise.all(
        dependentRecords.map(async (record) => {
          await this.prisma.lastSeenSection.delete({
            where: { id: record.id },
          });
        }),
      );

      // Now that dependent records are deleted, delete the section
      await this.prisma.section.delete({
        where: { id },
      });

      return {
        message: 'Successfully deleted section record',
        statusCode: 200,
        data: section,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        // Foreign key constraint violation
        throw new HttpException(
          {
            status: HttpStatus.FORBIDDEN,
            error:
              'Cannot delete course because it is associated with other records.',
          },
          HttpStatus.FORBIDDEN,
        );
      } else {
        // Other errors
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
  async unAssignCourse(userId: string, courseId: string): Promise<ResponseDto> {
    try {
      // Check if the user exists
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        throw new Error('User not found');
      }

      // Check if the course exists
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!course) {
        throw new Error('Course not found');
      }

      // Remove the course from the user's list of assigned courses
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          courses: {
            disconnect: { id: courseId },
          },
        },
      });
      return {
        message: 'Successfully unassigned course to user',
        statusCode: 200,
        data: {},
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to unassign course from user',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }
  async getAllAssignedCourses(userId: string): Promise<any> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          courses: {
            include: {
              modules: {
                select: {
                  chapters: {
                    select: {
                      _count: { select: { sections: true } },
                    },
                  },
                },
              },
              _count: { select: { UserCourseProgress: true } },
              LastSeenSection: {
                take: 1,
                orderBy: { updatedAt: 'desc' },
                include: {
                  section: { select: { title: true } },
                },
              },
            },
          },
        },
      });

      if (!user) {
        throw new HttpException(
          {
            status: HttpStatus.NOT_FOUND,
            error: 'User not found',
          },
          HttpStatus.NOT_FOUND,
        );
      }

      const coursesWithCounts = user.courses.map((course) => {
        // Calculate the total sections count
        const sectionsCount =
          course.modules
            .flatMap((module) => module.chapters)
            .reduce((acc, chapter) => acc + chapter._count.sections, 0) || 0;

        // Get user course progress count
        const userCourseProgressCount = course._count.UserCourseProgress || 0;

        // Get the latest last seen section
        const latestLastSeenSection = course.LastSeenSection[0];

        return {
          ...course,
          percentage: (userCourseProgressCount * 100) / sectionsCount || 0,
          _count: {
            totalSections: sectionsCount,
            userCourseProgress: userCourseProgressCount,
          },
          latestLastSeenSection: latestLastSeenSection
            ? {
                id: latestLastSeenSection.id,
                userId: latestLastSeenSection.userId,
                chapterId: latestLastSeenSection.chapterId,
                moduleId: latestLastSeenSection.moduleId,
                sectionId: latestLastSeenSection.sectionId,
                createdAt: latestLastSeenSection.createdAt,
                updatedAt: latestLastSeenSection.updatedAt,
                title: latestLastSeenSection.section.title,
              }
            : null,
        };
      });

      return {
        message: 'Successfully retrieved assigned courses',
        statusCode: 200,
        data: coursesWithCounts,
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
  // async getAllAssignedCourses(userId: string): Promise<any> {
  //   try {
  //     const user = await this.prisma.user.findUnique({
  //       where: { id: userId },
  //       include: {
  //         courses: true,
  //       },
  //     });

  //     if (!user) {
  //       throw new HttpException(
  //         {
  //           status: HttpStatus.NOT_FOUND,
  //           error: 'User not found',
  //         },
  //         HttpStatus.NOT_FOUND,
  //       );
  //     }

  //     const courseIds = user.courses.map((course) => course.id);

  //     // Fetch section counts, progress counts, and latest last seen sections concurrently
  //     const [sectionCounts, progressCounts, latestLastSeenSections] =
  //       await Promise.all([
  //         this.prisma.course.findMany({
  //           where: {
  //             id: { in: courseIds },
  //           },
  //           select: {
  //             id: true,
  //             modules: {
  //               select: {
  //                 chapters: {
  //                   select: {
  //                     _count: {
  //                       select: { sections: true },
  //                     },
  //                   },
  //                 },
  //               },
  //             },
  //           },
  //         }),
  //         this.prisma.userCourseProgress.groupBy({
  //           by: ['courseId'],
  //           where: {
  //             courseId: { in: courseIds },
  //           },
  //           _count: {
  //             courseId: true,
  //           },
  //         }),
  //         this.prisma.lastSeenSection.findMany({
  //           where: {
  //             userId: userId,
  //             courseId: { in: courseIds },
  //           },
  //           orderBy: {
  //             updatedAt: 'desc',
  //           },
  //           distinct: ['courseId'],
  //           include: {
  //             section: {
  //               select: {
  //                 title: true,
  //               },
  //             },
  //           },
  //         }),
  //       ]);

  //     // Map over courses and combine counts
  //     const coursesWithCounts = user.courses.map((course) => {
  //       const sectionsCount =
  //         sectionCounts
  //           .find((sc) => sc.id === course.id)
  //           ?.modules.flatMap((module) => module.chapters)
  //           .reduce((acc, chapter) => acc + chapter._count.sections, 0) || 0;

  //       const userCourseProgressCount =
  //         progressCounts.find((pc) => pc.courseId === course.id)?._count
  //           .courseId || 0;

  //       const latestLastSeenSection = latestLastSeenSections.find(
  //         (lss) => lss.courseId === course.id,
  //       );

  //       return {
  //         ...course,
  //         percentage: (userCourseProgressCount * 100) / sectionsCount || 0,
  //         _count: {
  //           totalSections: sectionsCount,
  //           userCourseProgress: userCourseProgressCount,
  //         },
  //         latestLastSeenSection: latestLastSeenSection
  //           ? {
  //               id: latestLastSeenSection.id,
  //               userId: latestLastSeenSection.userId,
  //               chapterId: latestLastSeenSection.chapterId,
  //               moduleId: latestLastSeenSection.moduleId,
  //               sectionId: latestLastSeenSection.sectionId,
  //               createdAt: latestLastSeenSection.createdAt,
  //               updatedAt: latestLastSeenSection.updatedAt,
  //               title: latestLastSeenSection.section.title,
  //             }
  //           : null,
  //       };
  //     });

  //     return {
  //       message: 'Successfully retrieved assigned courses',
  //       statusCode: 200,
  //       data: coursesWithCounts,
  //     };
  //   } catch (error) {
  //     throw new HttpException(
  //       {
  //         status: HttpStatus.FORBIDDEN,
  //         error: error?.message || 'Something went wrong',
  //       },
  //       HttpStatus.FORBIDDEN,
  //       {
  //         cause: error,
  //       },
  //     );
  //   }
  // }

  //   {
  //     "id": "043d1d75-fc97-4159-a54b-24bae79b798c",
  //     "title": "Nebosh",
  //     "description": "test",
  //     "image": cloud",
  //     "overview": "<p>testing</p>",
  //     "duration": "Nebosh",
  //     "assessment": "<p>trd</p>",
  //     "createdAt": "2024-06-15T10:35:45.162Z",
  //     "updatedAt": "2024-06-22T14:45:07.710Z",
  //     "syllabusOverview": "<p>test423423</p>",
  //     "resourcesOverview": "<p>test</p>",
  //     "assessments": [
  //         {
  //             "id": "18d7e202-0981-4d7a-a053-1bcc539d371f",
  //             "file": "test",
  //             "name": "test",
  //             "type": "t"
  //         }
  //     ],
  //     "resources": [
  //         {
  //             "id": "aea5f6aa-bca0-4e43-8cc7-3052b6a19221",
  //             "file": "test",
  //             "name": "test",
  //             "type": "t"
  //         }
  //     ],
  //     "syllabus": [
  //         {
  //             "id": "dca9b953-3ade-45a5-9e63-32046e999294",
  //             "file": "test",
  //             "name": "test",
  //             "type": "t"
  //         }
  //     ],
  //     "UserCourseProgress": [
  //         {
  //             "id": "ebf9c08b-32ec-4547-9e9f-78fcbfdb5b94",
  //             "userId": "df70edfe-9155-4b01-a3f5-c2f035b03f32",
  //             "courseId": "043d1d75-fc97-4159-a54b-24bae79b798c",
  //             "chapterId": "deb63c2d-1eee-466c-9eb6-13d5dc93b433",
  //             "sectionId": "cc36a05e-a79e-41cc-9dc7-daf00f0ba1fe",
  //             "createdAt": "2024-06-15T10:48:16.301Z",
  //             "updatedAt": "2024-06-15T10:48:16.301Z"
  //         },
  //         {
  //             "id": "0fddfad1-ed4d-4ab5-b7cb-2c10a1af4f2e",
  //             "userId": "df70edfe-9155-4b01-a3f5-c2f035b03f32",
  //             "courseId": "043d1d75-fc97-4159-a54b-24bae79b798c",
  //             "chapterId": "deb63c2d-1eee-466c-9eb6-13d5dc93b433",
  //             "sectionId": "fd10498e-6b92-46f6-b553-170bfe3640ad",
  //             "createdAt": "2024-06-15T17:21:29.444Z",
  //             "updatedAt": "2024-06-15T17:21:29.444Z"
  //         },
  //         {
  //             "id": "87c3b32a-d98c-4f67-b4dd-90d437368e5a",
  //             "userId": "df70edfe-9155-4b01-a3f5-c2f035b03f32",
  //             "courseId": "043d1d75-fc97-4159-a54b-24bae79b798c",
  //             "chapterId": "deb63c2d-1eee-466c-9eb6-13d5dc93b433",
  //             "sectionId": "dddb1981-0891-45ee-8679-a7966cbf396f",
  //             "createdAt": "2024-06-15T17:21:33.437Z",
  //             "updatedAt": "2024-06-15T17:21:33.437Z"
  //         },
  //         {
  //             "id": "ff767c36-0893-4da9-93d0-0296152ae035",
  //             "userId": "0ebee5cd-1e46-4bfe-9d4d-534568af87dd",
  //             "courseId": "043d1d75-fc97-4159-a54b-24bae79b798c",
  //             "chapterId": "deb63c2d-1eee-466c-9eb6-13d5dc93b433",
  //             "sectionId": "cc36a05e-a79e-41cc-9dc7-daf00f0ba1fe",
  //             "createdAt": "2024-06-15T17:21:46.826Z",
  //             "updatedAt": "2024-06-15T17:21:46.826Z"
  //         },
  //         {
  //             "id": "15ae3253-c809-4821-876a-1dbb84560b04",
  //             "userId": "df70edfe-9155-4b01-a3f5-c2f035b03f32",
  //             "courseId": "043d1d75-fc97-4159-a54b-24bae79b798c",
  //             "chapterId": "deb63c2d-1eee-466c-9eb6-13d5dc93b433",
  //             "sectionId": "b1cb4bec-4bfd-4225-9b4b-e474f4215059",
  //             "createdAt": "2024-06-15T19:52:27.183Z",
  //             "updatedAt": "2024-06-15T19:52:27.183Z"
  //         },
  //         {
  //             "id": "72166c0e-1716-4636-883d-9919eeb6b289",
  //             "userId": "df70edfe-9155-4b01-a3f5-c2f035b03f32",
  //             "courseId": "043d1d75-fc97-4159-a54b-24bae79b798c",
  //             "chapterId": "deb63c2d-1eee-466c-9eb6-13d5dc93b433",
  //             "sectionId": "2e9e0168-414b-442d-a322-c147b220834f",
  //             "createdAt": "2024-06-15T19:52:35.443Z",
  //             "updatedAt": "2024-06-15T19:52:35.443Z"
  //         },
  //         {
  //             "id": "b63e72c4-7c2f-4c07-87f6-196d2c98d7b3",
  //             "userId": "0ebee5cd-1e46-4bfe-9d4d-534568af87dd",
  //             "courseId": "043d1d75-fc97-4159-a54b-24bae79b798c",
  //             "chapterId": "deb63c2d-1eee-466c-9eb6-13d5dc93b433",
  //             "sectionId": "fd10498e-6b92-46f6-b553-170bfe3640ad",
  //             "createdAt": "2024-06-22T16:32:01.863Z",
  //             "updatedAt": "2024-06-22T16:32:01.863Z"
  //         },
  //         {
  //             "id": "683a3718-e484-4029-aba9-a2b80fa82b08",
  //             "userId": "0ebee5cd-1e46-4bfe-9d4d-534568af87dd",
  //             "courseId": "043d1d75-fc97-4159-a54b-24bae79b798c",
  //             "chapterId": "deb63c2d-1eee-466c-9eb6-13d5dc93b433",
  //             "sectionId": "dddb1981-0891-45ee-8679-a7966cbf396f",
  //             "createdAt": "2024-06-22T16:34:08.061Z",
  //             "updatedAt": "2024-06-22T16:34:08.061Z"
  //         },
  //         {
  //             "id": "135ff032-2a44-4fd4-b9bf-80bc7f7eb90d",
  //             "userId": "0ebee5cd-1e46-4bfe-9d4d-534568af87dd",
  //             "courseId": "043d1d75-fc97-4159-a54b-24bae79b798c",
  //             "chapterId": "deb63c2d-1eee-466c-9eb6-13d5dc93b433",
  //             "sectionId": "b1cb4bec-4bfd-4225-9b4b-e474f4215059",
  //             "createdAt": "2024-06-22T19:23:45.318Z",
  //             "updatedAt": "2024-06-22T19:23:45.318Z"
  //         },
  //         {
  //             "id": "9db4d967-0ab4-4a32-9572-3670ea9fdf0f",
  //             "userId": "0ebee5cd-1e46-4bfe-9d4d-534568af87dd",
  //             "courseId": "043d1d75-fc97-4159-a54b-24bae79b798c",
  //             "chapterId": "deb63c2d-1eee-466c-9eb6-13d5dc93b433",
  //             "sectionId": "4d8d91d1-71bb-4a7d-a207-58ce5df78754",
  //             "createdAt": "2024-06-22T19:23:49.607Z",
  //             "updatedAt": "2024-06-22T19:23:49.607Z"
  //         },
  //         {
  //             "id": "fe36e457-e36f-4843-87a1-3514f3fae035",
  //             "userId": "0ebee5cd-1e46-4bfe-9d4d-534568af87dd",
  //             "courseId": "043d1d75-fc97-4159-a54b-24bae79b798c",
  //             "chapterId": "deb63c2d-1eee-466c-9eb6-13d5dc93b433",
  //             "sectionId": "385d63d9-ad00-4d01-83d3-ccda8cb5f119",
  //             "createdAt": "2024-06-22T19:23:54.858Z",
  //             "updatedAt": "2024-06-22T19:23:54.858Z"
  //         },
  //         {
  //             "id": "bc76f093-03bc-4e52-9be1-520c0552b687",
  //             "userId": "0ebee5cd-1e46-4bfe-9d4d-534568af87dd",
  //             "courseId": "043d1d75-fc97-4159-a54b-24bae79b798c",
  //             "chapterId": "deb63c2d-1eee-466c-9eb6-13d5dc93b433",
  //             "sectionId": "371f0b39-3f78-48c2-8d8b-f45f7b9878b3",
  //             "createdAt": "2024-06-22T19:23:59.100Z",
  //             "updatedAt": "2024-06-22T19:23:59.100Z"
  //         },
  //         {
  //             "id": "f2b6de88-538d-4957-8b9d-66fc08254019",
  //             "userId": "0ebee5cd-1e46-4bfe-9d4d-534568af87dd",
  //             "courseId": "043d1d75-fc97-4159-a54b-24bae79b798c",
  //             "chapterId": "deb63c2d-1eee-466c-9eb6-13d5dc93b433",
  //             "sectionId": "433ebc6a-da57-4913-9f06-76766632e867",
  //             "createdAt": "2024-06-22T19:25:14.659Z",
  //             "updatedAt": "2024-06-22T19:25:14.659Z"
  //         }
  //     ],
  //     "totalSections": 21,
  //     "percentage": 38.095238095238095,
  //     "latestLastSeenSection": {
  //         "id": "28de77ba-3834-4b13-af73-6c94df0263b7",
  //         "userId": "0ebee5cd-1e46-4bfe-9d4d-534568af87dd",
  //         "chapterId": "deb63c2d-1eee-466c-9eb6-13d5dc93b433",
  //         "moduleId": "3ebe4e27-b1d3-4e03-9457-47bb03e6b3c3",
  //         "sectionId": "dddb1981-0891-45ee-8679-a7966cbf396f",
  //         "createdAt": "2024-06-15T17:21:22.971Z",
  //         "updatedAt": "2024-06-22T19:23:40.689Z",
  //         "title": "Lesson 3"
  //     }
  // }

  async updateUserChapterProgress(
    userId: string,
    body: any,
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
          moduleId: body.moduleId,
        },
      });
      if (!userCourseProgress) {
        userCourseProgress = await this.prisma.userCourseProgress.create({
          data: {
            userId: userId,
            courseId: body.courseId,
            chapterId: body.chapterId,
            sectionId: body.sectionId,
            moduleId: body.moduleId,
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
      const userCourseProgress = await this.prisma.userCourseProgress.findMany({
        where: {
          userId,
          courseId,
          chapterId,
        },
      });

      const module = await this.prisma.module.findFirst({
        where: {
          courseId,
        },
      });
      const chapter = await this.prisma.chapter.findFirst({
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
      const getLastSeenSection = await this.prisma.lastSeenSection.findUnique({
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
    moduleId: string,
    courseId: string,
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
          moduleId,
          courseId,
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
