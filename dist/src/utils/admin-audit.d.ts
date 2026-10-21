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
export declare function writeAdminAudit(client: Pick<Prisma.TransactionClient, 'user' | 'adminAuditLog'>, entry: AdminAuditEntry): Promise<void>;
