import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationEmail } from '../mail/mail.types';
import { ADMIN_EMAIL } from '../mail/templates/mail-layout';

type NotificationListFilter = 'all' | 'unread';

export interface NotificationListParams {
  cursor?: string;
  limit?: number;
  filter?: NotificationListFilter;
  type?: NotificationType;
}

/**
 * Optional "also email this notification" directive. Given a resolved recipient
 * (id, email, firstName), `build` returns the NotificationEmail to send — or
 * null to skip emailing that particular recipient. Returning null lets callers
 * suppress e.g. recipients with no email. The service additionally skips the
 * actor (excludeUserId) and recipients suppressed by notification dedupe.
 */
interface NotificationEmailDirective {
  excludeUserId?: string | null;
  build: (recipient: {
    id: string;
    email: string;
    firstName: string;
  }) => NotificationEmail | null;
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
  email?: NotificationEmailDirective | null;
}

interface BulkCreateNotificationInput
  extends Omit<CreateNotificationInput, 'userId'> {
  userIds: string[];
  // dedupeKey may be a function of userId for per-recipient idempotency
  dedupeKeyFor?: (userId: string) => string | null;
  /**
   * Extra raw email addresses that receive only the EMAIL mirror — no in-app
   * notification row. Used to CC the fixed admin inbox on forum activity for
   * oversight without polluting any notification bell or bypassing the in-app
   * course-scoping of userIds. Always emailed (no notification row to dedupe on).
   */
  emailCcAddresses?: string[];
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
  private static readonly logger = new Logger(NotificationService.name);
  /** Resend allows ~2 req/s; send notification emails in small throttled batches. */
  private static readonly EMAIL_BATCH = 2;
  private static readonly EMAIL_BATCH_PAUSE_MS = 1100;

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

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
    const result = await this.prisma.notification.createMany({
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

    // Email only if the row was actually inserted (not a dedupe no-op) and an
    // email directive was supplied. Best-effort — never throws into the caller.
    if (input.email && result.count > 0) {
      await this.dispatchNotificationEmails([input.userId], input.email);
    }
  }

  /**
   * Fan-out to many recipients in one statement. dedupeKey is derived per-user
   * via the optional `dedupeKeyFor` callback (e.g. `comment:<commentId>:<userId>`).
   */
  async createNotificationForMany(
    input: BulkCreateNotificationInput,
  ): Promise<void> {
    if (input.userIds.length === 0) return;
    const result = await this.prisma.notification.createMany({
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

    if (!input.email) return;

    // In-app recipients to email: only those whose row was freshly inserted this
    // call (not a dedupe no-op). When a dedupeKey is provided we identify the new
    // rows by re-reading those keys; without one we conservatively email all
    // (no idempotency guarantee — documented on the input).
    let recipients: string[] = result.count > 0 ? input.userIds : [];
    if (result.count > 0 && input.dedupeKeyFor) {
      const keys = input.userIds
        .map((u) => input.dedupeKeyFor!(u))
        .filter((k): k is string => !!k);
      if (keys.length > 0) {
        const fresh = await this.prisma.notification.findMany({
          where: {
            dedupeKey: { in: keys },
            createdAt: { gte: new Date(Date.now() - 5 * 60_000) },
          },
          select: { userId: true },
        });
        const freshIds = new Set(fresh.map((r) => r.userId));
        recipients = input.userIds.filter((u) => freshIds.has(u));
      }
    }

    // In-app recipients are resolved to emails by user id; CC addresses (the
    // fixed admin inbox) are emailed directly. Both via the throttled dispatch.
    if (recipients.length === 0 && !input.emailCcAddresses?.length) return;
    await this.dispatchNotificationEmails(
      recipients,
      input.email,
      input.emailCcAddresses,
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // EMAIL DISPATCH (best-effort mirror of in-app notifications)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Resolves recipient emails and sends the notification mirror email, skipping
   * the actor, soft-deleted users, and anyone the directive returns null for.
   * Throttled to stay under Resend's rate limit. Best-effort: any failure is
   * logged and swallowed so it never affects the in-app notification write.
   */
  private async dispatchNotificationEmails(
    userIds: string[],
    directive: NotificationEmailDirective,
    ccAddresses: string[] = [],
  ): Promise<void> {
    try {
      const targets = userIds.filter(
        (id) => id && id !== directive.excludeUserId,
      );

      const users = targets.length
        ? await this.prisma.user.findMany({
            where: { id: { in: targets }, deletedAt: null },
            select: { id: true, email: true, firstName: true },
          })
        : [];

      const emails = users
        .map((u) =>
          u.email
            ? directive.build({
                id: u.id,
                email: u.email,
                firstName: u.firstName ?? '',
              })
            : null,
        )
        .filter((m): m is NotificationEmail => m !== null);

      // Raw CC addresses (e.g. the fixed admin inbox): no user record, so build
      // with empty id/firstName. De-duplicated against already-resolved emails.
      const resolvedTo = new Set(emails.map((m) => m.to));
      for (const addr of new Set(ccAddresses)) {
        if (!addr || resolvedTo.has(addr)) continue;
        const built = directive.build({ id: '', email: addr, firstName: '' });
        if (built) emails.push(built);
      }

      if (emails.length === 0) return;

      for (let i = 0; i < emails.length; i += NotificationService.EMAIL_BATCH) {
        const batch = emails.slice(i, i + NotificationService.EMAIL_BATCH);
        await Promise.all(batch.map((m) => this.mail.sendNotificationEmail(m)));
        if (i + NotificationService.EMAIL_BATCH < emails.length) {
          await new Promise((r) =>
            setTimeout(r, NotificationService.EMAIL_BATCH_PAUSE_MS),
          );
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      NotificationService.logger.warn(
        `Notification email dispatch failed (best-effort): ${message}`,
      );
    }
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
    // Course-scoped threads notify only enrolled users (in-app); legacy global
    // threads (no courseId) still fan out to everyone. The admin inbox is CC'd
    // by EMAIL only — no in-app row — preserving the course-scoped bell.
    const users = await this.prisma.user.findMany({
      where: args.courseId
        ? {
            UserCourse: { some: { courseId: args.courseId, isActive: true } },
          }
        : undefined,
      select: { id: true },
    });

    const creatorName =
      `${args.creator.firstName} ${args.creator.lastName}`.trim();
    await this.createNotificationForMany({
      userIds: users.map((u) => u.id),
      emailCcAddresses: [ADMIN_EMAIL],
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
      email: {
        excludeUserId: args.creator.id, // don't email the creator about their own thread
        build: (r) => ({
          kind: 'FORUM_THREAD',
          to: r.email,
          userId: r.id,
          recipientFirstName: r.firstName,
          threadId: args.threadId,
          threadTitle: args.threadTitle,
          creatorName,
        }),
      },
    });
  }
}
