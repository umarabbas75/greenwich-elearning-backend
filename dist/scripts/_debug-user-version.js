"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
dotenv.config();
const email = process.argv[2] ?? 'umartest@gmail.com';
const courseTitle = process.argv[3] ?? 'test';
const prisma = new client_1.PrismaClient({
    datasources: {
        db: { url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL },
    },
});
async function main() {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        console.log(`User not found: ${email}`);
        return;
    }
    const course = await prisma.course.findFirst({
        where: { title: { equals: courseTitle, mode: 'insensitive' } },
    });
    if (!course) {
        console.log(`Course not found: ${courseTitle}`);
        return;
    }
    const uc = await prisma.userCourse.findUnique({
        where: { userId_courseId: { userId: user.id, courseId: course.id } },
        include: {
            enrolledVersion: {
                select: {
                    id: true,
                    versionNumber: true,
                    isLatest: true,
                    status: true,
                    publishedAt: true,
                },
            },
        },
    });
    const versions = await prisma.courseVersion.findMany({
        where: { courseId: course.id },
        orderBy: { versionNumber: 'asc' },
        include: { _count: { select: { sections: true, enrollments: true } } },
    });
    const liveSections = await prisma.section.count({
        where: {
            isArchived: false,
            chapter: { isArchived: false, module: { courseId: course.id, isArchived: false } },
        },
    });
    console.log('\n── User ──');
    console.log({ email: user.email, userId: user.id });
    console.log('\n── Course ──');
    console.log({ title: course.title, courseId: course.id, liveSectionCount: liveSections });
    console.log('\n── Enrollment ──');
    console.log(uc
        ? {
            userCourseId: uc.id,
            isActive: uc.isActive,
            isPaid: uc.isPaid,
            activatedAt: uc.activatedAt,
            enrolledVersionId: uc.enrolledVersionId,
            enrolledVersionNumber: uc.enrolledVersion?.versionNumber ?? null,
            pinnedVersionIsLatest: uc.enrolledVersion?.isLatest ?? null,
        }
        : 'NOT ASSIGNED');
    console.log('\n── Published versions ──');
    for (const v of versions) {
        console.log({
            versionNumber: v.versionNumber,
            isLatest: v.isLatest,
            status: v.status,
            snapshottedSections: v._count.sections,
            pinnedEnrollments: v._count.enrollments,
            publishedAt: v.publishedAt,
        });
    }
    console.log('');
}
main()
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=_debug-user-version.js.map