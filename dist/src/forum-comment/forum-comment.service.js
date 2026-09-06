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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForumCommentService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const notification_service_1 = require("../notifications/notification.service");
const mail_layout_1 = require("../mail/templates/mail-layout");
const forum_policy_1 = require("../forum-thread/forum-policy");
const forum_mention_notify_1 = require("../forum-thread/forum-mention-notify");
const forum_vote_1 = require("../forum-thread/forum-vote");
const with_db_retry_1 = require("../utils/with-db-retry");
const forum_comment_tree_1 = require("./forum-comment-tree");
const forum_reply_words_1 = require("./forum-reply-words");
function buildExcerpt(content, maxLen = 140) {
    return content.replace(/<[^>]*>/g, '').slice(0, maxLen);
}
const COMMENT_AUTHOR = {
    id: true,
    firstName: true,
    lastName: true,
    photo: true,
    role: true,
};
let ForumCommentService = class ForumCommentService {
    constructor(prisma, notificationService) {
        this.prisma = prisma;
        this.notificationService = notificationService;
    }
    async createForumThreadComment(body, user) {
        try {
            if (!body?.threadId)
                throw new Error('threadId is required');
            if (!body?.content)
                throw new Error('content is required');
            (0, forum_reply_words_1.assertForumReplyWordLimit)(String(body.content));
            const parentId = body.parentId ? String(body.parentId) : null;
            let thread = null;
            let parentAuthorId = null;
            if (parentId) {
                const parent = await this.prisma.forumComment.findFirst({
                    where: { id: parentId, threadId: body.threadId },
                    select: {
                        id: true,
                        parentId: true,
                        userId: true,
                        thread: {
                            select: {
                                id: true,
                                title: true,
                                userId: true,
                                category: { select: { allowMentions: true } },
                            },
                        },
                    },
                });
                if (!parent?.thread)
                    throw new Error('Forum comment not found');
                if (parent.parentId) {
                    throw new Error('Replies can only be one level deep');
                }
                thread = parent.thread;
                parentAuthorId = parent.userId;
            }
            else {
                thread = await this.prisma.forumThread.findUnique({
                    where: { id: body.threadId },
                    select: {
                        id: true,
                        title: true,
                        userId: true,
                        category: { select: { allowMentions: true } },
                    },
                });
            }
            if (!thread)
                throw new Error('Forum thread not found');
            const threadId = thread.id;
            const threadTitle = thread.title;
            const allowMentions = (0, forum_policy_1.categoryAllows)(thread.category, 'allowMentions');
            const comment = await this.prisma.forumComment.create({
                data: {
                    content: body.content,
                    user: { connect: { id: user.id } },
                    thread: { connect: { id: threadId } },
                    ...(parentId ? { parent: { connect: { id: parentId } } } : {}),
                },
                include: {
                    user: { select: COMMENT_AUTHOR },
                },
            });
            await this.prisma.forumThread.update({
                where: { id: threadId },
                data: { lastActivityAt: new Date() },
            });
            const mentionedIds = await (0, forum_mention_notify_1.notifyForumMentions)({
                prisma: this.prisma,
                notifications: this.notificationService,
                actor: {
                    id: user.id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                },
                content: body.content,
                threadId,
                threadTitle,
                allowMentions,
                sourceKey: `comment:${comment.id}`,
                commentId: comment.id,
            });
            const skipIds = new Set([user.id, ...mentionedIds]);
            const subscribedUsers = await this.prisma.threadSubscription.findMany({
                where: {
                    threadId,
                    userId: { notIn: [...skipIds] },
                },
                select: { userId: true },
            });
            const followerIds = new Set(subscribedUsers.map((row) => row.userId));
            if (thread.userId && !skipIds.has(thread.userId)) {
                followerIds.add(thread.userId);
            }
            const parentRecipient = parentAuthorId && !skipIds.has(parentAuthorId) ? parentAuthorId : null;
            if (parentRecipient)
                followerIds.delete(parentRecipient);
            const excerpt = buildExcerpt(body.content ?? '');
            const commenterName = `${user.firstName} ${user.lastName}`.trim();
            const commentPayload = {
                threadId,
                threadTitle,
                commentId: comment.id,
                commentExcerpt: excerpt,
                commenterFirstName: user.firstName,
                commenterLastName: user.lastName,
            };
            await this.notificationService.createNotificationForMany({
                userIds: [...followerIds],
                emailCcAddresses: [mail_layout_1.ADMIN_EMAIL],
                type: client_1.NotificationType.FORUM_COMMENT,
                message: body.content,
                payload: commentPayload,
                groupKey: `forum-comment:${threadId}`,
                threadId,
                commenterId: user.id,
                dedupeKeyFor: (recipientId) => `comment:${comment.id}:${recipientId}`,
                email: {
                    excludeUserId: user.id,
                    build: (r) => ({
                        kind: 'FORUM_COMMENT',
                        to: r.email,
                        userId: r.id,
                        recipientFirstName: r.firstName,
                        threadId,
                        threadTitle,
                        commenterName,
                        excerpt,
                    }),
                },
            });
            if (parentRecipient) {
                await this.notificationService.createNotificationForMany({
                    userIds: [parentRecipient],
                    type: client_1.NotificationType.FORUM_COMMENT,
                    message: `${commenterName} replied to your comment in ${threadTitle}`,
                    payload: {
                        ...commentPayload,
                        parentCommentId: parentId,
                    },
                    groupKey: `forum-comment:${threadId}`,
                    threadId,
                    commenterId: user.id,
                    dedupeKeyFor: (recipientId) => `comment:${comment.id}:${recipientId}`,
                    email: {
                        excludeUserId: user.id,
                        build: (r) => ({
                            kind: 'FORUM_COMMENT',
                            to: r.email,
                            userId: r.id,
                            recipientFirstName: r.firstName,
                            threadId,
                            threadTitle,
                            commenterName,
                            excerpt,
                            directReply: true,
                        }),
                    },
                });
            }
            return {
                message: 'Successfully create quiz record',
                statusCode: 200,
                data: {
                    ...comment,
                    parentId: comment.parentId ?? null,
                    isVotedByMe: false,
                    replies: parentId ? undefined : [],
                },
            };
        }
        catch (error) {
            throw this.wrap(error);
        }
    }
    async getForumCommentsByThreadId(threadId, user, sort) {
        const rows = await (0, with_db_retry_1.withDbRetry)(() => this.prisma.$queryRaw `
        SELECT
          c.id,
          c.content,
          c."parentId",
          c."voteScore",
          c."isAccepted",
          c."createdAt",
          c."threadId",
          u.id AS "userId",
          u."firstName",
          u."lastName",
          u.photo,
          u.role::text AS role,
          EXISTS (
            SELECT 1
            FROM "forum_votes" v
            WHERE v."commentId" = c.id
              AND v."userId" = ${user.id}
          ) AS "isVotedByMe"
        FROM "forum_comments" c
        INNER JOIN "users" u ON u.id = c."userId"
        WHERE c."threadId" = ${threadId}
      `);
        const comments = rows.map((row) => ({
            id: row.id,
            content: row.content,
            parentId: row.parentId,
            voteScore: Number(row.voteScore ?? 0),
            isAccepted: Boolean(row.isAccepted),
            createdAt: row.createdAt,
            threadId: row.threadId,
            isVotedByMe: Boolean(row.isVotedByMe),
            user: {
                id: row.userId,
                firstName: row.firstName,
                lastName: row.lastName,
                photo: row.photo,
                role: row.role,
            },
        }));
        return {
            message: 'Successfully fetch all forum comments',
            statusCode: 200,
            data: (0, forum_comment_tree_1.nestForumComments)(comments, sort),
        };
    }
    async voteForumComment(commentId, body, user) {
        try {
            const value = (0, forum_vote_1.parseVoteValue)(body);
            const result = await (0, forum_vote_1.toggleForumVote)(this.prisma, {
                userId: user.id,
                commentId,
                value,
            });
            return {
                message: value === 1 ? 'Liked comment' : 'Removed like',
                statusCode: 200,
                data: result,
            };
        }
        catch (error) {
            throw this.wrap(error);
        }
    }
    async acceptForumComment(commentId, user, body) {
        try {
            const comment = await this.prisma.forumComment.findUnique({
                where: { id: commentId },
                select: {
                    id: true,
                    isAccepted: true,
                    threadId: true,
                    parentId: true,
                    userId: true,
                    thread: {
                        select: {
                            userId: true,
                            title: true,
                            acceptedCommentId: true,
                            category: { select: { allowAcceptedAnswer: true } },
                        },
                    },
                },
            });
            if (!comment)
                throw new Error('Forum comment not found');
            if (comment.parentId) {
                throw new Error('Only top-level replies can be marked as the solution');
            }
            if (!(0, forum_policy_1.isAdminRole)(user.role) &&
                comment.thread.userId !== user.id) {
                throw new Error('Only the thread author or an admin can accept an answer');
            }
            if (!(0, forum_policy_1.categoryAllows)(comment.thread.category, 'allowAcceptedAnswer')) {
                throw new Error('Accepted answers are not enabled for this category');
            }
            const shouldAccept = body?.accepted !== undefined
                ? Boolean(body.accepted)
                : comment.thread.acceptedCommentId !== comment.id;
            const becameAccepted = shouldAccept && comment.thread.acceptedCommentId !== comment.id;
            if (shouldAccept) {
                if (comment.thread.acceptedCommentId &&
                    comment.thread.acceptedCommentId !== comment.id) {
                    await this.prisma.forumComment.update({
                        where: { id: comment.thread.acceptedCommentId },
                        data: { isAccepted: false },
                    });
                }
                await this.prisma.forumComment.update({
                    where: { id: comment.id },
                    data: { isAccepted: true },
                });
                await this.prisma.forumThread.update({
                    where: { id: comment.threadId },
                    data: { acceptedCommentId: comment.id },
                });
            }
            else {
                await this.prisma.forumComment.update({
                    where: { id: comment.id },
                    data: { isAccepted: false },
                });
                await this.prisma.forumThread.update({
                    where: { id: comment.threadId },
                    data: { acceptedCommentId: null },
                });
            }
            if (becameAccepted) {
                const threadTitle = comment.thread.title;
                const payload = {
                    threadId: comment.threadId,
                    threadTitle,
                    commentId: comment.id,
                };
                const authorId = comment.userId !== user.id ? comment.userId : null;
                const opId = comment.thread.userId !== user.id &&
                    comment.thread.userId !== comment.userId
                    ? comment.thread.userId
                    : null;
                if (authorId) {
                    await this.notificationService.createNotificationForMany({
                        userIds: [authorId],
                        type: client_1.NotificationType.FORUM_ANSWER_ACCEPTED,
                        message: `Your reply was marked as the solution in ${threadTitle}`,
                        payload,
                        threadId: comment.threadId,
                        commenterId: user.id,
                        dedupeKeyFor: (id) => `accepted:${comment.id}:${id}`,
                        email: {
                            excludeUserId: user.id,
                            build: (r) => ({
                                kind: 'FORUM_ANSWER_ACCEPTED',
                                to: r.email,
                                userId: r.id,
                                recipientFirstName: r.firstName,
                                threadId: comment.threadId,
                                threadTitle,
                                yours: true,
                            }),
                        },
                    });
                }
                if (opId) {
                    await this.notificationService.createNotificationForMany({
                        userIds: [opId],
                        type: client_1.NotificationType.FORUM_ANSWER_ACCEPTED,
                        message: `A reply was marked as the solution in ${threadTitle}`,
                        payload,
                        threadId: comment.threadId,
                        commenterId: user.id,
                        dedupeKeyFor: (id) => `accepted:${comment.id}:${id}`,
                        email: {
                            excludeUserId: user.id,
                            build: (r) => ({
                                kind: 'FORUM_ANSWER_ACCEPTED',
                                to: r.email,
                                userId: r.id,
                                recipientFirstName: r.firstName,
                                threadId: comment.threadId,
                                threadTitle,
                                yours: false,
                            }),
                        },
                    });
                }
            }
            return {
                message: shouldAccept ? 'Marked as solution' : 'Cleared solution',
                statusCode: 200,
                data: {
                    acceptedCommentId: shouldAccept ? comment.id : null,
                    isAccepted: shouldAccept,
                },
            };
        }
        catch (error) {
            throw this.wrap(error);
        }
    }
    async getAllForumThreads() {
        try {
            const forums = await this.prisma.forumThread.findMany({
                orderBy: {
                    createdAt: 'desc',
                },
                include: {
                    user: { select: COMMENT_AUTHOR },
                },
            });
            return {
                message: 'Successfully fetch all forum threads',
                statusCode: 200,
                data: forums,
            };
        }
        catch (error) {
            throw this.wrap(error);
        }
    }
    async updateForumThreadComment(commentId, body, user) {
        try {
            const existing = await this.prisma.forumComment.findUnique({
                where: { id: commentId },
            });
            if (!existing) {
                throw new Error('Forum comment not found');
            }
            if (!(0, forum_policy_1.isAdminRole)(user.role) && existing.userId !== user.id) {
                throw new Error('You can only edit your own comment');
            }
            if (body?.content == null || String(body.content).length === 0) {
                throw new Error('content is required');
            }
            (0, forum_reply_words_1.assertForumReplyWordLimit)(String(body.content));
            const updated = await this.prisma.forumComment.update({
                where: { id: commentId },
                data: { content: body.content },
                include: { user: { select: COMMENT_AUTHOR } },
            });
            return {
                message: 'Successfully updated forum record',
                statusCode: 200,
                data: updated,
            };
        }
        catch (error) {
            throw this.wrap(error);
        }
    }
    async deleteForumThreadComment(commentId, user) {
        try {
            const existing = await this.prisma.forumComment.findUnique({
                where: { id: commentId },
            });
            if (!existing) {
                throw new Error('Forum comment not found');
            }
            if (!(0, forum_policy_1.isAdminRole)(user.role) && existing.userId !== user.id) {
                throw new Error('You can only delete your own comment');
            }
            await this.prisma.forumComment.delete({
                where: { id: commentId },
            });
            return {
                message: 'Successfully deleted forum thread comment record',
                statusCode: 200,
                data: {},
            };
        }
        catch (error) {
            throw this.wrap(error);
        }
    }
    async getForumThread(forumThreadId) {
        try {
            const forum = await this.prisma.forumThread.findUnique({
                where: { id: forumThreadId },
                include: {
                    user: { select: COMMENT_AUTHOR },
                },
            });
            return {
                message: 'Successfully fetch Quiz info',
                statusCode: 200,
                data: forum,
            };
        }
        catch (error) {
            throw this.wrap(error);
        }
    }
    wrap(error) {
        if (error instanceof common_1.HttpException)
            return error;
        const message = error instanceof Error ? error.message : 'Something went wrong';
        return new common_1.HttpException({
            status: common_1.HttpStatus.FORBIDDEN,
            error: message,
        }, common_1.HttpStatus.FORBIDDEN, { cause: error });
    }
};
exports.ForumCommentService = ForumCommentService;
exports.ForumCommentService = ForumCommentService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        notification_service_1.NotificationService])
], ForumCommentService);
//# sourceMappingURL=forum-comment.service.js.map