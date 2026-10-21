import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type AdminAuditEntry = {
  adminId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  courseId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown> | null;
};

const logger = new Logger('AdminAuditLog');

/**
 * Records who did what in AdminAuditLog. Every admin action that changes the
 * rules or records of learners who already have state must call this, so the
 * next incident can be attributed. Best-effort: a failed write is logged and
 * swallowed rather than thrown.
 *
 * Shared by any service with Prisma access; CourseVersionService.writeAudit
 * delegates here. Prefer calling it after the business transaction commits.
 * Passing a transaction client ties the two together: a failed insert aborts
 * that Postgres transaction even though the error is caught here, so the
 * business change rolls back with it. Only do that on purpose.
 */
export async function writeAdminAudit(
  client: Pick<Prisma.TransactionClient, 'user' | 'adminAuditLog'>,
  entry: AdminAuditEntry,
): Promise<void> {
  try {
    // Denormalise the actor's email at write time so the audit row remains
    // attributable if the admin is later hard-deleted (adminId → null via
    // ON DELETE SET NULL).
    const actor = await client.user.findUnique({
      where: { id: entry.adminId },
      select: { email: true },
    });
    await client.adminAuditLog.create({
      data: {
        adminId: entry.adminId,
        adminEmail: actor?.email ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        courseId: entry.courseId ?? null,
        userId: entry.userId ?? null,
        metadata: (entry.metadata as Prisma.InputJsonValue) ?? undefined,
      },
    });
  } catch (err) {
    logger.warn(
      `AdminAuditLog write failed (${entry.action}, target=${
        entry.targetType
      }:${entry.targetId ?? '-'}, course=${entry.courseId ?? '-'}, user=${
        entry.userId ?? '-'
      }): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
