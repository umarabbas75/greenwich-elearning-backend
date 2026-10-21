"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeAdminAudit = void 0;
const common_1 = require("@nestjs/common");
const logger = new common_1.Logger('AdminAuditLog');
async function writeAdminAudit(client, entry) {
    try {
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
                metadata: entry.metadata ?? undefined,
            },
        });
    }
    catch (err) {
        logger.warn(`AdminAuditLog write failed (${entry.action}, target=${entry.targetType}:${entry.targetId ?? '-'}, course=${entry.courseId ?? '-'}, user=${entry.userId ?? '-'}): ${err instanceof Error ? err.message : String(err)}`);
    }
}
exports.writeAdminAudit = writeAdminAudit;
//# sourceMappingURL=admin-audit.js.map