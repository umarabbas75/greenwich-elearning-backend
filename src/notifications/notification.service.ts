import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type NotificationListFilter = 'all' | 'unread';

export interface NotificationListParams {
  cursor?: string;
  limit?: number;
  filter?: NotificationListFilter;
  type?: NotificationType;
}

interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  message: string;
  payload?: Prisma.InputJsonValue | null;
  groupKey?: string | null;
  dedupeKey?: string | null;
  referenceId?: string | null;
  threadId?: string | null;
  commenterId?: string | null;
}

interface BulkCreateNotificationInput
  extends Omit<CreateNotificationInput, 'userId'> {
  userIds: string[];
  // dedupeKey may be a function of userId for per-recipient idempotency
  dedupeKeyFor?: (userId: string) => string | null;
}

const NOTIFICATION_INCLUDE = {
  thread: { select: { title: true } },
  commenter: {
    select: { id: true, firstName: true, lastName: true, photo: true },
  },
} as const;

@Injectable()
export class NotificationService {
  private static readonly DEFAULT_LIMIT = 20;
  private static readonly MAX_LIMIT = 50;

  constructor(private prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────────────────
  // READS
  // ────────────────────────────────────────────────────────────────────────

  async listNotifications(userId: string, params: NotificationListParams) {
    const limit = Math.min(
      Math.max(params.limit ?? NotificationService.DEFAULT_LIMIT, 1),
      NotificationService.MAX_LIMIT,
    );

    const where: Prisma.NotificationWhereInput = { userId };
    if (params.filter === 'unread') where.readAt = null;
    if (params.type) where.type = params.type;

    // Cursor: keyset on (createdAt DESC, id DESC). Prisma's `cursor` works on a
    // single unique field; for stable ordering we anchor on id (unique) and
    // mirror the sort by createdAt DESC.
    const findArgs: Prisma.NotificationFindManyArgs = {
      where,
      include: NOTIFICATION_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, // fetch one extra to detect more
    };
    if (params.cursor) {
      findArgs.cursor = { id: params.cursor };
      findArgs.skip = 1; // skip the cursor row itself
    }

    // Two round-trips total: one for rows, one for both counts.
    // Pool size is 1 (Neon serverless), so $transaction([]) deadlocks and
    // independent awaits can't be parallelized. Collapsing the two counts
    // into a single COUNT(*) FILTER (...) statement is the only win.
    const rows = await this.prisma.notification.findMany(findArgs);
    const [counts] = await this.prisma.$queryRaw<
      { unread: bigint; unseen: bigint }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE "readAt" IS NULL) AS unread,
        COUNT(*) FILTER (WHERE "seenAt" IS NULL) AS unseen
      FROM "notifications"
      WHERE "userId" = ${userId}
    `;

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return {
      message: 'Notifications fetched successfully',
      statusCode: 200,
      data: {
        data,
        nextCursor,
        unreadCount: Number(counts.unread),
        unseenCount: Number(counts.unseen),
      },
    };
  }

  async getCounts(userId: string) {
    // Single round-trip: both counts in one COUNT(*) FILTER (...) statement.
    const [counts] = await this.prisma.$queryRaw<
      { unread: bigint; unseen: bigint }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE "readAt" IS NULL) AS unread,
        COUNT(*) FILTER (WHERE "seenAt" IS NULL) AS unseen
      FROM "notifications"
      WHERE "userId" = ${userId}
    `;
    return {
      message: 'Counts fetched successfully',
      statusCode: 200,
      data: {
        unread: Number(counts.unread),
        unseen: Number(counts.unseen),
      },
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // MUTATIONS
  // ────────────────────────────────────────────────────────────────────────

  async markOneAsRead(notificationId: string, userId: string) {
    const now = new Date();
    // Update only if it belongs to caller AND isn't already read. We also need
    // seenAt to backfill if it was unseen — single statement via raw SQL keeps
    // the COALESCE semantics atomic.
    const result = await this.prisma.$executeRaw`
      UPDATE "notifications"
         SET "readAt" = ${now},
             "seenAt" = COALESCE("seenAt", ${now}),
             "updatedAt" = ${now}
       WHERE "id" = ${notificationId}
         AND "userId" = ${userId}
    `;

    if (result === 0) {
      throw new HttpException(
        { status: HttpStatus.NOT_FOUND, error: 'Notification not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      message: 'Notification marked as read successfully',
      statusCode: 200,
      data: {
        id: notificationId,
        readAt: now.toISOString(),
        seenAt: now.toISOString(),
      },
    };
  }

  async markAllAsRead(userId: string) {
    const now = new Date();
    const updated = await this.prisma.$executeRaw`
      UPDATE "notifications"
         SET "readAt" = ${now},
             "seenAt" = COALESCE("seenAt", ${now}),
             "updatedAt" = ${now}
       WHERE "userId" = ${userId}
         AND "readAt" IS NULL
    `;
    return {
      message: 'All notifications marked as read',
      statusCode: 200,
      data: { updated },
    };
  }

  async markAllAsSeen(userId: string) {
    const now = new Date();
    const result = await this.prisma.notification.updateMany({
      where: { userId, seenAt: null },
      data: { seenAt: now },
    });
    return {
      message: 'All notifications marked as seen',
      statusCode: 200,
      data: { updated: result.count },
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // WRITES (trigger sites use these)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Single-recipient notification with `ON CONFLICT (userId, dedupeKey) DO NOTHING`
   * semantics when dedupeKey is set. Prisma's `create` can't express partial-unique
   * conflict skipping, so we use createMany({ skipDuplicates: true }) which honors
   * the partial unique index we added in migration.
   */
  async createNotification(input: CreateNotificationInput): Promise<void> {
    await this.prisma.notification.createMany({
      data: [
        {
          userId: input.userId,
          type: input.type,
          message: input.message,
          payload: input.payload ?? undefined,
          groupKey: input.groupKey ?? null,
          dedupeKey: input.dedupeKey ?? null,
          referenceId: input.referenceId ?? null,
          threadId: input.threadId ?? null,
          commenterId: input.commenterId ?? null,
        },
      ],
      skipDuplicates: true,
    });
  }

  /**
   * Fan-out to many recipients in one statement. dedupeKey is derived per-user
   * via the optional `dedupeKeyFor` callback (e.g. `comment:<commentId>:<userId>`).
   */
  async createNotificationForMany(
    input: BulkCreateNotificationInput,
  ): Promise<void> {
    if (input.userIds.length === 0) return;
    await this.prisma.notification.createMany({
      data: input.userIds.map((userId) => ({
        userId,
        type: input.type,
        message: input.message,
        payload: input.payload ?? undefined,
        groupKey: input.groupKey ?? null,
        dedupeKey: input.dedupeKeyFor ? input.dedupeKeyFor(userId) : null,
        referenceId: input.referenceId ?? null,
        threadId: input.threadId ?? null,
        commenterId: input.commenterId ?? null,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Broadcast a new-thread notification to every user. Called by
   * forum-thread.service.ts when an admin activates a thread. Per-recipient
   * dedupeKey ensures idempotency if the activation runs twice.
   */
  async notifyAllUsersForNewThread(args: {
    threadId: string;
    threadTitle: string;
    courseId?: string | null;
    creator: { id: string; firstName: string; lastName: string };
  }): Promise<void> {
    // Course-scoped threads notify only enrolled users; legacy global
    // threads (no courseId) still fan out to everyone.
    const users = await this.prisma.user.findMany({
      where: args.courseId
        ? { UserCourse: { some: { courseId: args.courseId, isActive: true } } }
        : undefined,
      select: { id: true },
    });
    await this.createNotificationForMany({
      userIds: users.map((u) => u.id),
      type: NotificationType.FORUM_THREAD,
      message: 'A new thread has been created by the admin.',
      payload: {
        threadId: args.threadId,
        threadTitle: args.threadTitle,
        creatorFirstName: args.creator.firstName,
        creatorLastName: args.creator.lastName,
      },
      groupKey: null,
      threadId: args.threadId,
      commenterId: args.creator.id,
      dedupeKeyFor: (userId) => `thread-created:${args.threadId}:${userId}`,
    });
  }
}
