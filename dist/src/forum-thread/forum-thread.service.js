"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ForumThreadService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForumThreadService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const notification_service_1 = require("../notifications/notification.service");
const forum_policy_1 = require("./forum-policy");
const forum_mention_notify_1 = require("./forum-mention-notify");
const forum_vote_1 = require("./forum-vote");
const forum_extras_1 = require("./forum-extras");
const THREAD_AUTHOR = {
    id: true,
    firstName: true,
    lastName: true,
    photo: true,
    role: true,
};
const THREAD_COURSE = {
    id: true,
    title: true,
};
const LIST_CATEGORY = {
    id: true,
    name: true,
    slug: true,
    allowAcceptedAnswer: true,
    allowVotes: true,
    allowMentions: true,
    tagPolicy: true,
    allowAttachments: true,
};
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
};
const THREAD_TAGS_INCLUDE = {
    select: { tag: { select: forum_extras_1.TAG_SELECT } },
};
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
    orderBy: { createdAt: 'asc' },
};
let ForumThreadService = ForumThreadService_1 = class ForumThreadService {
    constructor(prisma, notificationService) {
        this.prisma = prisma;
        this.notificationService = notificationService;
    }
    async subscribeForumThread(body, userId) {
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
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async unSubscribeForumThread(params, userId) {
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
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async createFavoriteForumThread(body, userId) {
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
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async unFavoriteForumThread(params, userId) {
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
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async getAllForumThreads(user, query = {}) {
        try {
            const filters = [];
            if (user.role === client_1.Role.user) {
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
            if (query.categoryId)
                filters.push({ categoryId: query.categoryId });
            if (query.courseId)
                filters.push({ courseId: query.courseId });
            if (query.tagId) {
                filters.push({ threadTags: { some: { tagId: query.tagId } } });
            }
            else if (query.tag?.trim()) {
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
                take: forum_extras_1.THREAD_LIST_TAKE,
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
                        orderBy: { createdAt: client_1.Prisma.SortOrder.desc },
                        take: 3,
                    },
                    threadTags: THREAD_TAGS_INCLUDE,
                    _count: { select: { ForumComment: true } },
                },
                orderBy: query.sort === 'top'
                    ? [
                        { isPinned: 'desc' },
                        { voteScore: 'desc' },
                        { lastActivityAt: 'desc' },
                    ]
                    : [{ isPinned: 'desc' }, { lastActivityAt: 'desc' }],
            });
            const data = forums.map((thread) => {
                const voted = (0, forum_vote_1.withVotedByMe)(thread);
                const { _count, FavoriteForumThread, ThreadSubscription, threadTags, ...rest } = voted;
                return {
                    ...rest,
                    tags: (0, forum_extras_1.flattenThreadTags)(threadTags),
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
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async createForumThread(body, user) {
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
            if (!category)
                throw new Error('Category not found');
            (0, forum_policy_1.assertStudentMayCreate)(category, user.role);
            const courseId = body.courseId || null;
            (0, forum_policy_1.assertCourseScope)(category, courseId);
            if (courseId) {
                await this.assertCourseVisible(courseId, user);
            }
            const status = (0, forum_policy_1.resolveNewThreadStatus)({
                role: user.role,
                category,
                requestedStatus: body.status,
            });
            const isPinned = (0, forum_policy_1.isAdminRole)(user.role) && Boolean(body.isPinned);
            const now = new Date();
            const broadcast = (0, forum_policy_1.shouldBroadcastNewThread)({
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
                    excerpt: (0, forum_extras_1.threadExcerpt)(String(body.content)),
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
            }
            else if (!(0, forum_policy_1.isAdminRole)(user.role)) {
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
            await (0, forum_mention_notify_1.notifyForumMentions)({
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
                allowMentions: (0, forum_policy_1.categoryAllows)(category, 'allowMentions'),
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
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async updateForumThread(forumThreadId, body, user) {
        try {
            const existingForumThread = await this.prisma.forumThread.findUnique({
                where: { id: forumThreadId },
                include: { category: true },
            });
            if (!existingForumThread) {
                throw new Error('Forum thread not found');
            }
            const admin = (0, forum_policy_1.isAdminRole)(user.role);
            if (!admin && existingForumThread.userId !== user.id) {
                throw new Error('You can only edit your own thread');
            }
            if (Object.entries(body ?? {}).length === 0) {
                throw new Error('wrong keys');
            }
            const data = {};
            if (body.title != null)
                data.title = body.title;
            if (body.content != null) {
                data.content = body.content;
                data.excerpt = (0, forum_extras_1.threadExcerpt)(String(body.content));
            }
            const nextCategoryId = body.categoryId !== undefined
                ? body.categoryId || null
                : existingForumThread.categoryId;
            const nextCourseId = body.courseId !== undefined
                ? body.courseId || null
                : existingForumThread.courseId;
            if (body.categoryId !== undefined || body.courseId !== undefined) {
                if (nextCategoryId) {
                    const category = await this.prisma.forumCategory.findUnique({
                        where: { id: nextCategoryId },
                    });
                    if (!category)
                        throw new Error('Category not found');
                    (0, forum_policy_1.assertCourseScope)(category, nextCourseId);
                    data.category = { connect: { id: nextCategoryId } };
                }
                else {
                    data.category = { disconnect: true };
                }
                if (nextCourseId) {
                    await this.assertCourseVisible(nextCourseId, user);
                    data.course = { connect: { id: nextCourseId } };
                }
                else if (body.courseId !== undefined) {
                    data.course = { disconnect: true };
                }
            }
            const policyCategoryId = nextCategoryId ?? existingForumThread.categoryId;
            const extrasCategory = policyCategoryId === existingForumThread.categoryId
                ? existingForumThread.category
                : policyCategoryId
                    ? await this.prisma.forumCategory.findUnique({
                        where: { id: policyCategoryId },
                    })
                    : null;
            if (body.tagIds !== undefined ||
                body.tags !== undefined ||
                body.attachments !== undefined) {
                const extras = await this.resolveWriteExtras(body, extrasCategory ?? undefined, user);
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
                if (body.isPinned != null)
                    data.isPinned = Boolean(body.isPinned);
            }
            const statusChangingToActive = existingForumThread.status === 'inActive' && data.status === 'active';
            const firstPublish = statusChangingToActive && !existingForumThread.notificationSent;
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
                    ? (0, forum_policy_1.shouldBroadcastNewThread)({
                        role: user.role,
                        category: notifyCategory,
                        status: 'active',
                    })
                    : (0, forum_policy_1.isAdminRole)(user.role);
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
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async deleteForumThread(forumThreadId, user) {
        try {
            const quiz = await this.prisma.forumThread.findUnique({
                where: { id: forumThreadId },
            });
            if (!quiz) {
                throw new Error('Forum Thread not found');
            }
            if (!(0, forum_policy_1.isAdminRole)(user.role) && quiz.userId !== user.id) {
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
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2003') {
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.FORBIDDEN,
                    error: 'Cannot delete it because it is associated with other records.',
                }, common_1.HttpStatus.FORBIDDEN);
            }
            else {
                throw new common_1.HttpException({
                    status: common_1.HttpStatus.FORBIDDEN,
                    error: error?.message || 'Something went wrong',
                }, common_1.HttpStatus.FORBIDDEN, {
                    cause: error,
                });
            }
        }
    }
    async getForumThread(forumThreadId, user) {
        try {
            const visibility = [{ id: forumThreadId }];
            if (!(0, forum_policy_1.isAdminRole)(user.role)) {
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
                scope: client_1.ForumViewScope.thread,
                threadId: forum.id,
                courseId: forum.courseId,
            });
            return {
                message: 'Successfully fetch Quiz info',
                statusCode: 200,
                data: this.withTags((0, forum_vote_1.withVotedByMe)(forum)),
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async deleteForumAttachment(threadId, attachmentId, user) {
        try {
            const attachment = await this.prisma.forumAttachment.findFirst({
                where: { id: attachmentId, threadId },
                select: {
                    id: true,
                    thread: { select: { userId: true } },
                },
            });
            if (!attachment)
                throw new Error('Attachment not found');
            if (!(0, forum_policy_1.isAdminRole)(user.role) &&
                attachment.thread.userId !== user.id) {
                throw new Error('You can only remove attachments from your own thread');
            }
            await this.prisma.forumAttachment.delete({ where: { id: attachmentId } });
            return {
                message: 'Successfully deleted attachment',
                statusCode: 200,
                data: {},
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async voteForumThread(threadId, body, user) {
        try {
            const value = (0, forum_vote_1.parseVoteValue)(body);
            const result = await (0, forum_vote_1.toggleForumVote)(this.prisma, {
                userId: user.id,
                threadId,
                value,
            });
            return {
                message: value === 1 ? 'Liked thread' : 'Removed like',
                statusCode: 200,
                data: result,
            };
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async searchMentions(user, query) {
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
                if (!thread)
                    throw new Error('Forum thread not found');
                allowMentions = (0, forum_policy_1.categoryAllows)(thread.category, 'allowMentions');
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
            const nameFilter = term
                ? {
                    OR: [
                        { firstName: { contains: term, mode: 'insensitive' } },
                        { lastName: { contains: term, mode: 'insensitive' } },
                    ],
                }
                : undefined;
            const scope = courseId
                ? {
                    OR: [
                        { role: client_1.Role.admin },
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
                    status: client_1.UserStatus.active,
                    AND: [scope, nameFilter].filter(Boolean),
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
        }
        catch (error) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: error?.message || 'Something went wrong',
            }, common_1.HttpStatus.FORBIDDEN, {
                cause: error,
            });
        }
    }
    async recordForumView(userId, args) {
        try {
            if (args.scope === client_1.ForumViewScope.list) {
                const oneHourAgo = new Date(Date.now() - 3600000);
                const recent = await this.prisma.forumViewEvent.findFirst({
                    where: {
                        userId,
                        scope: client_1.ForumViewScope.list,
                        createdAt: { gte: oneHourAgo },
                    },
                    select: { id: true },
                });
                if (recent)
                    return;
            }
            await this.prisma.forumViewEvent.create({
                data: {
                    userId,
                    scope: args.scope,
                    threadId: args.threadId ?? null,
                    courseId: args.courseId ?? null,
                },
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            ForumThreadService_1.logger.warn(`Failed to record forum view for user ${userId}: ${message}`);
        }
    }
    withTags(thread) {
        const { threadTags, ...rest } = thread;
        return {
            ...rest,
            tags: threadTags ? (0, forum_extras_1.flattenThreadTags)(threadTags) : [],
        };
    }
    async resolveWriteExtras(body, category, user) {
        const tagIds = await (0, forum_extras_1.resolveTagIds)(this.prisma, user, category?.tagPolicy, {
            tagIds: body.tagIds,
            tags: body.tags,
        });
        const attachments = body.attachments === undefined
            ? []
            : (0, forum_extras_1.parseAttachmentList)(body.attachments);
        if (attachments.length && !(0, forum_policy_1.categoryAllows)(category, 'allowAttachments')) {
            throw new Error('Attachments are not enabled for this category');
        }
        return { tagIds, attachments };
    }
    async assertCourseVisible(courseId, user) {
        if ((0, forum_policy_1.isAdminRole)(user.role)) {
            const course = await this.prisma.course.findUnique({
                where: { id: courseId },
                select: { id: true },
            });
            if (!course)
                throw new Error('Course not found');
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
};
exports.ForumThreadService = ForumThreadService;
ForumThreadService.logger = new common_1.Logger(ForumThreadService_1.name);
exports.ForumThreadService = ForumThreadService = ForumThreadService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        notification_service_1.NotificationService])
], ForumThreadService);
//# sourceMappingURL=forum-thread.service.js.map