"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
const promote_form_photo_to_user_1 = require("../src/utils/promote-form-photo-to-user");
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
    console.log(`\n📷 Backfill form userPhoto → users.photo${dryRun ? ' (DRY RUN)' : ''}\n`);
    if (emailFilter) {
        console.log(`Filter: ${emailFilter}\n`);
    }
    const users = emailFilter
        ? await prisma.user.findMany({
            where: { email: { equals: emailFilter, mode: 'insensitive' } },
            select: { id: true, email: true, photo: true },
        })
        : await prisma.user.findMany({
            where: { photo: null, deletedAt: null },
            select: { id: true, email: true, photo: true },
        });
    const usersWithoutPhoto = users.filter((u) => !(0, promote_form_photo_to_user_1.userHasGlobalPhoto)(u.photo));
    const userIds = new Set(usersWithoutPhoto.map((u) => u.id));
    const userById = new Map(usersWithoutPhoto.map((u) => [u.id, u]));
    if (userIds.size === 0) {
        console.log('No users without a global photo matched the filter.\n');
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
        const photoUrl = (0, promote_form_photo_to_user_1.extractUserPhotoFromMetadata)(row.metadata);
        if (!photoUrl) {
            continue;
        }
        const user = userById.get(row.userId);
        if (!user) {
            continue;
        }
        bestByUser.set(row.userId, {
            userId: row.userId,
            email: user.email,
            photoUrl,
            formId: row.formId,
            courseId: row.courseId,
            completedAt: row.completedAt,
        });
    }
    const candidates = [...bestByUser.values()].sort((a, b) => a.email.localeCompare(b.email));
    console.log(`Candidates: ${candidates.length}\n`);
    for (const c of candidates) {
        console.log(`  ${c.email} | form ${c.formId} | ${c.photoUrl.slice(0, 60)}...`);
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
        const result = await (0, promote_form_photo_to_user_1.promoteFormPhotoToUserIfMissing)(prisma, c.userId, { userPhoto: c.photoUrl });
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
//# sourceMappingURL=backfill-form-photo-to-user.js.map