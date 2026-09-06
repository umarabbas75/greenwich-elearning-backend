"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
dotenv.config();
const apply = process.argv.includes('--apply');
const datasourceUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
if (!datasourceUrl) {
    console.error('DATABASE_URL (or DIRECT_DATABASE_URL) is required');
    process.exit(1);
}
const prisma = new client_1.PrismaClient({
    datasources: { db: { url: datasourceUrl } },
});
async function studyCategory() {
    const required = await prisma.forumCategory.findMany({
        where: { courseScope: client_1.ForumCourseScope.REQUIRED, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, slug: true },
    });
    return required.find((row) => row.slug === 'study') ?? required[0] ?? null;
}
async function main() {
    console.log(`\nMigrate in-course posts → Community Study${apply ? '' : ' (DRY RUN)'}\n`);
    const category = await studyCategory();
    if (!category) {
        console.error('No active category with courseScope=REQUIRED. Wave 1 Study board is missing.');
        process.exit(1);
    }
    console.log(`Target board: ${category.name} (${category.slug}) ${category.id}\n`);
    const already = await prisma.forumThread.findMany({
        where: { sourcePostId: { not: null } },
        select: { sourcePostId: true },
    });
    const migrated = new Set(already.map((row) => row.sourcePostId).filter((id) => !!id));
    const posts = await prisma.post.findMany({
        include: {
            comments: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
    });
    let created = 0;
    let skipped = 0;
    for (const post of posts) {
        if (migrated.has(post.id)) {
            skipped += 1;
            continue;
        }
        const lastActivityAt = post.comments[post.comments.length - 1]?.createdAt ?? post.updatedAt;
        console.log(`${apply ? 'CREATE' : 'would create'} "${post.title}" ` +
            `(${post.comments.length} comments) course=${post.courseId}`);
        if (!apply) {
            created += 1;
            continue;
        }
        await prisma.forumThread.create({
            data: {
                title: post.title,
                content: post.content,
                excerpt: post.content
                    .replace(/<[^>]*>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 280),
                userId: post.userId,
                courseId: post.courseId,
                categoryId: category.id,
                sourcePostId: post.id,
                status: 'active',
                lastActivityAt,
                createdAt: post.createdAt,
                updatedAt: post.updatedAt,
                ThreadSubscription: { create: { userId: post.userId } },
                ForumComment: {
                    create: post.comments.map((comment) => ({
                        content: comment.content,
                        userId: comment.userId,
                        createdAt: comment.createdAt,
                        updatedAt: comment.updatedAt,
                    })),
                },
            },
        });
        created += 1;
    }
    console.log(`\n${apply ? 'Created' : 'Would create'}: ${created}  skipped (already migrated): ${skipped}  posts scanned: ${posts.length}\n`);
}
main()
    .catch((error) => {
    console.error(error);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=migrate-course-posts-to-forum.js.map