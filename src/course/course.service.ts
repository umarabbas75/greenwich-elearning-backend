import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Course, Module, Chapter, Section, Prisma, Role } from '@prisma/client';
import {
  // AssignCourseDto,
  CourseDto,
  ModuleDto,
  ResponseDto,
  UpdateCourseDto,
  CreateSectionDto,
  CreateMatchAndLearnSectionDto,
  CreateVisualActivitySectionDto,
  CreateOrderingSectionDto,
  CreateMatchingSectionDto,
  UpdateSectionDto,
  UpdateMatchAndLearnSectionDto,
  UpdateVisualActivitySectionDto,
  UpdateOrderingSectionDto,
  UpdateMatchingSectionDto,
  UpdateSectionOrderDto,
  SectionType,
} from '../dto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { assertChapterAccessible, recordChapterAndModuleCompletionIfNeeded } from '../utils/chapter-progression';
import {
  applyModuleRollup,
  buildChapterActivityMaps,
  buildChapterReportRow,
  SectionReportMeta,
} from '../utils/course-report';
import { promoteFormPhotoToUserIfMissing } from '../utils/promote-form-photo-to-user';
import { MailService } from '../mail/mail.service';
import { FeedbackService } from '../feedback/feedback.service';
import { CourseVersionService } from '../course-version/course-version.service';
@Injectable()
export class CourseService {
  private static readonly completionLogger = new Logger(CourseService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private mail: MailService,
    private feedbackService: FeedbackService,
    private courseVersionService: CourseVersionService,
  ) {}

