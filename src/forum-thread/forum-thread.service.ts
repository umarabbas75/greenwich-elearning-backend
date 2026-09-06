import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ForumThread,
  ForumViewScope,
  Prisma,
  Role,
  User,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import {
  assertCourseScope,
  assertStudentMayCreate,
  categoryAllows,
  isAdminRole,
  resolveNewThreadStatus,
  shouldBroadcastNewThread,
} from './forum-policy';
import { notifyForumMentions } from './forum-mention-notify';
import { parseVoteValue, toggleForumVote, withVotedByMe } from './forum-vote';
import {
  flattenThreadTags,
  parseAttachmentList,
  resolveTagIds,
  TAG_SELECT,
  THREAD_LIST_TAKE,
  threadExcerpt,
} from './forum-extras';

export type ForumThreadListQuery = {
  categoryId?: string;
  courseId?: string;
  q?: string;
  sort?: string;
  tagId?: string;
  tag?: string;
};

const THREAD_AUTHOR = {
  id: true,
  firstName: true,
  lastName: true,
  photo: true,
  role: true,
} satisfies Prisma.UserSelect;

const THREAD_COURSE = {
  id: true,
  title: true,
} satisfies Prisma.CourseSelect;

const LIST_CATEGORY = {
  id: true,
  name: true,
  slug: true,
  allowAcceptedAnswer: true,
  allowVotes: true,
  allowMentions: true,
  tagPolicy: true,
  allowAttachments: true,
} satisfies Prisma.ForumCategorySelect;

const THREAD_CATEGORY = {
  id: true,
  name: true,
  slug: true,
  description: true,
  icon: true,
  courseScope: true,
  studentCreatePolicy: true,
  notifyOnCreate: true,
  allowAcceptedAnswer: true,
  allowVotes: true,
  allowMentions: true,
  tagPolicy: true,
  allowAttachments: true,
  isActive: true,
} satisfies Prisma.ForumCategorySelect;

const THREAD_TAGS_INCLUDE = {
  select: { tag: { select: TAG_SELECT } },
} satisfies Prisma.ForumThreadInclude['threadTags'];

const THREAD_ATTACHMENTS_INCLUDE = {
  select: {
    id: true,
    url: true,
    publicId: true,
    fileName: true,
    mimeType: true,
    bytes: true,
    createdAt: true,
  },
  orderBy: { createdAt: 'asc' as const },
};

