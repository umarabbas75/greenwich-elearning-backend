import { NotificationType } from '@prisma/client';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseMentionedUserIds } from './forum-mentions';

export async function notifyForumMentions(args: {
  prisma: PrismaService;
  notifications: NotificationService;
  actor: { id: string; firstName: string; lastName: string };
  content: string;
  threadId: string;
  threadTitle: string;
  allowMentions: boolean;
  /** Stable id so the same mention isn't emailed twice. */
  sourceKey: string;
  commentId?: string;
  excludeUserIds?: string[];
}): Promise<string[]> {
  if (!args.allowMentions) return [];
  const ids = parseMentionedUserIds(args.content).filter(
    (id) => id !== args.actor.id && !(args.excludeUserIds ?? []).includes(id),
  );
  if (ids.length === 0) return [];

  const users = await args.prisma.user.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) return [];

  const actorName = `${args.actor.firstName} ${args.actor.lastName}`.trim();
  await args.notifications.createNotificationForMany({
    userIds,
    type: NotificationType.FORUM_MENTION,
    message: `${actorName} mentioned you in ${args.threadTitle}`,
    payload: {
      threadId: args.threadId,
      threadTitle: args.threadTitle,
      ...(args.commentId ? { commentId: args.commentId } : {}),
      mentionerFirstName: args.actor.firstName,
      mentionerLastName: args.actor.lastName,
    },
    groupKey: `forum-mention:${args.threadId}`,
    threadId: args.threadId,
    commenterId: args.actor.id,
    dedupeKeyFor: (recipientId) =>
      `mention:${args.sourceKey}:${recipientId}`,
    email: {
      excludeUserId: args.actor.id,
      build: (r) => ({
        kind: 'FORUM_MENTION',
        to: r.email,
        userId: r.id,
        recipientFirstName: r.firstName,
        threadId: args.threadId,
        threadTitle: args.threadTitle,
        mentionerName: actorName,
      }),
    },
  });
  return userIds;
}