  /** True iff the learner has been certified-complete on this course. */
  private async isCourseFrozen(
    userId: string,
    courseId: string,
  ): Promise<boolean> {
    const completion = await this.prisma.courseCompletion.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { courseCompletedAt: true },
    });
    return !!completion?.courseCompletedAt;
  }

  private shuffleArray<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Publishes a new version after admin structural edits (add/remove module/chapter/section). */
  private async autoPublishAfterStructureChange(
    courseId: string,
    adminId: string | null | undefined,
    changeNotes: string,
  ): Promise<{ versionNumber: number; versionId: string } | null> {
    try {
      const published =
        await this.courseVersionService.autoPublishAfterStructuralChange(
          courseId,
          adminId,
          changeNotes,
        );
      CourseService.completionLogger.log(
        `Auto-published v${published.versionNumber} for course ${courseId}`,
      );
      return published;
    } catch (error) {
      CourseService.completionLogger.error(
        `Auto-publish failed for course ${courseId}: ${error?.message ?? error}`,
      );
      return null;
    }
  }

  private async resolveCourseIdFromModuleId(
    moduleId: string,
  ): Promise<string> {
    const mod = await this.prisma.module.findUnique({
      where: { id: moduleId },
      select: { courseId: true },
    });
    if (!mod) {
      throw new Error('Module not found');
    }
    return mod.courseId;
  }

  private async resolveCourseIdFromChapterId(
    chapterId: string,
  ): Promise<string> {
    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { module: { select: { courseId: true } } },
    });
    if (!chapter) {
      throw new Error('Chapter not found');
    }
    return chapter.module.courseId;
  }

  private assertValidOrderingItems(
    items: { id: string }[],
    correctOrder: string[],
  ): void {
    const ids = new Set(items.map((i) => i.id));
    if (ids.size !== items.length) {
      throw new Error('Ordering items must have unique ids');
    }
    if (correctOrder.length !== ids.size) {
      throw new Error('correctOrder must list each item id exactly once');
    }
    for (const id of correctOrder) {
      if (!ids.has(id)) {
        throw new Error(`correctOrder references unknown id: ${id}`);
      }
    }
  }

  private sanitizeLessonSectionForStudent(
    section: Record<string, unknown>,
  ): void {
    if (section.type === SectionType.ORDERING) {
      section.config = null;
    } else if (section.type === SectionType.MATCHING) {
      const cfg = section.config as {
        pairs?: Array<{ id: string; left: string; right: string }>;
      } | null;
      if (cfg?.pairs?.length) {
        const categories = this.shuffleArray(
          cfg.pairs.map((p) => ({ id: p.id, text: p.right })),
        );
        section.config = {
          pairs: cfg.pairs.map((p) => ({ id: p.id, left: p.left })),
          categories,
        };
      }
    }
  }

  async markFormComplete(
    userId: string,
    userRole: Role,
    courseId: string,
    formId: string,
    metadata: Record<string, unknown> | undefined,
    courseFormId: string,
  ): Promise<any> {
    const courseForm = await this.prisma.courseForm.findUnique({
      where: { id: courseFormId },
    });
    if (!courseForm) {
      throw new BadRequestException({
        detail:
          'Invalid courseFormId: that course form assignment was not found',
      });
    }
    if (courseForm.courseId !== courseId || courseForm.formId !== formId) {
      throw new BadRequestException({
        detail: 'courseFormId does not match the given courseId and formId',
      });
    }

    await this._assertEnrollmentUsable(userId, courseId, userRole);

    const existing = await this.prisma.userFormCompletion.findUnique({
      where: {
        userId_courseId_formId: { userId, courseId, formId },
      },
    });
    if (existing?.isComplete) {
      return {
        alreadyCompleted: true,
        id: existing.id,
        courseFormId: existing.courseFormId,
        formId: existing.formId,
        completedAt: existing.completedAt,
        metadata: existing.metadata,
      };
    }

    const completion = await this.prisma.userFormCompletion.upsert({
      where: {
        userId_courseId_formId: {
          userId,
          courseId,
          formId,
        },
      },
      create: {
        userId,
        courseId,
        formId,
        courseFormId,
        isComplete: true,
        completedAt: new Date(),
        metadata: (metadata ?? {}) as Prisma.InputJsonValue,
      },
      update: {
        isComplete: true,
        completedAt: new Date(),
        metadata: (metadata ?? {}) as Prisma.InputJsonValue,
        courseFormId,
      },
    });

    try {
      await promoteFormPhotoToUserIfMissing(this.prisma, userId, metadata);
    } catch (photoErr) {
      const msg = photoErr instanceof Error ? photoErr.message : String(photoErr);
      CourseService.completionLogger.warn(
        `Form photo promotion failed for user ${userId}: ${msg}`,
      );
    }

    return completion;
  }

  /** Which requirement forms exist for the course and whether the current user completed them. */
  async getStudentCourseFormsStatus(
    userId: string,
    userRole: Role,
    courseId: string,
  ): Promise<{
    courseId: string;
    forms: Array<{
      courseFormId: string;
      formId: string;
      formName: string;
      isRequired: boolean;
      isComplete: boolean;
      completedAt: Date | null;
    }>;
  }> {
    await this._assertEnrollmentUsable(userId, courseId, userRole);

    const forms = await this.prisma.courseForm.findMany({
      where: { courseId },
      orderBy: { createdAt: 'asc' },
      include: {
        userFormCompletions: {
          where: { userId },
          take: 1,
        },
      },
    });

    return {
      courseId,
      forms: forms.map((f) => {
        const c = f.userFormCompletions[0];
        return {
          courseFormId: f.id,
          formId: f.formId,
          formName: f.formName,
          isRequired: f.isRequired,
          isComplete: c?.isComplete ?? false,
          completedAt: c?.completedAt ?? null,
        };
      }),
    };
  }

  /** Course forms for a user, including submitted answers (e.g. registration form metadata). */
  private async getCourseFormsWithMetadataForUser(
    userId: string,
    courseId: string,
  ): Promise<
    Array<{
      courseFormId: string;
      formId: string;
      formName: string;
      isRequired: boolean;
      isComplete: boolean;
      completedAt: Date | null;
      metadata: Prisma.JsonValue | null;
    }>
  > {
    const forms = await this.prisma.courseForm.findMany({
      where: { courseId },
      orderBy: { createdAt: 'asc' },
      include: {
        userFormCompletions: {
          where: { userId },
          take: 1,
          select: {
            isComplete: true,
            completedAt: true,
            metadata: true,
          },
        },
      },
    });

    return forms.map((f) => {
      const c = f.userFormCompletions[0];
      return {
        courseFormId: f.id,
        formId: f.formId,
        formName: f.formName,
        isRequired: f.isRequired,
        isComplete: c?.isComplete ?? false,
        completedAt: c?.completedAt ?? null,
        metadata: c?.metadata ?? null,
      };
    });
  }

  private async fetchReportActivityData(
    userId: string,
    courseId: string,
    chapterIds: string[],
  ) {
    const [progressRows, quizAnswerRows, lastSeenRows, quizProgressRows, timeSpentRows] =
      await Promise.all([
        this.prisma.userCourseProgress.findMany({
          where: { userId, courseId },
          select: { sectionId: true, chapterId: true, createdAt: true },
        }),
        chapterIds.length === 0
          ? Promise.resolve([] as { chapterId: string | null }[])
          : this.prisma.quizAnswer.findMany({
              where: {
                userId,
                isAnswerCorrect: true,
                chapterId: { in: chapterIds },
              },
              select: { chapterId: true },
            }),
        chapterIds.length === 0
          ? Promise.resolve(
              [] as Array<{
                chapterId: string;
                sectionId: string;
                createdAt: Date;
                updatedAt: Date;
              }>,
            )
          : this.prisma.lastSeenSection.findMany({
              where: { userId, chapterId: { in: chapterIds } },
              select: {
                chapterId: true,
                sectionId: true,
                createdAt: true,
                updatedAt: true,
              },
            }),
        chapterIds.length === 0
          ? Promise.resolve([])
          : this.prisma.quizProgress.findMany({
              where: { userId, chapterId: { in: chapterIds } },
            }),
        this.prisma.sectionTimeSpent.findMany({
          where: { userId, courseId },
          select: { sectionId: true, totalSeconds: true, totalAttempts: true },
        }),
      ]);

    return buildChapterActivityMaps({
      progressRows,
      quizAnswerRows,
      lastSeenRows,
      quizProgressRows,
      timeSpentRows,
    });
  }

  async markPolicyItemAsComplete({
    userId,
    courseId,
    policyId,
    policyItemId,
  }: {
    userId: string;
    courseId: string;
    policyId: string;
    policyItemId: string;
  }): Promise<ResponseDto> {
    try {
      // Execute all operations in a single transaction
      const [itemCompletion, requiredItems, completedItems] =
        await this.prisma.$transaction([
          // 1. Mark the individual Policy Item as completed
          this.prisma.userPolicyItemCompletion.upsert({
            where: {
              userId_itemId: {
                userId,
                itemId: policyItemId,
              },
            },
            update: {
              isComplete: true,
              completedAt: new Date(),
            },
            create: {
              userId,
              itemId: policyItemId,
              isComplete: true,
              completedAt: new Date(),
            },
          }),

          // 2. Get all required items for this policy
          this.prisma.policyItem.findMany({
            where: {
              policyId,
              isRequired: true,
            },
            select: { id: true },
          }),

          // 3. Get completed items (including the one we just marked)
          this.prisma.userPolicyItemCompletion.findMany({
            where: {
              userId,
              itemId: {
                in: await this.prisma.policyItem
                  .findMany({
                    where: { policyId, isRequired: true },
                    select: { id: true },
                  })
                  .then((items) => items.map((i) => i.id)),
              },
              isComplete: true,
            },
            select: { itemId: true },
          }),
        ]);

      // Check if all required items are completed
      const allRequiredItemsCompleted =
        requiredItems.length === completedItems.length;

      // 4. If all required items completed, mark policy as complete
      const policyCompletion = allRequiredItemsCompleted
        ? await this.prisma.userPolicyCompletion.upsert({
            where: {
              userId_courseId_policyId: {
                userId,
                courseId,
                policyId,
              },
            },
            update: {
              isComplete: true,
              completedAt: new Date(),
            },
            create: {
              userId,
              courseId,
              policyId,
              isComplete: true,
              completedAt: new Date(),
            },
          })
        : null;

      return {
        message:
          'Policy item marked as completed' +
          (allRequiredItemsCompleted ? ', Policy completed as well' : ''),
        statusCode: HttpStatus.OK,
        data: {
          itemCompletion,
          policyCompletion,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to mark policy item as completed',
        },
        HttpStatus.FORBIDDEN,
        {
          cause: error,
        },
      );
    }
  }

  async getUserPolicyCompletions({ courseId, userId }): Promise<any> {
    try {
      // Get all policies with their items and completion status
      const policies = await this.prisma.policy.findMany({
        where: { courseId },
        orderBy: { order: 'asc' },
        include: {
          items: {
            orderBy: { order: 'asc' },
            include: {
              completions: {
                where: { userId },
                select: {
                  isComplete: true,
                  completedAt: true,
                },
              },
            },
          },
          completions: {
            where: { userId },
            select: {
              isComplete: true,
              completedAt: true,
            },
          },
        },
      });

      // Transform the data to match the frontend expectations
      const transformedPolicies = policies.map((policy) => {
        // Calculate policy item completion status
        const items = policy.items.map((item) => ({
          policyItemId: item.id,
          title: item.title,
          description: item.description,
          link: item.link,
          isRequired: item.isRequired,
          isComplete: item.completions[0]?.isComplete || false,
          completedAt: item.completions[0]?.completedAt || null,
        }));

        // Policy is complete only if all required items are complete
        const isPolicyComplete =
          policy.completions[0]?.isComplete ||
          (items.length > 0 &&
            items.every((item) => !item.isRequired || item.isComplete));

        return {
          policyId: policy.id,
          title: policy.title,
          description: policy.description,
          isComplete: isPolicyComplete,
          completedAt: policy.completions[0]?.completedAt || null,
          items,
        };
      });

      // Calculate completion counts
      const totalPolicies = policies.length;
      const completedPolicies = transformedPolicies.filter(
        (p) => p.isComplete,
      ).length;
      const totalItems = transformedPolicies.reduce(
        (sum, policy) => sum + policy.items.length,
        0,
      );
      const completedItems = transformedPolicies.reduce(
        (sum, policy) =>
          sum + policy.items.filter((item) => item.isComplete).length,
        0,
      );

      // Calculate required items specific counts
      const allItems = transformedPolicies.flatMap((policy) => policy.items);
      const requiredItems = allItems.filter((item) => item.isRequired).length;
      const completedRequiredItems = allItems.filter(
        (item) => item.isRequired && item.isComplete,
      ).length;

      return {
        totalPolicies,
        completedPolicies,
        totalItems,
        completedItems,
        requiredItems, // Total number of required items
        completedRequiredItems, // Number of completed required items
        policies: transformedPolicies,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Failed to fetch policy completions',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getCourseReport(courseId: any, userId: any): Promise<any> {
    try {
      const [
        userDetails,
        completion,
        curriculum,
        courseForms,
        chapterCompletions,
        moduleCompletions,
        newSinceCompletion,
        firstProgress,
      ] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId } }),
        this.prisma.courseCompletion.findUnique({
          where: { userId_courseId: { userId, courseId } },
          select: { courseCompletedAt: true },
        }),
        this.courseVersionService.resolveCurriculumTree(userId, courseId),
        this.getCourseFormsWithMetadataForUser(userId, courseId),
        this.prisma.userChapterCompletion.findMany({
          where: { userId, courseId },
          select: { chapterId: true, completedAt: true },
        }),
        this.prisma.userModuleCompletion.findMany({
          where: { userId, courseId },
          select: { moduleId: true, completedAt: true },
        }),
        this.courseVersionService.summarizeNewSincePinnedVersion(
          userId,
          courseId,
        ),
        this.prisma.userCourseProgress.findFirst({
          where: { userId, courseId },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
      ]);

      const isFrozen = !!completion?.courseCompletedAt;
      const courseStartDate = firstProgress?.createdAt ?? null;
      const chapterCompletedAtById = new Map(
        chapterCompletions.map((row) => [row.chapterId, row.completedAt]),
      );
      const moduleCompletedAtById = new Map(
        moduleCompletions.map((row) => [row.moduleId, row.completedAt]),
      );

      const reportMeta = {
        message: 'Successfully retrieved datas',
        statusCode: 200,
        user: userDetails,
        courseForms,
        isCompleted: isFrozen,
        completedAt: completion?.courseCompletedAt ?? null,
        courseStartDate,
        ...(newSinceCompletion ? { newSinceCompletion } : {}),
      };

      if (curriculum.mode === 'versioned') {
        const { version } = curriculum;
        const liveChapterIds = version.modules.flatMap((m) =>
          m.chapters
            .map((c) => c.sourceChapterId)
            .filter((id): id is string => Boolean(id)),
        );

        const activity = await this.fetchReportActivityData(
          userId,
          courseId,
          liveChapterIds,
        );

        const totalSectionsInCourse = version.modules.reduce((sum, mod) => {
          return (
            sum +
            mod.chapters.reduce((chSum, chapter) => {
              return (
                chSum +
                chapter.sections.filter(
                  (s) => s.isActive && s.sourceSectionId,
                ).length
              );
            }, 0)
          );
        }, 0);

        const modules = version.modules.map((mod) => {
          const moduleId = mod.sourceModuleId ?? mod.id;
          const chapters = mod.chapters.map((chapter) => {
            const sourceChapterId = chapter.sourceChapterId ?? chapter.id;
            const sectionMetas: SectionReportMeta[] = chapter.sections
              .filter((s) => s.isActive && s.sourceSectionId)
              .sort(
                (a, b) =>
                  (a.orderIndex ?? Number.MAX_SAFE_INTEGER) -
                  (b.orderIndex ?? Number.MAX_SAFE_INTEGER),
              )
              .map((s) => ({
                id: s.sourceSectionId as string,
                title: s.title,
                orderIndex: s.orderIndex,
                type: s.type,
              }));

            return buildChapterReportRow({
              id: sourceChapterId,
              title: chapter.title,
              sectionMetas,
              quizzesTotal: chapter.quizzes.length,
              activity,
              chapterCompletedAt:
                chapterCompletedAtById.get(sourceChapterId) ?? null,
              isFrozen,
            });
          });

          return applyModuleRollup(
            {
              id: moduleId,
              title: mod.title,
              completedAt: moduleCompletedAtById.get(moduleId) ?? null,
              chapters,
            },
            totalSectionsInCourse,
            isFrozen,
          );
        });

        return {
          ...reportMeta,
          data: modules,
          enrolledVersionNumber: version.versionNumber,
        };
      }

      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
        select: {
          id: true,
          title: true,
          users: {
            where: { id: userId },
          },
          modules: {
            select: {
              id: true,
              title: true,
              chapters: {
                select: {
                  id: true,
                  title: true,
                  sections: {
                    where: { isArchived: false, isActive: true },
                    select: {
                      id: true,
                      title: true,
                      orderIndex: true,
                      type: true,
                    },
                    orderBy: { orderIndex: 'asc' },
                  },
                  _count: {
                    select: {
                      quizzes: true,
                    },
                  },
                },
                orderBy: { createdAt: 'asc' },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      const liveChapterIds = course.modules.flatMap((m) =>
        m.chapters.map((c) => c.id),
      );
      const activity = await this.fetchReportActivityData(
        userId,
        courseId,
        liveChapterIds,
      );

      const totalSectionsInCourse = course.modules.reduce(
        (sum, mod) =>
          sum +
          mod.chapters.reduce((chSum, ch) => chSum + ch.sections.length, 0),
        0,
      );

      const modules = course.modules.map((mod) => {
        const chapters = mod.chapters.map((chapter) => {
          const sectionMetas: SectionReportMeta[] = chapter.sections.map(
            (s) => ({
              id: s.id,
              title: s.title,
              orderIndex: s.orderIndex,
              type: s.type,
            }),
          );

          return buildChapterReportRow({
            id: chapter.id,
            title: chapter.title,
            sectionMetas,
            quizzesTotal: chapter._count.quizzes,
            activity,
            chapterCompletedAt:
              chapterCompletedAtById.get(chapter.id) ?? null,
            isFrozen,
          });
        });

        return applyModuleRollup(
          {
            id: mod.id,
            title: mod.title,
            completedAt: moduleCompletedAtById.get(mod.id) ?? null,
            chapters,
          },
          totalSectionsInCourse,
          isFrozen,
        );
      });

      return {
        ...reportMeta,
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

  async getCourseDates(courseId: any, userId: any): Promise<any> {
    try {
      const allProgressItem = await this.prisma.userCourseProgress.findMany({
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
      // Check if course exists
      const isCourseExist: Course = await this.prisma.course.findUnique({
        where: { title: body.title },
      });

      if (isCourseExist) {
        throw new Error('Course already exist with specified title');
      }

      // Create transaction for atomic operations
      const result = await this.prisma.$transaction(async (prisma) => {
        // 1. Create the course
        const course: Course = await prisma.course.create({
          data: {
            title: body.title,
            description: body.description,
            assessment: body.assessment,
            duration: body.duration,
            overview: body.overview,
            image: body.image,
            syllabusOverview: body.syllabusOverview,
            resourcesOverview: body.resourcesOverview,
            tutorInfo: body.tutorInfo,
            assessments: body.assessments,
            resources: body.resources,
            syllabus: body.syllabus,
            price: body.price,
            // Omit when not provided so the schema default (365) applies.
            ...(body.validityDays != null
              ? { validityDays: body.validityDays }
              : {}),
          },
        });

        // 2. Add required forms if specified
        if (body.courseForms && body.courseForms.length > 0) {
          await prisma.courseForm.createMany({
            data: body.courseForms.map((form) => ({
              courseId: course.id,
              formId: form.value,
              formName: form.label,
              isRequired: form.isRequired ?? true, // Use specified value or default to true
            })),
          });
        }

        // 3. Add feedback form if specified
        if (body.feedbackForm) {
          await prisma.courseFeedbackForm.create({
            data: {
              courseId: course.id,
              formName:
                body.feedbackForm.formName || 'Course Completion Feedback',
              formStructure: body.feedbackForm.formStructure || {},
              isRequired: body.feedbackForm.isRequired,
            },
          });
        }

        return course;
      });

      return {
        message: 'Successfully created course record with forms',
        statusCode: 200,
        data: result,
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
  async createModule(
    body: ModuleDto,
    adminId?: string,
  ): Promise<ResponseDto> {
    try {
      const module: Module = await this.prisma.module.create({
        data: {
          title: body.title,
          description: body.description,

          courseId: body.id,
        },
      });
      const publishedVersion = await this.autoPublishAfterStructureChange(
        body.id,
        adminId,
        `Added module "${body.title}"`,
      );
      return {
        message: publishedVersion
          ? `Successfully created module (published v${publishedVersion.versionNumber})`
          : 'Successfully create module record',
        statusCode: 200,
        data: module,
        publishedVersion: publishedVersion ?? undefined,
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
  async createChapter(
    body: ModuleDto,
    adminId?: string,
  ): Promise<ResponseDto> {
    try {
      const courseId = await this.resolveCourseIdFromModuleId(body.id);
      const chapter: Chapter = await this.prisma.chapter.create({
        data: {
          title: body.title,
          description: body.description,
          pdfFile: body.pdfFile,
          moduleId: body.id,
        },
      });
      const publishedVersion = await this.autoPublishAfterStructureChange(
        courseId,
        adminId,
        `Added chapter "${body.title}"`,
      );
      return {
        message: publishedVersion
          ? `Successfully created chapter (published v${publishedVersion.versionNumber})`
          : 'Successfully create chapter record',
        statusCode: 200,
        data: chapter,
        publishedVersion: publishedVersion ?? undefined,
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
  async createSection(
    body:
      | CreateSectionDto
      | CreateMatchAndLearnSectionDto
      | CreateVisualActivitySectionDto
      | CreateOrderingSectionDto
      | CreateMatchingSectionDto,
    adminId?: string,
  ): Promise<ResponseDto> {
    try {
      const data: any = {
        title: body.title,
        description: body.description,
        shortDescription: body.shortDescription ?? '',
        type: body.type || SectionType.DEFAULT,
        chapterId: body.chapterId || (body as any).id, // Support old format with body.id
        moduleId: body.moduleId,
        orderIndex: body.orderIndex || null, // Order within chapter (null by default)
      };

      // Handle Match and Learn specific fields
      if (body.type === SectionType.MATCH_AND_LEARN) {
        const matchData = body as CreateMatchAndLearnSectionDto;

        // Extract unique categories from items if not provided
        const categories = matchData.categories || [
          ...new Set(matchData.items.map((item) => item.correctCategory)),
        ];

        data.itemLabel = matchData.itemLabel;
        data.categoryLabel = matchData.categoryLabel;
        data.categories = categories;
        data.maxPerCategory = matchData.maxPerCategory || 1;
        data.isActive = matchData.isActive ?? true;
        data.items = matchData.items; // Stored as JSON
      }

      // Handle Visual Activity specific fields
      if (body.type === SectionType.VISUAL_ACTIVITY) {
        const visualData = body as CreateVisualActivitySectionDto;

        // Validate that at least one option is correct
        const hasCorrectOption = visualData.options.some(
          (option) => option.isCorrect === true,
        );
        if (!hasCorrectOption) {
          throw new Error(
            'At least one option must be marked as correct for Visual Activity sections',
          );
        }

        data.questionText = visualData.questionText;
        data.imageUrl = visualData.imageUrl || null;
        data.allowMultipleSelection =
          visualData.allowMultipleSelection ?? false;
        data.options = visualData.options; // Stored as JSON
      }

      if (body.type === SectionType.ORDERING) {
        const ord = body as CreateOrderingSectionDto;
        this.assertValidOrderingItems(ord.items, ord.correctOrder);
        data.type = SectionType.ORDERING as any;
        data.questionText = ord.questionText ?? null;
        data.items = ord.items as unknown as Prisma.InputJsonValue;
        data.config = {
          correctOrder: ord.correctOrder,
        } as unknown as Prisma.InputJsonValue;
      }

      if (body.type === SectionType.MATCHING) {
        const mat = body as CreateMatchingSectionDto;
        const ids = new Set(mat.pairs.map((p) => p.id));
        if (ids.size !== mat.pairs.length) {
          throw new Error('Matching pairs must have unique ids');
        }
        data.type = SectionType.MATCHING as any;
        data.questionText = mat.questionText ?? null;
        data.config = { pairs: mat.pairs } as unknown as Prisma.InputJsonValue;
      }

      const section: Section = await this.prisma.section.create({
        data,
      });

      const chapterId = section.chapterId;
      const courseId = await this.resolveCourseIdFromChapterId(chapterId);
      const publishedVersion = await this.autoPublishAfterStructureChange(
        courseId,
        adminId,
        `Added section "${section.title}"`,
      );

      return {
        message: publishedVersion
          ? `Successfully created section (published v${publishedVersion.versionNumber})`
          : 'Successfully create section record',
        statusCode: 200,
        data: section,
        publishedVersion: publishedVersion ?? undefined,
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
      const course = await this.prisma.course.findUnique({
        where: { id },
        include: {
          courseForms: true, // Include the associated course forms
          Policy: {
            include: {
              items: true, // Include all policy items
            },
          },
          feedbackForm: true, // Include the feedback form
        },
      });

      if (!course) {
        throw new Error('Course not found');
      }

      return {
        message: 'Successfully fetched course info',
        statusCode: 200,
        data: {
          ...course,
          // Maintain backward compatibility by mapping Policy to CoursePolicy
          CoursePolicy:
            course.Policy?.flatMap((policy) => ({
              id: policy.id,
              courseId: policy.courseId,
              title: policy.title,
              description: policy.description,
              link: policy.items?.[0]?.link, // Use first item's link for backward compatibility
              isRequired: true, // Default to true for backward compatibility
              order: policy.order,
              createdAt: policy.createdAt,
              updatedAt: policy.updatedAt,
            })) || [],
          // Include feedback form information
          feedbackForm: course.feedbackForm
            ? {
                id: course.feedbackForm.id,
                formName: course.feedbackForm.formName,
                formStructure: course.feedbackForm.formStructure,
                isRequired: course.feedbackForm.isRequired,
                isActive: course.feedbackForm.isActive,
              }
            : null,
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

  async canAccessCourseContent(
    userId: string,
    courseId: string,
  ): Promise<ResponseDto> {
    try {
      // First get the course with basic info and user assignment
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
        include: {
          users: {
            where: { userId },
            select: { id: true },
          },
        },
      });

      if (!course) {
        throw new Error('Course not found');
      }

      // Check if user is assigned to this course
      if (course.users.length === 0) {
        return {
          message: 'User is not assigned to this course',
          statusCode: 403,
          data: { canAccessContent: false },
        };
      }

      // Post-completion access window: once the course is completed, access
      // lasts course.validityDays days (default 365). After that the learner is
      // locked out until an admin renews access. Computed live; no row mutated.
      const completion = await this.prisma.courseCompletion.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: { courseCompletedAt: true },
      });
      if (completion?.courseCompletedAt) {
        const expiresAt = new Date(completion.courseCompletedAt);
        expiresAt.setDate(expiresAt.getDate() + (course.validityDays ?? 365));
        if (new Date() > expiresAt) {
          return {
            message: `Your access to this course expired on ${
              expiresAt.toISOString().split('T')[0]
            }. Please contact your administrator to renew access.`,
            statusCode: 403,
            data: { canAccessContent: false, expired: true, expiresAt },
          };
        }
      }

      // Now get all required data in parallel
      const [forms, policies, policyCompletions, policyItemCompletions] =
        await Promise.all([
          // Get required forms and their completions
          this.prisma.courseForm.findMany({
            where: {
              courseId,
              isRequired: true,
            },
            include: {
              userFormCompletions: {
                where: { userId },
                select: { isComplete: true },
              },
            },
          }),

          // Get all policies with their required items
          this.prisma.policy.findMany({
            where: { courseId },
            include: {
              items: {
                where: { isRequired: true },
                select: { id: true },
              },
            },
          }),

          // Get policy completions
          this.prisma.userPolicyCompletion.findMany({
            where: {
              userId,
              courseId,
              isComplete: true,
            },
            select: { policyId: true },
          }),

          // Get policy item completions
          this.prisma.userPolicyItemCompletion.findMany({
            where: {
              userId,
              isComplete: true,
              item: {
                policy: {
                  courseId,
                },
                isRequired: true,
              },
            },
            select: { itemId: true },
          }),
        ]);

      // Calculate form completion status
      const totalRequiredForms = forms.length;
      let completedForms = 0;
      const formStatus = forms.map((form) => {
        const isComplete = form.userFormCompletions[0]?.isComplete || false;
        if (isComplete) completedForms++;
        return {
          formId: form.formId,
          formName: form.formName,
          isRequired: form.isRequired,
          isComplete,
        };
      });

      // Calculate policy completion status
      const totalRequiredPolicies = policies.length;
      const completedPolicies = policyCompletions.length;

      // Calculate policy item completion status
      const totalRequiredPolicyItems = policies.reduce(
        (sum, policy) => sum + (policy.items?.length || 0),
        0,
      );
      const completedPolicyItems = policyItemCompletions.length;

      // Get detailed policy info for response
      const detailedPolicies = await this.prisma.policy.findMany({
        where: { courseId },
        include: {
          items: {
            include: {
              completions: {
                where: { userId },
                select: { isComplete: true },
              },
            },
          },
          completions: {
            where: { userId },
            select: { isComplete: true },
          },
        },
      });

      const policyStatus = detailedPolicies.map((policy) => ({
        policyId: policy.id,
        title: policy.title,
        description: policy.description,
        isComplete: policy.completions[0]?.isComplete || false,
        items: policy.items.map((item) => ({
          itemId: item.id,
          title: item.title,
          description: item.description,
          link: item.link,
          isRequired: item.isRequired,
          isComplete: item.completions[0]?.isComplete || false,
        })),
      }));

      // Determine access
      const canAccessContent =
        completedForms === totalRequiredForms &&
        completedPolicyItems === totalRequiredPolicyItems;

      return {
        message: 'Course access status retrieved',
        statusCode: 200,
        data: {
          canAccessContent,
          formStatus: {
            completedForms,
            totalForms: totalRequiredForms,
            forms: formStatus,
          },
          policyStatus: {
            completedPolicies,
            totalPolicies: totalRequiredPolicies,
            completedPolicyItems,
            totalPolicyItems: totalRequiredPolicyItems,
            policies: policyStatus,
          },
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error?.message || 'Failed to check course access',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
        {
          cause: error,
        },
      );
    }
  }
  async getCourseDetailPublic(id: string): Promise<ResponseDto> {
    try {
      const course = await this.prisma.course.findFirst({
        where: { id, isActive: true },
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
              chapters: {
                orderBy: {
                  createdAt: 'asc',
                },
              },
              _count: true,
            },
            orderBy: {
              createdAt: 'asc',
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
      });

      if (!(courses.length > 0)) {
        throw new Error('No Courses found');
      }

      const data = courses.map((course) => ({
        ...course,
        status: course.isActive ? 'active' : 'inactive',
      }));

      return {
        message: 'Successfully fetched all Courses with form information',
        statusCode: 200,
        data,
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
        where: { isActive: true },
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

  async setCourseActive(
    courseId: string,
    isActive: boolean,
  ): Promise<ResponseDto> {
    try {
      const existing = await this.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!existing) {
        throw new Error('Course not found');
      }
      const course = await this.prisma.course.update({
        where: { id: courseId },
        data: { isActive },
      });
      return {
        message: isActive
          ? 'Course activated successfully'
          : 'Course deactivated successfully',
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
      const [completion, curriculum, quizProgressRows] = await Promise.all([
        this.prisma.courseCompletion.findUnique({
          where: { userId_courseId: { userId, courseId: id } },
          select: { courseCompletedAt: true },
        }),
        this.courseVersionService.resolveCurriculumTree(userId, id),
        this.prisma.quizProgress.findMany({ where: { userId } }),
      ]);

      const isFrozen = !!completion?.courseCompletedAt;
      const newSinceCompletion =
        await this.courseVersionService.summarizeNewSincePinnedVersion(
          userId,
          id,
        );

      if (curriculum.mode === 'versioned') {
        const progressRows = await this.prisma.userCourseProgress.findMany({
          where: { userId, courseId: id },
          select: { sectionId: true, chapterId: true, moduleId: true },
        });
        const progressByChapter = new Map<string, number>();
        const progressByModule = new Map<string, number>();
        const progressSectionIds = new Set(progressRows.map((p) => p.sectionId));

        for (const mod of curriculum.version.modules) {
          const sourceModuleId = mod.sourceModuleId ?? mod.id;
          let modCount = 0;
          for (const ch of mod.chapters) {
            const sourceChapterId = ch.sourceChapterId ?? ch.id;
            const sectionIds = ch.sections
              .filter((s) => s.isActive && s.sourceSectionId)
              .map((s) => s.sourceSectionId as string);
            const chCount = sectionIds.filter((sid) =>
              progressSectionIds.has(sid),
            ).length;
            progressByChapter.set(sourceChapterId, chCount);
            modCount += chCount;
          }
          progressByModule.set(sourceModuleId, modCount);
        }

        let modules = this.courseVersionService.buildUserModulesFromVersion(
          curriculum.version,
          userId,
          progressByChapter,
          progressByModule,
        );

        const quizByChapter = new Map(
          quizProgressRows.map((q) => [q.chapterId, q]),
        );
        modules = modules.map((mod) => ({
          ...mod,
          chapters: mod.chapters.map((ch) => ({
            ...ch,
            QuizProgress: quizByChapter.has(ch.id)
              ? [quizByChapter.get(ch.id)]
              : [],
          })),
        }));

        if (isFrozen) {
          for (const mod of modules) {
            if (mod._count?.sections != null) {
              mod._count.UserCourseProgress = mod._count.sections;
            }
            for (const chapter of mod.chapters ?? []) {
              if (chapter._count?.sections != null) {
                chapter._count.UserCourseProgress = chapter._count.sections;
              }
            }
          }
        }

        return {
          message: 'Successfully fetched all Modules info against course',
          statusCode: 200,
          data: modules,
          isCompleted: isFrozen,
          completedAt: completion?.courseCompletedAt ?? null,
          enrolledVersionNumber: curriculum.versionNumber,
          ...(newSinceCompletion ? { newSinceCompletion } : {}),
        };
      }

      const [courses]: any = await Promise.all([
        this.prisma.course.findFirst({
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
                          where: { userId },
                        },
                        sections: true,
                        quizzes: true,
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
                _count: {
                  select: {
                    UserCourseProgress: {
                      where: { userId },
                    },
                    sections: true,
                  },
                },
              },
            },
          },
        }),
      ]);

      // Certified completers keep 100% at every aggregate level even when
      // admin adds sections later. Clamp _count.UserCourseProgress so the FE
      // ratio (progressed / total sections) stays at 100%.
      if (isFrozen && courses?.modules) {
        for (const mod of courses.modules) {
          if (mod._count?.sections != null) {
            mod._count.UserCourseProgress = mod._count.sections;
          }
          for (const chapter of mod.chapters ?? []) {
            if (chapter._count?.sections != null) {
              chapter._count.UserCourseProgress = chapter._count.sections;
            }
          }
        }
      }

      return {
        message: 'Successfully fetched all Modules info against course',
        statusCode: 200,
        data: courses?.modules,
        isCompleted: isFrozen,
        completedAt: completion?.courseCompletedAt ?? null,
        ...(newSinceCompletion ? { newSinceCompletion } : {}),
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
        // Return all fields including new type-specific fields
      });

      // Sort sections: non-null orderIndex first (ascending), then nulls at the end
      sections.sort((a, b) => {
        const aOrder = (a as any).orderIndex;
        const bOrder = (b as any).orderIndex;
        if (aOrder === null && bOrder === null) return 0;
        if (aOrder === null) return 1; // nulls go to end
        if (bOrder === null) return -1; // nulls go to end
        return aOrder - bOrder;
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
      const [userCourseProgress, lastSeenLesson, completion, curriculum] =
        await Promise.all([
          this.prisma.userCourseProgress.findMany({
            where: { userId, courseId, chapterId: id },
          }),
          this.prisma.lastSeenSection.findUnique({
            where: { userId_chapterId: { userId, chapterId: id } },
          }),
          this.prisma.courseCompletion.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { courseCompletedAt: true },
          }),
          this.courseVersionService.resolveCurriculumTree(userId, courseId),
        ]);

      const newSinceCompletion =
        await this.courseVersionService.summarizeNewSincePinnedVersion(
          userId,
          courseId,
        );

      if (curriculum.mode === 'versioned') {
        const found = this.courseVersionService.findVersionChapterBySourceId(
          curriculum.version,
          id,
        );
        if (!found) {
          throw new Error('Chapter not found in enrolled course version');
        }

        const { chapter: versionChapter } = found;
        const allSections = this.courseVersionService.mapVersionSectionsForLearner(
          versionChapter.sections.filter((s) => s.isActive),
        );
        const completedSections = userCourseProgress ?? [];

        allSections.forEach((section: any) => {
          const isCompleted = completedSections.some(
            (completedSection: any) =>
              completedSection.sectionId === section.id,
          );
          section.isLastSeen = lastSeenLesson?.sectionId === section.id;
          section.isCompleted = isCompleted;

          if (
            section.type === SectionType.ORDERING ||
            section.type === SectionType.MATCHING
          ) {
            this.sanitizeLessonSectionForStudent(section);
          }
        });

        if (allSections.length === 0) {
          throw new Error('No Sections found');
        }

        const quizzes = this.courseVersionService.mapVersionQuizzesForLearner(
          versionChapter.quizzes,
          false,
        );

        return {
          message: 'Successfully fetch all Sections info against chapter',
          statusCode: 200,
          data: allSections,
          chapter: {
            id,
            title: versionChapter.title,
            description: versionChapter.description,
            pdfFile: versionChapter.pdfFile,
            moduleId: found.module.sourceModuleId,
            quizzes,
          },
          isCompleted: !!completion?.courseCompletedAt,
          completedAt: completion?.courseCompletedAt ?? null,
          enrolledVersionNumber: curriculum.versionNumber,
          ...(newSinceCompletion ? { newSinceCompletion } : {}),
        };
      }

      const [sections, chapter] = await Promise.all([
        this.prisma.section.findMany({
          where: { chapterId: id, isArchived: false },
          orderBy: {
            createdAt: 'asc',
          },
        }),
        this.prisma.chapter.findUnique({
          where: { id },
          include: {
            quizzes: {
              where: { isArchived: false },
              select: {
                id: true,
                question: true,
                options: true,
                answer: true,
              },
            },
          },
        }),
      ]);

      // Sort sections: non-null orderIndex first (ascending), then nulls at the end
      const sortedSections = [...sections].sort((a, b) => {
        const aOrder = (a as any).orderIndex;
        const bOrder = (b as any).orderIndex;
        if (aOrder === null && bOrder === null) return 0;
        if (aOrder === null) return 1; // nulls go to end
        if (bOrder === null) return -1; // nulls go to end
        return aOrder - bOrder;
      });

      const allSections = sortedSections?.length > 0 ? [...sortedSections] : [];
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

        if (
          section.type === SectionType.ORDERING ||
          section.type === SectionType.MATCHING
        ) {
          this.sanitizeLessonSectionForStudent(section);
        }
      });

      if (!(sections.length > 0)) {
        throw new Error('No Sections found');
      }
      return {
        message: 'Successfully fetch all Sections info against chapter',
        statusCode: 200,
        data: allSections,
        chapter: chapter,
        isCompleted: !!completion?.courseCompletedAt,
        completedAt: completion?.courseCompletedAt ?? null,
        ...(newSinceCompletion ? { newSinceCompletion } : {}),
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
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
      const course = await this.prisma.course.findUnique({ where: { id } });

      if (!course) {
        throw new Error('Course does not exist');
      }

      if (Object.entries(body).length === 0) {
        throw new Error('No update data provided');
      }

      const { courseForms, policies, feedbackForm, ...courseData } = body;

      // 1. Update basic course information
      const updatedCourse = await this.prisma.course.update({
        where: { id },
        data: courseData,
      });

      // 2. Update course forms if provided
      if (courseForms) {
        await this.prisma.courseForm.deleteMany({ where: { courseId: id } });

        if (courseForms.length > 0) {
          await this.prisma.courseForm.createMany({
            data: courseForms.map((form) => ({
              courseId: id,
              formId: form.value,
              formName: form.label,
              isRequired: form.isRequired ?? true,
            })),
          });
        }
      }

      // 3. Update feedback form if provided
      if (feedbackForm) {
        // First delete existing feedback submissions
        await this.prisma.courseFeedbackSubmission.deleteMany({
          where: {
            courseId: id,
          },
        });

        // Then delete existing feedback form for this course
        await this.prisma.courseFeedbackForm.deleteMany({
          where: {
            courseId: id,
          },
        });

        // Create new feedback form
        await this.prisma.courseFeedbackForm.create({
          data: {
            courseId: id,
            formName: feedbackForm.formName || 'Course Completion Feedback',
            formStructure: feedbackForm.formStructure || {},
            isRequired: feedbackForm.isRequired,
          },
        });
      }

      // 4. Update policies and related data if provided
      if (policies) {
        // Step 3.1: Clean up existing related records
        await this.prisma.userPolicyItemCompletion.deleteMany({
          where: { item: { policy: { courseId: id } } },
        });

        await this.prisma.userPolicyCompletion.deleteMany({
          where: { policy: { courseId: id } },
        });

        await this.prisma.policyItem.deleteMany({
          where: { policy: { courseId: id } },
        });

        await this.prisma.policy.deleteMany({
          where: { courseId: id },
        });

        // Step 3.2: Recreate policies and their items
        for (const policy of policies) {
          await this.prisma.policy.create({
            data: {
              courseId: id,
              title: policy.title,
              description: policy.description,
              order: policy.order ?? 0,
              items: {
                create: policy.items?.map((item, index) => ({
                  title: item.title,
                  description: item.description ?? '',
                  link: item.link,
                  isRequired: item.isRequired ?? true,
                  order: item.order ?? index,
                })),
              },
            },
          });
        }
      }

      return {
        message: 'Successfully updated course record with forms and policies',
        statusCode: 200,
        data: updatedCourse,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error:
            error?.message || 'Something went wrong while updating the course',
        },
        HttpStatus.FORBIDDEN,
        { cause: error },
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

      await this.courseVersionService.syncModuleToLatestVersion(id);

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

      await this.courseVersionService.syncChapterToLatestVersion(id);

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
  async updateSection(
    id: string,
    body:
      | UpdateSectionDto
      | UpdateMatchAndLearnSectionDto
      | UpdateVisualActivitySectionDto
      | UpdateOrderingSectionDto
      | UpdateMatchingSectionDto
      | any,
  ): Promise<ResponseDto> {
    try {
      const isSectionExist: Section = await this.prisma.section.findUnique({
        where: { id: id },
      });
      if (!isSectionExist) {
        throw new Error('Section does not exist');
      }
      if (Object.entries(body).length === 0) {
        throw new Error('wrong keys');
      }

      const updateData: any = {};

      // Handle common section fields
      if (body.title !== undefined) updateData.title = body.title;
      if (body.description !== undefined)
        updateData.description = body.description;
      if (body.shortDescription !== undefined)
        updateData.shortDescription = body.shortDescription;
      if (body.chapterId !== undefined) updateData.chapterId = body.chapterId;
      if (body.moduleId !== undefined) updateData.moduleId = body.moduleId;
      if ((body as any).orderIndex !== undefined)
        updateData.orderIndex = (body as any).orderIndex;
      if (body.type !== undefined) updateData.type = body.type as any;

      // Handle Match and Learn specific fields if section type is MATCH_AND_LEARN
      const sectionType = (isSectionExist as any).type;
      if (
        sectionType === SectionType.MATCH_AND_LEARN ||
        body.type === SectionType.MATCH_AND_LEARN
      ) {
        const matchData = body as UpdateMatchAndLearnSectionDto;

        if (matchData.itemLabel !== undefined)
          updateData.itemLabel = matchData.itemLabel;
        if (matchData.categoryLabel !== undefined)
          updateData.categoryLabel = matchData.categoryLabel;
        if (matchData.maxPerCategory !== undefined)
          updateData.maxPerCategory = matchData.maxPerCategory;
        if (matchData.isActive !== undefined)
          updateData.isActive = matchData.isActive;

        // Handle items update
        if (matchData.items !== undefined) {
          updateData.items = matchData.items;
          // Recalculate categories from items if not explicitly provided
          if (matchData.categories === undefined) {
            updateData.categories = [
              ...new Set(
                matchData.items.map((item: any) => item.correctCategory),
              ),
            ];
          } else {
            updateData.categories = matchData.categories;
          }
        } else if (matchData.categories !== undefined) {
          updateData.categories = matchData.categories;
        }
      }

      // Handle Visual Activity specific fields if section type is VISUAL_ACTIVITY
      if (
        sectionType === SectionType.VISUAL_ACTIVITY ||
        body.type === SectionType.VISUAL_ACTIVITY
      ) {
        const visualData = body as UpdateVisualActivitySectionDto;

        if (visualData.questionText !== undefined)
          updateData.questionText = visualData.questionText;
        if (visualData.imageUrl !== undefined)
          updateData.imageUrl = visualData.imageUrl;
        if (visualData.allowMultipleSelection !== undefined)
          updateData.allowMultipleSelection = visualData.allowMultipleSelection;

        // Handle options update
        if (visualData.options !== undefined) {
          // Validate that at least one option is correct
          const hasCorrectOption = visualData.options.some(
            (option: any) => option.isCorrect === true,
          );
          if (!hasCorrectOption) {
            throw new Error(
              'At least one option must be marked as correct for Visual Activity sections',
            );
          }
          updateData.options = visualData.options;
        }
      }

      if (
        sectionType === SectionType.ORDERING ||
        body.type === SectionType.ORDERING
      ) {
        const ord = body as UpdateOrderingSectionDto;
        if (ord.questionText !== undefined)
          updateData.questionText = ord.questionText;
        if (ord.items !== undefined)
          updateData.items = ord.items as unknown as Prisma.InputJsonValue;
        if (ord.items !== undefined || ord.correctOrder !== undefined) {
          const items =
            ord.items ??
            (Array.isArray(isSectionExist.items)
              ? (isSectionExist.items as { id: string }[])
              : null);
          const existingCfg = isSectionExist.config as {
            correctOrder?: string[];
          } | null;
          const correctOrder =
            ord.correctOrder ?? existingCfg?.correctOrder ?? null;
          if (!items?.length || !correctOrder?.length) {
            throw new Error(
              'ORDERING section update requires existing items and correctOrder, or provide both in the request',
            );
          }
          this.assertValidOrderingItems(items, correctOrder);
          updateData.config = {
            correctOrder,
          } as unknown as Prisma.InputJsonValue;
        }
      }

      if (
        sectionType === SectionType.MATCHING ||
        body.type === SectionType.MATCHING
      ) {
        const mat = body as UpdateMatchingSectionDto;
        if (mat.questionText !== undefined)
          updateData.questionText = mat.questionText;
        if (mat.pairs !== undefined) {
          const ids = new Set(mat.pairs.map((p) => p.id));
          if (ids.size !== mat.pairs.length) {
            throw new Error('Matching pairs must have unique ids');
          }
          updateData.config = {
            pairs: mat.pairs,
          } as unknown as Prisma.InputJsonValue;
        }
      }

      // If updateData is empty, use the original approach for backward compatibility
      if (Object.keys(updateData).length === 0) {
        for (const [key, value] of Object.entries(body)) {
          updateData[key] = value;
        }
      }

      const updatedSection = await this.prisma.section.update({
        where: { id },
        data: updateData,
      });

      await this.courseVersionService.syncSectionToLatestVersion(id);

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

  async updateSectionOrder(body: UpdateSectionOrderDto): Promise<ResponseDto> {
    try {
      // Verify all sections belong to the provided chapterId
      const sectionIds = body.sections.map((s) => s.id);
      const sections = await this.prisma.section.findMany({
        where: {
          id: { in: sectionIds },
          chapterId: body.chapterId,
        },
      });

      if (sections.length !== sectionIds.length) {
        throw new Error(
          'Some sections not found or do not belong to the specified chapter',
        );
      }

      // Update each section's orderIndex in a transaction
      const updatePromises = body.sections.map((sectionOrder) =>
        this.prisma.section.update({
          where: { id: sectionOrder.id },
          data: { orderIndex: sectionOrder.orderIndex } as any,
        }),
      );

      await this.prisma.$transaction(updatePromises);

      await this.courseVersionService.syncChapterSectionOrderToLatestVersion(
        body.chapterId,
      );

      return {
        message: 'Successfully updated section order',
        statusCode: 200,
        data: { chapterId: body.chapterId, updatedCount: body.sections.length },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: error?.message || 'Failed to update section order',
        },
        HttpStatus.BAD_REQUEST,
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

  async deleteModule(id: string, adminId?: string): Promise<ResponseDto> {
    try {
      const mod = await this.prisma.module.findUnique({
        where: { id },
      });
      if (!mod) {
        throw new Error('Module not found');
      }

      const referenced =
        await this.courseVersionService.isReferencedByAnyVersion('module', id);
      if (referenced) {
        const archived = await this.prisma.module.update({
          where: { id },
          data: { isArchived: true },
        });
        const publishedVersion = await this.autoPublishAfterStructureChange(
          mod.courseId,
          adminId,
          `Archived module "${mod.title}"`,
        );
        return {
          message:
            'Module is part of a published course version and was archived instead of deleted',
          statusCode: 200,
          data: archived,
          publishedVersion: publishedVersion ?? undefined,
        };
      }

      await this.prisma.module.delete({
        where: { id },
      });

      const publishedVersion = await this.autoPublishAfterStructureChange(
        mod.courseId,
        adminId,
        `Removed module "${mod.title}"`,
      );

      return {
        message: publishedVersion
          ? `Successfully deleted module (published v${publishedVersion.versionNumber})`
          : 'Successfully deleted module record',
        statusCode: 200,
        data: mod,
        publishedVersion: publishedVersion ?? undefined,
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

  async deleteChapter(id: string, adminId?: string): Promise<ResponseDto> {
    try {
      const chapter = await this.prisma.chapter.findUnique({
        where: { id },
      });
      if (!chapter) {
        throw new Error('Chapter not found');
      }

      const courseId = await this.resolveCourseIdFromModuleId(chapter.moduleId);

      const referenced =
        await this.courseVersionService.isReferencedByAnyVersion('chapter', id);
      if (referenced) {
        const archived = await this.prisma.chapter.update({
          where: { id },
          data: { isArchived: true },
        });
        const publishedVersion = await this.autoPublishAfterStructureChange(
          courseId,
          adminId,
          `Archived chapter "${chapter.title}"`,
        );
        return {
          message:
            'Chapter is part of a published course version and was archived instead of deleted',
          statusCode: 200,
          data: archived,
          publishedVersion: publishedVersion ?? undefined,
        };
      }

      await this.prisma.chapter.delete({
        where: { id },
      });

      const publishedVersion = await this.autoPublishAfterStructureChange(
        courseId,
        adminId,
        `Removed chapter "${chapter.title}"`,
      );

      return {
        message: publishedVersion
          ? `Successfully deleted chapter (published v${publishedVersion.versionNumber})`
          : 'Successfully deleted chapter record',
        statusCode: 200,
        data: chapter,
        publishedVersion: publishedVersion ?? undefined,
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

  async deleteSection(id: string, adminId?: string): Promise<ResponseDto> {
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

      const courseId = await this.resolveCourseIdFromChapterId(section.chapterId);

      const referenced =
        await this.courseVersionService.isReferencedByAnyVersion('section', id);
      if (referenced) {
        const archived = await this.prisma.section.update({
          where: { id },
          data: { isArchived: true },
        });
        const publishedVersion = await this.autoPublishAfterStructureChange(
          courseId,
          adminId,
          `Archived section "${section.title}"`,
        );
        return {
          message:
            'Section is part of a published course version and was archived instead of deleted',
          statusCode: 200,
          data: archived,
          publishedVersion: publishedVersion ?? undefined,
        };
      }

      await this.prisma.section.delete({
        where: { id },
      });

      const publishedVersion = await this.autoPublishAfterStructureChange(
        courseId,
        adminId,
        `Removed section "${section.title}"`,
      );

      return {
        message: publishedVersion
          ? `Successfully deleted section (published v${publishedVersion.versionNumber})`
          : 'Successfully deleted section record',
        statusCode: 200,
        data: section,
        publishedVersion: publishedVersion ?? undefined,
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
        throw new HttpException(
          { status: HttpStatus.NOT_FOUND, error: 'Course not found.' },
          HttpStatus.NOT_FOUND,
        );
      }

      // Check if the user exists
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        throw new HttpException(
          { status: HttpStatus.NOT_FOUND, error: 'User not found.' },
          HttpStatus.NOT_FOUND,
        );
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
        throw new HttpException(
          {
            status: HttpStatus.CONFLICT,
            error:
              'This course is already assigned to this user. No changes were made.',
          },
          HttpStatus.CONFLICT,
        );
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
      if (error instanceof HttpException) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new HttpException(
          {
            status: HttpStatus.CONFLICT,
            error:
              'This course is already assigned to this user. No changes were made.',
          },
          HttpStatus.CONFLICT,
        );
      }
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error:
            error instanceof Error ? error.message : 'Something went wrong',
        },
        HttpStatus.BAD_REQUEST,
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
        throw new HttpException(
          { status: HttpStatus.NOT_FOUND, error: 'Course not found.' },
          HttpStatus.NOT_FOUND,
        );
      }
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        throw new HttpException(
          { status: HttpStatus.NOT_FOUND, error: 'User not found.' },
          HttpStatus.NOT_FOUND,
        );
      }

      const existingAssignment = await this.prisma.userCourse.findUnique({
        where: {
          userId_courseId: {
            userId,
            courseId,
          },
        },
      });
      if (existingAssignment) {
        throw new HttpException(
          {
            status: HttpStatus.CONFLICT,
            error:
              'This course is already assigned to this user. No changes were made.',
          },
          HttpStatus.CONFLICT,
        );
      }

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
      if (error instanceof HttpException) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new HttpException(
          {
            status: HttpStatus.CONFLICT,
            error:
              'This course is already assigned to this user. No changes were made.',
          },
          HttpStatus.CONFLICT,
        );
      }
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error:
            error instanceof Error ? error.message : 'Something went wrong',
        },
        HttpStatus.BAD_REQUEST,
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

      // Update the isActive status for the user-course relation. On the first
      // false→true activation, stamp activatedAt — this is the engagement
      // "start line" for NEVER_STARTED reminders. Only set it once (don't reset
      // on a later deactivate/reactivate would be a product call; keeping the
      // first activation is the conservative choice).
      const isFirstActivation =
        isActive && !userCourse.isActive && !userCourse.activatedAt;

      if (isFirstActivation && !userCourse.enrolledVersionId) {
        await this.courseVersionService.syncPublishedVersionWithLiveTree(
          courseId,
          null,
          'Sync before first enrollment activation',
        );
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.userCourse.update({
          where: { id: userCourse.id },
          data: {
            isActive,
            ...(isFirstActivation ? { activatedAt: new Date() } : {}),
          },
        });

        if (isFirstActivation && !userCourse.enrolledVersionId) {
          await this.courseVersionService.pinEnrollmentToLatest(
            userCourse.id,
            tx,
          );
        }
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
      const whereCondition =
        role === 'user' ? { userId, isActive: true } : { userId };

      const assignedCourses = await this.prisma.userCourse.findMany({
        where: whereCondition,
        include: {
          course: {
            include: {
              courseForms: {
                include: {
                  userFormCompletions: {
                    where: { userId },
                    select: { isComplete: true },
                  },
                },
              },
              Policy: {
                include: {
                  completions: {
                    where: { userId },
                    select: { isComplete: true },
                  },
                  items: {
                    where: { isRequired: true },
                    include: {
                      completions: {
                        where: { userId },
                        select: { isComplete: true },
                      },
                    },
                  },
                },
              },
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
              feedbackForm: {
                select: { isRequired: true, isActive: true },
              },
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
        return {
          message: 'Successfully retrieved assigned courses',
          statusCode: 200,
          data: [],
        };
      }

      const courseIds = assignedCourses.map((uc) => uc.courseId);
      const [feedbackSubmissions, completions] = await Promise.all([
        this.prisma.courseFeedbackSubmission.findMany({
          where: { userId, courseId: { in: courseIds } },
          select: { courseId: true },
        }),
        // Completion timestamps drive the post-completion access window so the
        // list can flag expired courses without a per-course gate fetch.
        this.prisma.courseCompletion.findMany({
          where: { userId, courseId: { in: courseIds } },
          select: { courseId: true, courseCompletedAt: true },
        }),
      ]);
      const feedbackSubmittedIds = new Set(
        feedbackSubmissions.map((s) => s.courseId),
      );
      const completedAtByCourse = new Map(
        completions
          .filter((c) => c.courseCompletedAt)
          .map((c) => [c.courseId, c.courseCompletedAt as Date]),
      );

      const versionIds = [
        ...new Set(
          assignedCourses
            .map((uc) => uc.enrolledVersionId)
            .filter((id): id is string => !!id),
        ),
      ];
      const versionSectionCounts = new Map<string, number>();
      if (versionIds.length > 0) {
        const counts = await this.prisma.courseVersionSection.groupBy({
          by: ['versionId'],
          where: { versionId: { in: versionIds }, isActive: true },
          _count: { id: true },
        });
        for (const row of counts) {
          versionSectionCounts.set(row.versionId, row._count.id);
        }
      }

      const coursesWithDetails = assignedCourses.map((userCourse) => {
        const { course, isActive, isPaid, enrolledVersionId } =
          userCourse as any;

        // Form completion status (unchanged)
        const formStatus = {
          totalForms: course.courseForms?.length || 0,
          completedForms:
            course.courseForms?.filter(
              (form) => form.userFormCompletions?.some((uc) => uc.isComplete),
            ).length || 0,
          forms:
            course.courseForms?.map((form) => ({
              courseFormId: form.id,
              formId: form.formId,
              formName: form.formName,
              isRequired: form.isRequired,
              isComplete:
                form.userFormCompletions?.some((uc) => uc.isComplete) || false,
            })) || [],
        };

        // Policy completion status - only required policies matter for access
        const requiredPolicies = course.Policy || [];

        // Policy-level completion (all required policies must be completed)
        const allRequiredPoliciesCompleted = requiredPolicies.every(
          (policy) => policy.completions?.some((uc) => uc.isComplete),
        );

        // Item-level completion (all required items across all policies must be completed)
        const allRequiredItems = requiredPolicies.flatMap(
          (policy) => policy.items?.filter((item) => item.isRequired) || [],
        );

        const allRequiredItemsCompleted = allRequiredItems.every(
          (item) => item.completions?.some((uc) => uc.isComplete),
        );

        const policyStatus = {
          totalPolicies: requiredPolicies.length,
          completedPolicies:
            requiredPolicies.filter(
              (policy) => policy.completions?.some((uc) => uc.isComplete),
            ).length || 0,
          policies:
            requiredPolicies.map((policy) => ({
              policyId: policy.id,
              title: policy.title,
              description: policy.description,
              isComplete:
                policy.completions?.some((uc) => uc.isComplete) || false,
              items:
                policy.items?.map((item) => ({
                  itemId: item.id,
                  title: item.title,
                  description: item.description,
                  link: item.link,
                  isRequired: item.isRequired,
                  isComplete:
                    item.completions?.some((uc) => uc.isComplete) || false,
                })) || [],
            })) || [],
        };

        const sectionsCount = enrolledVersionId
          ? versionSectionCounts.get(enrolledVersionId) ?? 0
          : course.modules
              ?.flatMap((module) => module.chapters)
              ?.reduce((acc, chapter) => acc + chapter._count.sections, 0) || 0;

        const userCourseProgressCount = course._count?.UserCourseProgress || 0;

        const latestLastSeenSection = course.LastSeenSection?.[0];

        const formsCompleted =
          formStatus.totalForms === formStatus.completedForms;

        // Updated access control logic
        const canAccessPolicies = formsCompleted;
        const canAccessContent =
          formsCompleted &&
          // allRequiredPoliciesCompleted &&
          allRequiredItemsCompleted;

        // Post-completion access window: once completed, access lasts
        // validityDays (default 365) from courseCompletedAt. Computed live;
        // mirrors the canAccessCourseContent gate so list CTAs can show an
        // "expired" state without a per-course gate fetch. Learners only.
        const completedAt = completedAtByCourse.get(course.id);
        const isFrozen = !!completedAt;
        let expired = false;
        let expiresAt: Date | null = null;
        if (completedAt) {
          expiresAt = new Date(completedAt);
          expiresAt.setDate(expiresAt.getDate() + (course.validityDays ?? 365));
          expired = role === 'user' && new Date() > expiresAt;
        }

        return {
          ...course,
          isActive,
          isPaid,
          expired,
          expiresAt,
          isCompleted: isFrozen,
          completedAt: completedAt ?? null,
          feedbackForm: course.feedbackForm
            ? {
                isRequired: course.feedbackForm.isRequired,
                isCompleted: feedbackSubmittedIds.has(course.id),
              }
            : null,
          percentage: isFrozen
            ? 100
            : sectionsCount > 0
              ? (userCourseProgressCount * 100) / sectionsCount
              : 0,
          _count: {
            totalSections: sectionsCount,
            userCourseProgress: isFrozen
              ? sectionsCount
              : userCourseProgressCount,
          },
          formStatus,
          policyStatus,
          policyItemStatus: {
            totalItems: allRequiredItems.length,
            completedItems: allRequiredItems.filter(
              (item) => item.completions?.some((uc) => uc.isComplete),
            ).length,
          },
          canAccessPolicies,
          canAccessContent,
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
        message: 'Successfully retrieved assigned courses with status',
        statusCode: 200,
        data: coursesWithDetails,
      };
    } catch (error) {
      console.error(error);
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
    userEmail?: string | null,
  ): Promise<ResponseDto> {
    try {
      await assertChapterAccessible(
        this.prisma,
        this.config,
        userId,
        body.chapterId,
        userEmail,
      );

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
        // A new section was just completed — re-check whether the user has now
        // finished all content for this course (content completion is the
        // course-completion criterion; assessment pass is tracked separately).
        await this._checkContentCompletion(userId, body.courseId);
        await recordChapterAndModuleCompletionIfNeeded(
          this.prisma,
          userId,
          body.chapterId,
          { courseId: body.courseId },
        );
      }

      return {
        message: 'User course progress updated successfully',
        statusCode: 200,
        data: {
          userCourseProgress,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
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

  /**
   * Resolve a learner's enrollment for a course and assert it is currently
   * usable. Enforces, for `user`-role callers only (admins/staff bypass):
   *   1. an enrollment exists and is active (UserCourse.isActive), and
   *   2. the post-completion access window has not elapsed — once a course is
   *      completed (CourseCompletion.courseCompletedAt), access lasts
   *      course.validityDays days (default 365). Expiry is computed live; the
   *      enrollment row is left untouched.
   *
   * Returns the enrollment on success. Throws ForbiddenException otherwise, so
   * callers can replace their existing inline enrollment lookup with this.
   */
  private async _assertEnrollmentUsable(
    userId: string,
    courseId: string,
    userRole: Role,
  ): Promise<any> {
    const isLearner = userRole === Role.user;
    const enrollment = await this.prisma.userCourse.findFirst({
      where: isLearner
        ? { userId, courseId, isActive: true }
        : { userId, courseId },
    });
    if (!enrollment) {
      throw new ForbiddenException({
        detail:
          'You are not assigned to this course, or the enrolment is inactive',
      });
    }

    // Expiry only applies to learners and only once the course is completed.
    if (isLearner) {
      const [completion, course] = await Promise.all([
        this.prisma.courseCompletion.findUnique({
          where: { userId_courseId: { userId, courseId } },
          select: { courseCompletedAt: true },
        }),
        this.prisma.course.findUnique({
          where: { id: courseId },
          select: { validityDays: true },
        }),
      ]);

      if (completion?.courseCompletedAt) {
        const validityDays = course?.validityDays ?? 365;
        const expiresAt = new Date(completion.courseCompletedAt);
        expiresAt.setDate(expiresAt.getDate() + validityDays);
        if (new Date() > expiresAt) {
          throw new ForbiddenException({
            detail: `Your access to this course expired on ${
              expiresAt.toISOString().split('T')[0]
            }. Please contact your administrator to renew access.`,
          });
        }
      }
    }

    return enrollment;
  }

  /**
   * Content-completion check. A course is "completed" once the user has a
   * UserCourseProgress row for every active section in the course — this is the
   * completion criterion for ALL courses (many courses have no assessment).
   * Assessment pass is tracked separately on CourseCompletion (isPassed /
   * assessmentPassedAt) and is NOT required for completion.
   *
   * Best-effort: never throws into the caller — a completion-bookkeeping failure
   * must not fail recording the user's progress. Idempotent: courseCompletedAt
   * is only stamped once (first time 100% is reached).
   */
  private async _checkContentCompletion(
    userId: string,
    courseId: string,
  ): Promise<void> {
    try {
      const { total: totalSections, liveSectionIds } =
        await this.courseVersionService.countCompletionDenominator(
          userId,
          courseId,
        );
      if (totalSections === 0) return;

      const progressed = await this.prisma.userCourseProgress.findMany({
        where: { userId, courseId, sectionId: { in: liveSectionIds } },
        select: { sectionId: true },
        distinct: ['sectionId'],
      });
      if (progressed.length < totalSections) return;

      // 100% of content done — mark complete (idempotent: don't overwrite an
      // existing courseCompletedAt). Preserve any assessment fields already set.
      const existing = await this.prisma.courseCompletion.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: { courseCompletedAt: true },
      });
      if (existing?.courseCompletedAt) return; // already recorded

      await this.prisma.courseCompletion.upsert({
        where: { userId_courseId: { userId, courseId } },
        create: { userId, courseId, courseCompletedAt: new Date() },
        update: { courseCompletedAt: new Date() },
      });

      // Course was JUST completed (first time) — send the milestone emails.
      await this._sendCompletionEmails(userId, courseId);
      await this.feedbackService.notifyFeedbackRequiredIfNeeded(
        userId,
        courseId,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      CourseService.completionLogger.warn(
        `Content-completion check failed for user ${userId}, course ${courseId}: ${message}`,
      );
    }
  }

  /**
   * On first course completion: (1) a congratulations email, and (2) — if the
   * course has a feedback form the user hasn't submitted yet — a separate
   * feedback-request email. Best-effort: never throws into the completion path.
   */
  private async _sendCompletionEmails(
    userId: string,
    courseId: string,
  ): Promise<void> {
    try {
      const [user, course] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { email: true, firstName: true, deletedAt: true },
        }),
        this.prisma.course.findUnique({
          where: { id: courseId },
          select: { title: true },
        }),
      ]);
      if (!user?.email || user.deletedAt || !course) return;

      // 1) Congratulations.
      await this.mail.sendCourseCompleted({
        to: user.email,
        userId,
        firstName: user.firstName ?? '',
        courseTitle: course.title,
        courseId,
      });

      // 2) Feedback request — only if an active feedback form exists for the
      //    course AND the user hasn't already submitted feedback.
      const [form, alreadySubmitted] = await Promise.all([
        this.prisma.courseFeedbackForm.findFirst({
          where: { courseId, isActive: true },
          select: { id: true },
        }),
        this.prisma.courseFeedbackSubmission.findFirst({
          where: { userId, courseId },
          select: { id: true },
        }),
      ]);
      if (form && !alreadySubmitted) {
        await this.mail.sendFeedbackRequest({
          to: user.email,
          userId,
          firstName: user.firstName ?? '',
          courseTitle: course.title,
          courseId,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      CourseService.completionLogger.warn(
        `Completion emails failed for user ${userId}, course ${courseId}: ${message}`,
      );
    }
  }

  async getUserChapterProgress(
    userId: string,
    courseId: string,
    chapterId: string,
  ): Promise<ResponseDto> {
    try {
      const [userCourseProgress, completion, curriculum] = await Promise.all([
        this.prisma.userCourseProgress.findMany({
          where: {
            userId,
            courseId,
            chapterId,
          },
        }),
        this.prisma.courseCompletion.findUnique({
          where: { userId_courseId: { userId, courseId } },
          select: { courseCompletedAt: true },
        }),
        this.courseVersionService.resolveCurriculumTree(userId, courseId),
      ]);

      const newSinceCompletion =
        await this.courseVersionService.summarizeNewSincePinnedVersion(
          userId,
          courseId,
        );

      if (curriculum.mode === 'versioned') {
        const found = this.courseVersionService.findVersionChapterBySourceId(
          curriculum.version,
          chapterId,
        );
        if (!found) {
          throw new HttpException(
            { status: HttpStatus.NOT_FOUND, error: 'Chapter not found' },
            HttpStatus.NOT_FOUND,
          );
        }

        const versionSectionIds = found.chapter.sections
          .filter((s) => s.isActive && s.sourceSectionId)
          .map((s) => s.sourceSectionId as string);
        const totalSections = versionSectionIds.length;
        const progressSectionIds = new Set(
          userCourseProgress.map((p) => p.sectionId),
        );
        const completedSections = Math.min(
          versionSectionIds.filter((id) => progressSectionIds.has(id)).length,
          totalSections,
        );

        const isFrozen = !!completion?.courseCompletedAt;
        let percentage = 0;
        if (isFrozen) {
          percentage = 100;
        } else if (totalSections > 0) {
          percentage = (completedSections * 100) / totalSections;
        }

        return {
          message: 'User course progress updated successfully',
          statusCode: 200,
          data: {
            userCourseProgress: percentage,
            courseProgressData: userCourseProgress,
            totalSections,
            completedSections: isFrozen ? totalSections : completedSections,
            isCompleted: isFrozen,
            completedAt: completion?.courseCompletedAt ?? null,
            enrolledVersionNumber: curriculum.versionNumber,
            ...(newSinceCompletion ? { newSinceCompletion } : {}),
          },
        };
      }

      const chapter = await this.prisma.chapter.findUnique({
        where: { id: chapterId },
        include: {
          sections: { where: { isArchived: false }, select: { id: true } },
          module: { select: { courseId: true } },
        },
      });

      if (!chapter) {
        throw new HttpException(
          { status: HttpStatus.NOT_FOUND, error: 'Chapter not found' },
          HttpStatus.NOT_FOUND,
        );
      }
      if (chapter.module?.courseId !== courseId) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Chapter does not belong to the specified course',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const isFrozen = !!completion?.courseCompletedAt;
      const totalSections = chapter.sections.length;
      // Clamp completed sections to the number of sections that actually
      // exist in this chapter — UserCourseProgress rows can outlive the
      // sections they reference (e.g. a section was deleted/moved after the
      // learner completed it), and counting those would push percentage
      // above 100% for in-progress users.
      const completedSections = Math.min(
        userCourseProgress.length,
        totalSections,
      );

      let percentage = 0;
      if (isFrozen) {
        percentage = 100;
      } else if (totalSections > 0) {
        percentage = (completedSections * 100) / totalSections;
      }

      return {
        message: 'User course progress updated successfully',
        statusCode: 200,
        data: {
          userCourseProgress: percentage,
          courseProgressData: userCourseProgress,
          totalSections,
          completedSections: isFrozen ? totalSections : completedSections,
          isCompleted: isFrozen,
          completedAt: completion?.courseCompletedAt ?? null,
          ...(newSinceCompletion ? { newSinceCompletion } : {}),
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
    userEmail?: string | null,
  ): Promise<ResponseDto> {
    try {
      await assertChapterAccessible(
        this.prisma,
        this.config,
        userId,
        chapterId,
        userEmail,
      );

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
      if (error instanceof HttpException) {
        throw error;
      }
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

  // Student: submit course completion feedback (delegates to FeedbackService)
  async submitCourseFeedback(
    studentId: string,
    courseId: string,
    body: { formVersion?: string; formData: unknown },
  ): Promise<ResponseDto> {
    return this.feedbackService.submitCourseFeedback(
      studentId,
      courseId,
      body,
    );
  }

  async getCourseFeedbackStatus(
    studentId: string,
    courseId: string,
  ): Promise<ResponseDto> {
    return this.feedbackService.getCourseFeedbackStatus(studentId, courseId);
  }

  async getCourseFeedbackSubmissions(
    courseId: string,
    adminId: string,
  ): Promise<ResponseDto> {
    return this.feedbackService.getCourseFeedbackSubmissions(
      courseId,
      adminId,
    );
  }

  /**
   * Testing/admin: clear all learner progress for a course (sections, quizzes,
   * forms, policies, feedback, assessments). Does not unassign the course.
   */
  async resetUserCourseProgress(
    adminId: string,
    userId: string,
    courseId: string,
  ): Promise<ResponseDto> {
    try {
      const admin = await this.prisma.user.findUnique({
        where: { id: adminId },
        select: { role: true },
      });
      if (!admin || admin.role !== 'admin') {
        throw new ForbiddenException('Only admins can reset course progress');
      }

      const [user, course] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, deletedAt: true },
        }),
        this.prisma.course.findUnique({
          where: { id: courseId },
          select: { id: true },
        }),
      ]);
      if (!user || user.deletedAt) {
        throw new BadRequestException('User not found');
      }
      if (!course) {
        throw new BadRequestException('Course not found');
      }

      const chapters = await this.prisma.chapter.findMany({
        where: { module: { courseId } },
        select: { id: true },
      });
      const chapterIds = chapters.map((c) => c.id);

      const assessmentIds = (
        await this.prisma.assessment.findMany({
          where: { courseId },
          select: { id: true },
        })
      ).map((a) => a.id);

      const deleted = await this.prisma.$transaction(async (tx) => {
        const sectionProgress = await tx.userCourseProgress.deleteMany({
          where: { userId, courseId },
        });
        const lastSeen = await tx.lastSeenSection.deleteMany({
          where: { userId, courseId },
        });
        const quizProgress =
          chapterIds.length > 0
            ? await tx.quizProgress.deleteMany({
                where: { userId, chapterId: { in: chapterIds } },
              })
            : { count: 0 };
        const quizAnswers =
          chapterIds.length > 0
            ? await tx.quizAnswer.deleteMany({
                where: { userId, chapterId: { in: chapterIds } },
              })
            : { count: 0 };
        const formCompletions = await tx.userFormCompletion.deleteMany({
          where: { userId, courseId },
        });
        const policyCompletions = await tx.userPolicyCompletion.deleteMany({
          where: { userId, courseId },
        });
        const policyItemCompletions =
          await tx.userPolicyItemCompletion.deleteMany({
            where: {
              userId,
              item: { policy: { courseId } },
            },
          });
        const feedbackSubmissions =
          await tx.courseFeedbackSubmission.deleteMany({
            where: { userId, courseId },
          });
        const courseCompletions = await tx.courseCompletion.deleteMany({
          where: { userId, courseId },
        });
        const chapterCompletions = await tx.userChapterCompletion.deleteMany({
          where: { userId, courseId },
        });
        const moduleCompletions = await tx.userModuleCompletion.deleteMany({
          where: { userId, courseId },
        });
        const sectionAttemptsReset = await tx.sectionTimeSpent.updateMany({
          where: { userId, courseId },
          data: {
            totalAttempts: 0,
            firstAttemptAt: null,
            lastAttemptAt: null,
          },
        });
        const assessmentAttempts =
          assessmentIds.length > 0
            ? await tx.assessmentAttempt.deleteMany({
                where: { userId, assessmentId: { in: assessmentIds } },
              })
            : { count: 0 };

        return {
          sectionProgress: sectionProgress.count,
          lastSeen: lastSeen.count,
          quizProgress: quizProgress.count,
          quizAnswers: quizAnswers.count,
          formCompletions: formCompletions.count,
          policyCompletions: policyCompletions.count,
          policyItemCompletions: policyItemCompletions.count,
          feedbackSubmissions: feedbackSubmissions.count,
          courseCompletions: courseCompletions.count,
          chapterCompletions: chapterCompletions.count,
          moduleCompletions: moduleCompletions.count,
          sectionAttemptsReset: sectionAttemptsReset.count,
          assessmentAttempts: assessmentAttempts.count,
        };
      });

      return {
        message: 'User course progress reset successfully',
        statusCode: 200,
        data: { userId, courseId, deleted },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to reset course progress',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