@Injectable()
export class ForumThreadService {
  private static readonly logger = new Logger(ForumThreadService.name);

  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  async subscribeForumThread(body: any, userId: string): Promise<any> {
    try {
      const subscribe = await this.prisma.threadSubscription.create({
        data: {
          userId,
          threadId: body.threadId,
        },
      });
      return {
        message: 'Successfully subscribe the thread for user',
        statusCode: 200,
        data: subscribe,
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

  async unSubscribeForumThread(params: any, userId: string): Promise<any> {
    try {
      const subscribe = await this.prisma.threadSubscription.delete({
        where: {
          userId_threadId: {
            userId,
            threadId: params.id,
          },
        },
      });
      return {
        message: 'Successfully unsubscribe the thread for user',
        statusCode: 200,
        data: subscribe,
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

  async createFavoriteForumThread(body: any, userId: string): Promise<any> {
    try {
      const favorite = await this.prisma.favoriteForumThread.create({
        data: {
          userId,
          threadId: body.threadId,
        },
      });
      return {
        message: 'Successfully favorite the thread for user',
        statusCode: 200,
        data: favorite,
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

  async unFavoriteForumThread(params: any, userId: string): Promise<any> {
    try {
      const favorite = await this.prisma.favoriteForumThread.delete({
        where: {
          userId_threadId: {
            userId,
            threadId: params.id,
          },
        },
      });
      return {
        message: 'Successfully unfavorite the thread for user',
        statusCode: 200,
        data: favorite,
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

  async getAllForumThreads(
    user: User,
    query: ForumThreadListQuery = {},
  ): Promise<any> {
    try {
      const filters: Prisma.ForumThreadWhereInput[] = [];
      if (user.role === Role.user) {
        filters.push({ status: 'active' });
        filters.push({
          OR: [
            { courseId: null },
            {
              course: {
                users: { some: { userId: user.id, isActive: true } },
              },
            },
          ],
        });
        filters.push({
          OR: [{ categoryId: null }, { category: { isActive: true } }],
        });
      }
      if (query.categoryId) filters.push({ categoryId: query.categoryId });
      if (query.courseId) filters.push({ courseId: query.courseId });
      if (query.tagId) {
        filters.push({ threadTags: { some: { tagId: query.tagId } } });
      } else if (query.tag?.trim()) {
        filters.push({
          threadTags: { some: { tag: { slug: query.tag.trim() } } },
        });
      }
      const q = query.q?.trim();
      if (q) {
        filters.push({
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { excerpt: { contains: q, mode: 'insensitive' } },
          ],
        });
      }

      const forums = await this.prisma.forumThread.findMany({
        where: filters.length ? { AND: filters } : undefined,
        take: THREAD_LIST_TAKE,
        select: {
          id: true,
          title: true,
          excerpt: true,
          status: true,
          isPinned: true,
          lastActivityAt: true,
          voteScore: true,
          acceptedCommentId: true,
          createdAt: true,
          categoryId: true,
          courseId: true,
          userId: true,
          user: { select: THREAD_AUTHOR },
          course: { select: THREAD_COURSE },
          category: { select: LIST_CATEGORY },
          votes: {
            where: { userId: user.id },
            select: { id: true },
          },
          FavoriteForumThread: {
            where: { userId: user.id },
            select: { id: true },
          },
          ThreadSubscription: {
            where: { userId: user.id },
            select: { id: true },
          },
          ForumComment: {
            select: {
              id: true,
              user: { select: THREAD_AUTHOR },
              createdAt: true,
            },
            orderBy: { createdAt: Prisma.SortOrder.desc },
            take: 3,
          },
          threadTags: THREAD_TAGS_INCLUDE,
          _count: { select: { ForumComment: true } },
        },
        orderBy:
          query.sort === 'top'
            ? [
                { isPinned: 'desc' },
                { voteScore: 'desc' },
                { lastActivityAt: 'desc' },
              ]
            : [{ isPinned: 'desc' }, { lastActivityAt: 'desc' }],
      });

      const data = forums.map((thread) => {
        const voted = withVotedByMe(thread);
        const {
          _count,
          FavoriteForumThread,
          ThreadSubscription,
          threadTags,
          ...rest
        } = voted;
        return {
          ...rest,
          tags: flattenThreadTags(threadTags),
          commentCount: _count.ForumComment,
          isFavorite: FavoriteForumThread.length > 0,
          isSubscribed: ThreadSubscription.length > 0,
        };
      });

      return {
        message: 'Successfully fetched all forum threads',
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

  async createForumThread(body: any, user: User): Promise<any> {
    try {
      if (!body?.categoryId) {
        throw new Error('categoryId is required');
      }
      if (!body?.title || !body?.content) {
        throw new Error('title and content are required');
      }

      const category = await this.prisma.forumCategory.findUnique({
        where: { id: body.categoryId },
      });
      if (!category) throw new Error('Category not found');

      assertStudentMayCreate(category, user.role);

      const courseId = body.courseId || null;
      assertCourseScope(category, courseId);
      if (courseId) {
        await this.assertCourseVisible(courseId, user);
      }

      const status = resolveNewThreadStatus({
        role: user.role,
        category,
        requestedStatus: body.status,
      });
      const isPinned = isAdminRole(user.role) && Boolean(body.isPinned);
      const now = new Date();
      const broadcast = shouldBroadcastNewThread({
        role: user.role,
        category,
        status,
      });

      const extras = await this.resolveWriteExtras(body, category, user);

      const newThread = await this.prisma.forumThread.create({
        data: {
          title: body.title,
          content: body.content,
          userId: user.id,
          courseId,
          categoryId: category.id,
          status,
          isPinned,
          lastActivityAt: now,
          notificationSent: broadcast,
          excerpt: threadExcerpt(String(body.content)),
          ThreadSubscription: {
            create: { userId: user.id },
          },
          ...(extras.tagIds.length
            ? {
                threadTags: {
                  create: extras.tagIds.map((tagId) => ({ tagId })),
                },
              }
            : {}),
          ...(extras.attachments.length
            ? { attachments: { create: extras.attachments } }
            : {}),
        },
        include: {
          user: { select: THREAD_AUTHOR },
          course: { select: THREAD_COURSE },
          category: { select: THREAD_CATEGORY },
          threadTags: THREAD_TAGS_INCLUDE,
          attachments: THREAD_ATTACHMENTS_INCLUDE,
        },
      });

      if (broadcast) {
        await this.notificationService.notifyAllUsersForNewThread({
          threadId: newThread.id,
          threadTitle: newThread.title,
          courseId: newThread.courseId,
          creator: {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
          },
        });
      } else if (!isAdminRole(user.role)) {
        await this.notificationService.notifyAdminsOfStudentThread({
          threadId: newThread.id,
          threadTitle: newThread.title,
          pendingReview: status !== 'active',
          creator: {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
          },
        });
      }

      await notifyForumMentions({
        prisma: this.prisma,
        notifications: this.notificationService,
        actor: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        content: newThread.content,
        threadId: newThread.id,
        threadTitle: newThread.title,
        allowMentions: categoryAllows(category, 'allowMentions'),
        sourceKey: `thread:${newThread.id}`,
      });

      return {
        message: 'Successfully created forum thread',
        statusCode: 200,
        data: {
          ...this.withTags(newThread),
          isFavorite: false,
          isSubscribed: true,
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

  async updateForumThread(
    forumThreadId: string,
    body: any,
    user: User,
  ): Promise<any> {
    try {
      const existingForumThread = await this.prisma.forumThread.findUnique({
        where: { id: forumThreadId },
        include: { category: true },
      });
      if (!existingForumThread) {
        throw new Error('Forum thread not found');
      }
      const admin = isAdminRole(user.role);
      if (!admin && existingForumThread.userId !== user.id) {
        throw new Error('You can only edit your own thread');
      }
      if (Object.entries(body ?? {}).length === 0) {
        throw new Error('wrong keys');
      }

      const data: Prisma.ForumThreadUpdateInput = {};
      if (body.title != null) data.title = body.title;
      if (body.content != null) {
        data.content = body.content;
        data.excerpt = threadExcerpt(String(body.content));
      }

      const nextCategoryId =
        body.categoryId !== undefined
          ? body.categoryId || null
          : existingForumThread.categoryId;
      const nextCourseId =
        body.courseId !== undefined
          ? body.courseId || null
          : existingForumThread.courseId;

      if (body.categoryId !== undefined || body.courseId !== undefined) {
        if (nextCategoryId) {
          const category = await this.prisma.forumCategory.findUnique({
            where: { id: nextCategoryId },
          });
          if (!category) throw new Error('Category not found');
          assertCourseScope(category, nextCourseId);
          data.category = { connect: { id: nextCategoryId } };
        } else {
          data.category = { disconnect: true };
        }
        if (nextCourseId) {
          await this.assertCourseVisible(nextCourseId, user);
          data.course = { connect: { id: nextCourseId } };
        } else if (body.courseId !== undefined) {
          data.course = { disconnect: true };
        }
      }

      const policyCategoryId = nextCategoryId ?? existingForumThread.categoryId;
      const extrasCategory =
        policyCategoryId === existingForumThread.categoryId
          ? existingForumThread.category
          : policyCategoryId
            ? await this.prisma.forumCategory.findUnique({
                where: { id: policyCategoryId },
              })
            : null;
      if (
        body.tagIds !== undefined ||
        body.tags !== undefined ||
        body.attachments !== undefined
      ) {
        const extras = await this.resolveWriteExtras(
          body,
          extrasCategory ?? undefined,
          user,
        );
        if (body.tagIds !== undefined || body.tags !== undefined) {
          data.threadTags = {
            deleteMany: {},
            create: extras.tagIds.map((tagId) => ({ tagId })),
          };
        }
        if (body.attachments !== undefined) {
          data.attachments = {
            deleteMany: {},
            create: extras.attachments,
          };
        }
      }

      if (admin) {
        if (body.status === 'active' || body.status === 'inActive') {
          data.status = body.status;
        }
        if (body.isPinned != null) data.isPinned = Boolean(body.isPinned);
      }

      const statusChangingToActive =
        existingForumThread.status === 'inActive' && data.status === 'active';
      const firstPublish =
        statusChangingToActive && !existingForumThread.notificationSent;

      let willNotify = false;
      if (firstPublish) {
        data.notificationSent = true;
        const categoryId = nextCategoryId ?? existingForumThread.categoryId;
        const notifyCategory = categoryId
          ? await this.prisma.forumCategory.findUnique({
              where: { id: categoryId },
            })
          : null;
        willNotify = notifyCategory
          ? shouldBroadcastNewThread({
              role: user.role,
              category: notifyCategory,
              status: 'active',
            })
          : isAdminRole(user.role);
      }

      const updatedForumThread = await this.prisma.forumThread.update({
        where: { id: forumThreadId },
        data,
        include: {
          user: { select: THREAD_AUTHOR },
          course: { select: THREAD_COURSE },
          category: { select: THREAD_CATEGORY },
          threadTags: THREAD_TAGS_INCLUDE,
          attachments: THREAD_ATTACHMENTS_INCLUDE,
        },
      });

      if (willNotify) {
        await this.notificationService.notifyAllUsersForNewThread({
          threadId: forumThreadId,
          threadTitle: updatedForumThread.title,
          courseId: updatedForumThread.courseId,
          creator: {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
          },
          skipAdmins: existingForumThread.userId !== user.id,
        });
      }

      return {
        message: 'Successfully updated forum record',
        statusCode: 200,
        data: this.withTags(updatedForumThread),
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

  async deleteForumThread(forumThreadId: string, user: User): Promise<any> {
    try {
      const quiz: ForumThread = await this.prisma.forumThread.findUnique({
        where: { id: forumThreadId },
      });
      if (!quiz) {
        throw new Error('Forum Thread not found');
      }
      if (!isAdminRole(user.role) && quiz.userId !== user.id) {
        throw new Error('You can only delete your own thread');
      }

      await this.prisma.forumThread.delete({
        where: { id: forumThreadId },
      });

      return {
        message: 'Successfully deleted forum thread record',
        statusCode: 200,
        data: {},
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

  async getForumThread(forumThreadId: string, user: User): Promise<any> {
    try {
      const visibility: Prisma.ForumThreadWhereInput[] = [{ id: forumThreadId }];
      if (!isAdminRole(user.role)) {
        visibility.push({
          OR: [{ status: 'active' }, { userId: user.id }],
        });
        visibility.push({
          OR: [
            { courseId: null },
            {
              course: {
                users: { some: { userId: user.id, isActive: true } },
              },
            },
          ],
        });
      }

      const forum = await this.prisma.forumThread.findFirst({
        where: { AND: visibility },
        include: {
          user: { select: THREAD_AUTHOR },
          course: { select: THREAD_COURSE },
          category: { select: THREAD_CATEGORY },
          threadTags: THREAD_TAGS_INCLUDE,
          attachments: THREAD_ATTACHMENTS_INCLUDE,
          votes: { where: { userId: user.id }, select: { id: true } },
        },
      });

      if (!forum) {
        throw new Error('Forum thread not found');
      }

      void this.recordForumView(user.id, {
        scope: ForumViewScope.thread,
        threadId: forum.id,
        courseId: forum.courseId,
      });

      return {
        message: 'Successfully fetch Quiz info',
        statusCode: 200,
        data: this.withTags(withVotedByMe(forum)),
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

  async deleteForumAttachment(
    threadId: string,
    attachmentId: string,
    user: User,
  ) {
    try {
      const attachment = await this.prisma.forumAttachment.findFirst({
        where: { id: attachmentId, threadId },
        select: {
          id: true,
          thread: { select: { userId: true } },
        },
      });
      if (!attachment) throw new Error('Attachment not found');
      if (
        !isAdminRole(user.role) &&
        attachment.thread.userId !== user.id
      ) {
        throw new Error('You can only remove attachments from your own thread');
      }
      await this.prisma.forumAttachment.delete({ where: { id: attachmentId } });
      return {
        message: 'Successfully deleted attachment',
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

  async voteForumThread(threadId: string, body: unknown, user: User) {
    try {
      const value = parseVoteValue(body);
      const result = await toggleForumVote(this.prisma, {
        userId: user.id,
        threadId,
        value,
      });

      return {
        message: value === 1 ? 'Liked thread' : 'Removed like',
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

  async searchMentions(
    user: User,
    query: { q?: string; threadId?: string; courseId?: string },
  ) {
    try {
      let courseId = query.courseId || null;
      let allowMentions = true;

      if (query.threadId) {
        const thread = await this.prisma.forumThread.findUnique({
          where: { id: query.threadId },
          select: {
            courseId: true,
            category: { select: { allowMentions: true } },
          },
        });
        if (!thread) throw new Error('Forum thread not found');
        allowMentions = categoryAllows(thread.category, 'allowMentions');
        courseId = thread.courseId;
      }

      if (!allowMentions) {
        return {
          message: 'Successfully fetched mention suggestions',
          statusCode: 200,
          data: [],
        };
      }

      if (courseId && !query.threadId) {
        await this.assertCourseVisible(courseId, user);
      }

      const term = query.q?.trim();
      const nameFilter: Prisma.UserWhereInput | undefined = term
        ? {
            OR: [
              { firstName: { contains: term, mode: 'insensitive' } },
              { lastName: { contains: term, mode: 'insensitive' } },
            ],
          }
        : undefined;
      const scope: Prisma.UserWhereInput | undefined = courseId
        ? {
            OR: [
              { role: Role.admin },
              {
                UserCourse: {
                  some: { courseId, isActive: true },
                },
              },
            ],
          }
        : undefined;

      const users = await this.prisma.user.findMany({
        where: {
          deletedAt: null,
          status: UserStatus.active,
          AND: [scope, nameFilter].filter(Boolean) as Prisma.UserWhereInput[],
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          photo: true,
          role: true,
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: 20,
      });

      return {
        message: 'Successfully fetched mention suggestions',
        statusCode: 200,
        data: users,
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

  /**
   * Append a forum view event. Best-effort: never throws into the caller.
   * List views are throttled to once per user per hour to avoid noisy refetches.
   */
  private async recordForumView(
    userId: string,
    args: {
      scope: ForumViewScope;
      threadId?: string | null;
      courseId?: string | null;
    },
  ): Promise<void> {
    try {
      if (args.scope === ForumViewScope.list) {
        const oneHourAgo = new Date(Date.now() - 3_600_000);
        const recent = await this.prisma.forumViewEvent.findFirst({
          where: {
            userId,
            scope: ForumViewScope.list,
            createdAt: { gte: oneHourAgo },
          },
          select: { id: true },
        });
        if (recent) return;
      }

      await this.prisma.forumViewEvent.create({
        data: {
          userId,
          scope: args.scope,
          threadId: args.threadId ?? null,
          courseId: args.courseId ?? null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ForumThreadService.logger.warn(
        `Failed to record forum view for user ${userId}: ${message}`,
      );
    }
  }

  private withTags<
    T extends {
      threadTags?: { tag: { id: string; name: string; slug: string } }[];
    },
  >(thread: T) {
    const { threadTags, ...rest } = thread;
    return {
      ...rest,
      tags: threadTags ? flattenThreadTags(threadTags) : [],
    };
  }

  private async resolveWriteExtras(
    body: { tagIds?: unknown; tags?: unknown; attachments?: unknown },
    category: { tagPolicy?: import('@prisma/client').ForumTagPolicy; allowAttachments?: boolean } | null | undefined,
    user: User,
  ) {
    const tagIds = await resolveTagIds(this.prisma, user, category?.tagPolicy, {
      tagIds: body.tagIds,
      tags: body.tags,
    });
    const attachments =
      body.attachments === undefined
        ? []
        : parseAttachmentList(body.attachments);
    if (attachments.length && !categoryAllows(category, 'allowAttachments')) {
      throw new Error('Attachments are not enabled for this category');
    }
    return { tagIds, attachments };
  }

  private async assertCourseVisible(courseId: string, user: User) {
    if (isAdminRole(user.role)) {
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true },
      });
      if (!course) throw new Error('Course not found');
      return;
    }
    const enrolled = await this.prisma.userCourse.findFirst({
      where: { userId: user.id, courseId, isActive: true },
      select: { id: true },
    });
    if (!enrolled) {
      throw new Error('You must be enrolled in this course to post here');
    }
  }
}
