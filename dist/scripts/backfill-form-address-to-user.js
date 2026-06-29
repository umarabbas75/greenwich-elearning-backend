"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
const promote_form_address_to_user_1 = require("../src/utils/promote-form-address-to-user");
dotenv.config();
const dryRun = process.argv.includes('--dry-run');
const emailArg = process.argv.find((a) => a.startsWith('--email='));
const emailFilter = emailArg?.split('=')[1]?.trim().toLowerCase();
const datasourceUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
if (!datasourceUrl) {
    console.error('DATABASE_URL (or DIRECT_DATABASE_URL) is required');
    process.exit(1);
}
const prisma = new client_1.PrismaClient({
    datasources: { db: { url: datasourceUrl } },
});
async function main() {
    console.log(`\n🏠 Backfill form address → users.address${dryRun ? ' (DRY RUN)' : ''}\n`);
    if (emailFilter) {
        console.log(`Filter: ${emailFilter}\n`);
    }
    const users = emailFilter
        ? await prisma.user.findMany({
            where: { email: { equals: emailFilter, mode: 'insensitive' } },
            select: { id: true, email: true, address: true },
        })
        : await prisma.user.findMany({
            where: { address: null, deletedAt: null },
            select: { id: true, email: true, address: true },
        });
    const usersWithoutAddress = users.filter((u) => !(0, promote_form_address_to_user_1.userHasGlobalAddress)(u.address));
    const userIds = new Set(usersWithoutAddress.map((u) => u.id));
    const userById = new Map(usersWithoutAddress.map((u) => [u.id, u]));
    if (userIds.size === 0) {
        console.log('No users without a global address matched the filter.\n');
        return;
    }
    const completions = await prisma.userFormCompletion.findMany({
        where: {
            isComplete: true,
            userId: emailFilter ? { in: [...userIds] } : undefined,
            metadata: { not: null },
        },
        select: {
            userId: true,
            courseId: true,
            formId: true,
            completedAt: true,
            updatedAt: true,
            metadata: true,
        },
        orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }],
    });
    const bestByUser = new Map();
    for (const row of completions) {
        if (!userIds.has(row.userId)) {
            continue;
        }
        if (bestByUser.has(row.userId)) {
            continue;
        }
        const address = (0, promote_form_address_to_user_1.extractUserAddressFromMetadata)(row.metadata);
        if (!address) {
            continue;
        }
        const user = userById.get(row.userId);
        if (!user) {
            continue;
        }
        bestByUser.set(row.userId, {
            userId: row.userId,
            email: user.email,
            address,
            formId: row.formId,
            courseId: row.courseId,
            completedAt: row.completedAt,
        });
    }
    const candidates = [...bestByUser.values()].sort((a, b) => a.email.localeCompare(b.email));
    console.log(`Candidates: ${candidates.length}\n`);
    for (const c of candidates) {
        console.log(`  ${c.email} | form ${c.formId} | ${c.address.slice(0, 80)}${c.address.length > 80 ? '...' : ''}`);
    }
    if (candidates.length === 0) {
        console.log('\nNothing to backfill.\n');
        return;
    }
    if (dryRun) {
        console.log('\n(dry run — no writes)\n');
        return;
    }
    let updated = 0;
    for (const c of candidates) {
        const result = await (0, promote_form_address_to_user_1.promoteFormAddressToUserIfMissing)(prisma, c.userId, { address: c.address });
        if (result.updated) {
            updated++;
        }
    }
    console.log(`\nUpdated ${updated} user(s).\n`);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=backfill-form-address-to-user.js.map