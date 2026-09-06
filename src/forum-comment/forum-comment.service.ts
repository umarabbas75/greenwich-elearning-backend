import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { NotificationType, Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { ADMIN_EMAIL } from '../mail/templates/mail-layout';
import {
  categoryAllows,
  isAdminRole,
} from '../forum-thread/forum-policy';
import { notifyForumMentions } from '../forum-thread/forum-mention-notify';
import {
  parseVoteValue,
  toggleForumVote,
  withVotedByMe,
} from '../forum-thread/forum-vote';

/** Truncate to N chars after stripping HTML-ish tags. Cheap defensive scrub
 * — comment content is plain text today but this protects against future
 * rich-text edits leaking markup into notification payloads. */
function buildExcerpt(content: string, maxLen = 140): string {
  return content.replace(/<[^>]*>/g, '').slice(0, maxLen);
}

const COMMENT_AUTHOR = {
  id: true,
  firstName: true,
  lastName: true,
  photo: true,
  role: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class ForumCommentService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  async createForumThreadComment(body: any, user: User): Promise<any> {
    try {
      const thread = await this.prisma.forumThread.findUnique({
        where: { id: body?.threadId },
        select: {
          id: true,
          title: true,
          category: {
            select: { allowMentions: true },
          },
        },
      });
      if (!thread) throw new Error('Forum thread not found');
      if (!body?.content) throw new Error('content is required');

      const comment = await this.prisma.forumComment.create({
        data: {
          content: body.content,
          user: { connect: { id: user.id } },
          thread: { connect: { id: body.threadId } },
        },
        include: {
          user: { select: COMMENT_AUTHOR },
        },
      });

      await this.prisma.forumThread.update({
        where: { id: body.threadId },
        data: { lastActivityAt: new Date() },
      });

      const mentionedIds = await notifyForumMentions({
        prisma: this.prisma,
        notifications: this.notificationService,
        actor: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        content: body.content,
        threadId: thread.id,
        threadTitle: thread.title,
        allowMentions: categoryAllows(thread.category, 'allowMentions'),
        sourceKey: `comment:${comment.id}`,
        commentId: comment.id,
      });

      const subscribedUsers = await this.prisma.threadSubscription.findMany({
        where: {
          threadId: body.threadId,
          userId: { notIn: [user.id, ...mentionedIds] },
        },
        select: { userId: true },
      });

      const excerpt = buildExcerpt(body.content ?? '');
      const commenterName = `${user.firstName} ${user.lastName}`.trim();
      await this.notificationService.createNotificationForMany({
        userIds: subscribedUsers.map((s) => s.userId),
        emailCcAddresses: [ADMIN_EMAIL],
        type: NotificationType.FORUM_COMMENT,
        message: body.content,
        payload: {
          threadId: thread.id,
          threadTitle: thread.title,
          commentId: comment.id,
          commentExcerpt: excerpt,
          commenterFirstName: user.firstName,
          commenterLastName: user.lastName,
        },
        groupKey: `forum-comment:${thread.id}`,
        threadId: thread.id,
        commenterId: user.id,
        dedupeKeyFor: (recipientId) => `comment:${comment.id}:${recipientId}`,
        email: {
          excludeUserId: user.id,
          build: (r) => ({
            kind: 'FORUM_COMMENT',
            to: r.email,
            userId: r.id,
            recipientFirstName: r.firstName,
            threadId: thread.id,
            threadTitle: thread.title,
            commenterName,
            excerpt,
          }),
        },
      });

      return {
        message: 'Successfully create quiz record',
        statusCode: 200,
        data: { ...comment, isVotedByMe: false },
      };
    } catch (error) {
      throw this.wrap(error);
    }
  }

  async getForumCommentsByThreadId(
    threadId: string,
    user: User,
    sort?: string,
  ) {
    const comments = await this.prisma.forumComment.findMany({
      where: { threadId },
      include: {
        user: { select: COMMENT_AUTHOR },
        votes: {
          where: { userId: user.id },
          select: { id: true },
        },
      },
      orderBy:
        sort === 'latest'
          ? [{ isAccepted: 'desc' }, { createdAt: 'desc' }]
          : [
              { isAccepted: 'desc' },
              { voteScore: 'desc' },
              { createdAt: 'desc' },
            ],
    });

    return {
      message: 'Successfully fetch all forum comments',
      statusCode: 200,
      data: comments.map(withVotedByMe),
    };
  }

  async voteForumComment(commentId: string, body: unknown, user: User) {
    try {
      const value = parseVoteValue(body);
      const result = await toggleForumVote(this.prisma, {
        userId: user.id,
        commentId,
        value,
      });

      return {
        message: value === 1 ? 'Liked comment' : 'Removed like',
        statusCode: 200,
        data: result,
      };
    } catch (error) {
      throw this.wrap(error);
    }
  }

  async acceptForumComment(
    commentId: string,
    user: User,
    body?: { accepted?: boolean },
  ) {
    try {
      const comment = await this.prisma.forumComment.findUnique({
        where: { id: commentId },
        select: {
          id: true,
          isAccepted: true,
          threadId: true,
          thread: {
            select: {
              userId: true,
              acceptedCommentId: true,
              category: { select: { allowAcceptedAnswer: true } },
            },
          },
        },
      });
      if (!comment) throw new Error('Forum comment not found');
      if (
        !isAdminRole(user.role) &&
        comment.thread.userId !== user.id
      ) {
        throw new Error('Only the thread author or an admin can accept an answer');
      }
      if (!categoryAllows(comment.thread.category, 'allowAcceptedAnswer')) {
        throw new Error('Accepted answers are not enabled for this category');
      }

      const shouldAccept =
        body?.accepted !== undefined
          ? Boolean(body.accepted)
          : comment.thread.acceptedCommentId !== comment.id;

      if (shouldAccept) {
        if (
          comment.thread.acceptedCommentId &&
          comment.thread.acceptedCommentId !== comment.id
        ) {
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
      } else {
        await this.prisma.forumComment.update({
          where: { id: comment.id },
          data: { isAccepted: false },
        });
        await this.prisma.forumThread.update({
          where: { id: comment.threadId },
          data: { acceptedCommentId: null },
        });
      }

      return {
        message: shouldAccept ? 'Marked as solution' : 'Cleared solution',
        statusCode: 200,
        data: {
          acceptedCommentId: shouldAccept ? comment.id : null,
          isAccepted: shouldAccept,
        },
      };
    } catch (error) {
      throw this.wrap(error);
    }
  }

  async getAllForumThreads(): Promise<any> {
    try {
      const forums = await this.prisma.forumThread.findMany({
        orderBy: {
          createdAt: 'desc',
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
        message: 'Successfully fetch all forum threads',
        statusCode: 200,
        data: forums,
      };
    } catch (error) {
      throw this.wrap(error);
    }
  }

  async updateForumThreadComment(
    commentId: string,
    body: any,
    user: User,
  ): Promise<any> {
    try {
      const existing = await this.prisma.forumComment.findUnique({
        where: { id: commentId },
      });
      if (!existing) {
        throw new Error('Forum comment not found');
      }
      if (!isAdminRole(user.role) && existing.userId !== user.id) {
        throw new Error('You can only edit your own comment');
      }
      if (body?.content == null || String(body.content).length === 0) {
        throw new Error('content is required');
      }

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
    } catch (error) {
      throw this.wrap(error);
    }
  }

  async deleteForumThreadComment(commentId: string, user: User): Promise<any> {
    try {
      const existing = await this.prisma.forumComment.findUnique({
        where: { id: commentId },
      });
      if (!existing) {
        throw new Error('Forum comment not found');
      }
      if (!isAdminRole(user.role) && existing.userId !== user.id) {
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
    } catch (error) {
      throw this.wrap(error);
    }
  }

  async getForumThread(forumThreadId: any): Promise<any> {
    try {
      const forum = await this.prisma.forumThread.findUnique({
        where: { id: forumThreadId },
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
        message: 'Successfully fetch Quiz info',
        statusCode: 200,
        data: forum,
      };
    } catch (error) {
      throw this.wrap(error);
    }
  }

  private wrap(error: unknown) {
    if (error instanceof HttpException) return error;
    const message =
      error instanceof Error ? error.message : 'Something went wrong';
    return new HttpException(
      {
        status: HttpStatus.FORBIDDEN,
        error: message,
      },
      HttpStatus.FORBIDDEN,
      { cause: error },
    );
  }
}
