"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyForumMentions = void 0;
const client_1 = require("@prisma/client");
const forum_mentions_1 = require("./forum-mentions");
async function notifyForumMentions(args) {
    if (!args.allowMentions)
        return [];
    const ids = (0, forum_mentions_1.parseMentionedUserIds)(args.content).filter((id) => id !== args.actor.id && !(args.excludeUserIds ?? []).includes(id));
    if (ids.length === 0)
        return [];
    const users = await args.prisma.user.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    if (userIds.length === 0)
        return [];
    const actorName = `${args.actor.firstName} ${args.actor.lastName}`.trim();
    await args.notifications.createNotificationForMany({
        userIds,
        type: client_1.NotificationType.FORUM_MENTION,
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
        dedupeKeyFor: (recipientId) => `mention:${args.sourceKey}:${recipientId}`,
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
exports.notifyForumMentions = notifyForumMentions;
//# sourceMappingURL=forum-mention-notify.js.map