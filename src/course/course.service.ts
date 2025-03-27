import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Course, Module, Chapter, Section, Prisma } from '@prisma/client';
import {
  // AssignCourseDto,
  CourseDto,
  ModuleDto,
  ResponseDto,
  UpdateCourseDto,
} from '../dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CourseService {
  constructor(private prisma: PrismaService) {}
  async getCourseReport(courseId: any, userId: any): Promise<any> {
    try {
      const [course, userDetails]: any = await Promise.all([
        this.prisma.course.findUnique({
          where: { id: courseId },
          select: {
            id: true,
            title: true,
            users: {
              where: {
                id: userId,
              },
            },
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
                        quizzes: true,
                        QuizAnswer: {
                          where: { isAnswerCorrect: true, userId }, // Count correct answers
                        },
                        LastSeenSection: {
                          where: { userId }, // 👈 Filter count by userId
                        },
                      },
                    },
                  },
                  orderBy: {
                    createdAt: 'asc',
                  },
                },
                // Get the count of user course progress for each module
              },
            },
          },
        }),
        this.prisma.user.findUnique({
          where: {
            id: userId,
          },
        }),
      ]);

      // Step 1: Calculate total number of sections in the entire course
      let totalSectionsInCourse = 0;
      course.modules.forEach((module) => {
        module.chapters.forEach((chapter) => {
          totalSectionsInCourse += chapter._count.sections;
        });
      });

      // Step 2: Calculate progress and contribution for each chapter
      course.modules.forEach((module) => {
        module.chapters.forEach((chapter) => {
          const userCourseProgress = chapter._count.UserCourseProgress;
          const totalSectionsInChapter = chapter._count.sections;

          // Calculate progress percentage
          const progress = (userCourseProgress * 100) / totalSectionsInChapter;

          // Calculate contribution percentage
          const contribution =
            (userCourseProgress * 100) / totalSectionsInCourse;

          // Add progress and contribution to chapter
          chapter.progress = progress.toFixed(2); // Optional: format to 2 decimal places
          chapter.contribution = contribution.toFixed(2); // Optional: format to 2 decimal places
        });
      });

      return {
        message: 'Successfully retrieved datas',
        statusCode: 200,
        data: course.modules,
        user: userDetails,
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

  async getCourseDates(courseId: any, userId: any): Promise<any> {
    try {
      const allProgressItem = await this.prisma.UserCourseProgress.findMany({
        where: {
          courseId,
          userId,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      const courseStartDate = allProgressItem?.[0]?.createdAt;

      return {
        message: 'Successfully retrieved datas',
        statusCode: 200,
        data: { courseStartDate },
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
              'Cannot delete it because it is associated with other records.',
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
              'Cannot delete it because it is associated with other records.',
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
          price: body.price,
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
  async getCourseDetailPublic(id: string): Promise<ResponseDto> {
    try {
      const course = await this.prisma.course.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          description: true,
          image: true,
          price: true,
          modules: {
            select: {
              id: true,
              title: true,
              chapters: true,
              _count: true,
            },
          },
        },
      });
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
  async getAllPublicCourses(): Promise<ResponseDto> {
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
      });
      if (!(courses.length > 0)) {
        return {
          message: 'Successfully fetch all Courses info',
          statusCode: 200,
          data: [],
        };
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
  async getAllUserModules(id: string, userId: string): Promise<any> {
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
                  QuizProgress: {
                    where: { userId },
                  },
                },
                orderBy: {
                  createdAt: 'asc',
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
    try {
      const [sections, userCourseProgress, chapter, lastSeenLesson] =
        await Promise.all([
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

          this.prisma.lastSeenSection.findUnique({
            where: { userId_chapterId: { userId, chapterId: id } },
          }),
        ]);

      const allSections = sections?.length > 0 ? [...sections] : [];
      const completedSections =
        userCourseProgress?.length > 0 ? [...userCourseProgress] : [];

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

      if (!(sections.length > 0)) {
        throw new Error('No Sections found');
      }
      return {
        message: 'Successfully fetch all Sections info against chapter',
        statusCode: 200,
        data: allSections,
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
              'Cannot delete it because it is associated with other records.',
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
              'Cannot delete it because it is associated with other records.',
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
              'Cannot delete it because it is associated with other records.',
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
              'Cannot delete it because it is associated with other records.',
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

  // async assignCourse(userId: string, courseId: string): Promise<ResponseDto> {
  //   try {
  //     const course = await this.prisma.course.findUnique({
  //       where: { id: courseId },
  //     });
  //     if (!course) {
  //       throw new Error('course not found');
  //     }
  //     const user = await this.prisma.user.findUnique({
  //       where: { id: userId },
  //     });
  //     if (!user) {
  //       throw new Error('user not found');
  //     }

  //     // Assign the course to the user
  //     await this.prisma.user.update({
  //       where: { id: userId },
  //       data: {
  //         courses: {
  //           connect: { id: courseId },
  //         },
  //       },
  //     });

  //     return {
  //       message: 'Successfully assigned course to user',
  //       statusCode: 200,
  //       data: {},
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

  async assignCourse(userId: string, courseId: string): Promise<ResponseDto> {
    try {
      // Check if the course exists
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!course) {
        throw new Error('Course not found');
      }

      // Check if the user exists
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        throw new Error('User not found');
      }

      // Check if the course is already assigned to the user
      const existingAssignment = await this.prisma.userCourse.findUnique({
        where: {
          userId_courseId: {
            userId,
            courseId,
          },
        },
      });
      if (existingAssignment) {
        throw new Error('Course already assigned to the user');
      }

      // Assign the course to the user by creating a new entry in UserCourse table
      await this.prisma.userCourse.create({
        data: {
          userId,
          courseId,
          isActive: false, // Default status as inactive
          isPaid: false, // Default payment status as unpaid
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

  async assignCoursePublic(
    userId: string,
    courseId: string,
  ): Promise<ResponseDto> {
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
      await this.prisma.userCourse.create({
        data: {
          userId,
          courseId,
          isActive: false, // Default status as inactive
          isPaid: false, // Default payment status as unpaid
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

      // Check if the user-course relation exists
      const userCourse = await this.prisma.userCourse.findFirst({
        where: { userId, courseId },
      });
      if (!userCourse) {
        throw new Error('User is not assigned to this course');
      }

      // Remove the relation from the UserCourse table
      await this.prisma.userCourse.delete({
        where: {
          id: userCourse.id,
        },
      });

      return {
        message: 'Successfully unassigned course from user',
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

  async toggleCourseStatus(
    userId: string,
    courseId: string,
    isActive: boolean,
  ): Promise<ResponseDto> {
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

      // Check if the user-course relation exists
      const userCourse = await this.prisma.userCourse.findFirst({
        where: { userId, courseId },
      });
      if (!userCourse) {
        throw new Error('User is not assigned to this course');
      }

      // Update the isActive status for the user-course relation
      await this.prisma.userCourse.update({
        where: { id: userCourse.id },
        data: { isActive },
      });

      return {
        message: `Successfully ${
          isActive ? 'activated' : 'deactivated'
        } course status for user`,
        statusCode: 200,
        data: {
          userId,
          courseId,
          isActive,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error:
            error?.message ||
            `Failed to ${isActive ? 'activate' : 'deactivate'} course status`,
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async toggleCoursePaymentStatus(
    userId: string,
    courseId: string,
    isPaid: boolean,
  ): Promise<ResponseDto> {
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

      // Check if the user-course relation exists
      const userCourse = await this.prisma.userCourse.findFirst({
        where: { userId, courseId },
      });
      if (!userCourse) {
        throw new Error('User is not assigned to this course');
      }

      // Update the isActive status for the user-course relation
      await this.prisma.userCourse.update({
        where: { id: userCourse.id },
        data: { isPaid },
      });

      return {
        message: `Successfully ${
          isPaid ? 'activated' : 'deactivated'
        } course payment status for user`,
        statusCode: 200,
        data: {
          userId,
          courseId,
          isPaid,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error:
            error?.message ||
            `Failed to ${
              isPaid ? 'activate' : 'deactivate'
            } course payment status`,
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async getAllAssignedCourses(userId: string, role: string): Promise<any> {
    try {
      // Define the condition based on the user's role
      const whereCondition =
        role === 'user' ? { userId, isActive: true } : { userId };
      // Fetch the assigned courses for the user from the UserCourse table
      const assignedCourses = await this.prisma.userCourse.findMany({
        where: whereCondition,
        include: {
          course: {
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
              _count: { select: { UserCourseProgress: { where: { userId } } } },
              LastSeenSection: {
                where: { userId },
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

      if (!assignedCourses.length) {
        // throw new HttpException(
        //   {
        //     status: HttpStatus.NOT_FOUND,
        //     error: 'No courses assigned to this user',
        //   },
        //   HttpStatus.NOT_FOUND,
        // );
        return {
          message: 'Successfully retrieved assigned courses',
          statusCode: 200,
          data: [],
        };
      }

      // Map the assigned courses to include additional details
      const coursesWithDetails = assignedCourses.map((userCourse) => {
        const { course, isActive, isPaid } = userCourse;

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
          isActive, // Include the isActive field
          isPaid, // Include the isPaid field
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

      console.log({ whereCondition });

      return {
        message: 'Successfully retrieved assigned courses',
        statusCode: 200,
        data: coursesWithDetails,
      };
    } catch (error) {
      console.log({ error });
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async getAllAssignedCoursesPublic(userId: string): Promise<any> {
    try {
      // Fetch assigned courses from UserCourse table
      const assignedCourses = await this.prisma.userCourse.findMany({
        where: { userId },
        include: {
          course: {
            select: {
              id: true,
              title: true,
              price: true,
            },
          },
        },
        // select: {
        //   course: {
        //     select: {
        //       id: true,
        //       title: true,
        //       price: true,
        //       // isActive: true,
        //     },
        //   },
        // },
      });
      // Check if no courses are assigned
      // if (!assignedCourses.length) {
      //   throw new HttpException(
      //     {
      //       status: HttpStatus.NOT_FOUND,
      //       error: 'No courses assigned to this user',
      //     },
      //     HttpStatus.NOT_FOUND,
      //   );
      // }

      // Map courses to extract only public fields
      // const courses = assignedCourses.map((userCourse) => userCourse.course);

      return {
        message: 'Successfully retrieved assigned courses',
        statusCode: 200,
        data: assignedCourses,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Something went wrong',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

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
