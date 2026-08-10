"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LearnerSnapshotService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const course_version_manifest_1 = require("./course-version.manifest");
const learner_percentage_1 = require("./learner-percentage");
const AUDIT_LIMIT_DEFAULT = 20;
const AUDIT_LIMIT_MAX = 100;
const LEARNER_AUDIT_ACTIONS = [
    'MIGRATE_LEARNER_VERSION',
    'BULK_MIGRATE_LEARNER_VERSION',
    'UNASSIGN_COURSE',
    'UNASSIGN_COURSE_FORCE',
];
let LearnerSnapshotService = class LearnerSnapshotService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getLearnerVersioningSnapshot(userId, options = {}) {
        const includeAudit = options.includeAudit !== false;
        const includeAssessments = options.includeAssessments !== false;
        const auditLimit = Math.min(Math.max(1, options.auditLimit ?? AUDIT_LIMIT_DEFAULT), AUDIT_LIMIT_MAX);
        const learner = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                role: true,
                status: true,
                timezone: true,
                createdAt: true,
                deletedAt: true,
                mustChangePassword: true,
            },
        });
        if (!learner) {
            throw new common_1.NotFoundException(`User ${userId} not found`);
        }
        const enrollments = await this.prisma.userCourse.findMany({
            where: { userId },
            include: {
                course: { select: { id: true, title: true, image: true } },
                enrolledVersion: {
                    select: {
                        id: true,
                        versionNumber: true,
                        status: true,
                        isLatest: true,
                        publishedAt: true,
                        changeNotes: true,
                        sectionCount: true,
                        manifest: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        const courseIds = enrollments.map((e) => e.courseId);
        if (courseIds.length === 0) {
            return this.emptySnapshot(learner, includeAudit ? [] : undefined);
        }
        const [percentages, completions, latestVersions, timeByCourse] = await Promise.all([
            (0, learner_percentage_1.computeLearnerPercentages)(this.prisma, enrollments.map((e) => ({
                userId,
                courseId: e.courseId,
                enrolledVersionId: e.enrolledVersionId,
            }))),
            this.prisma.courseCompletion.findMany({
                where: { userId, courseId: { in: courseIds } },
            }),
            this.prisma.courseVersion.findMany({
                where: {
                    courseId: { in: courseIds },
                    status: 'PUBLISHED',
                    isLatest: true,
                },
                select: {
                    id: true,
                    courseId: true,
                    versionNumber: true,
                    publishedAt: true,
                    sectionCount: true,
                },
            }),
            this.prisma.sectionTimeSpent.groupBy({
                by: ['courseId'],
                where: { userId, courseId: { in: courseIds } },
                _sum: { totalSeconds: true },
                _min: { firstAttemptAt: true },
                _max: { lastAttemptAt: true },
            }),
        ]);
        const completionByCourse = new Map(completions.map((c) => [c.courseId, c]));
        const latestByCourse = new Map(latestVersions.map((v) => [v.courseId, v]));
        const timeMap = new Map(timeByCourse.map((t) => [t.courseId, t]));
        const quizGates = await this.buildQuizGates(userId, enrollments);
        const courses = enrollments.map((enrollment) => {
            const key = (0, learner_percentage_1.percentageKey)(userId, enrollment.courseId);
            const pct = percentages.get(key);
            const completion = completionByCourse.get(enrollment.courseId);
            const latest = latestByCourse.get(enrollment.courseId);
            const pinned = enrollment.enrolledVersion;
            const time = timeMap.get(enrollment.courseId);
            const versionStatus = !latest
                ? 'no_versions'
                : !pinned
                    ? 'not_pinned'
                    : pinned.id === latest.id
                        ? 'on_latest'
                        : 'behind';
            return {
                courseId: enrollment.courseId,
                courseTitle: enrollment.course?.title ?? '(unknown course)',
                courseImage: enrollment.course?.image ?? null,
                enrollment: {
                    userCourseId: enrollment.id,
                    isActive: enrollment.isActive,
                    isPaid: enrollment.isPaid,
                    activatedAt: enrollment.activatedAt,
                    enrolledAt: enrollment.createdAt,
                },
                pinnedVersion: pinned
                    ? {
                        versionId: pinned.id,
                        versionNumber: pinned.versionNumber,
                        status: pinned.status,
                        isLatest: pinned.isLatest,
                        publishedAt: pinned.publishedAt,
                        changeNotes: pinned.changeNotes,
                        sectionCount: pinned.sectionCount,
                    }
                    : null,
                latestPublishedVersion: latest
                    ? {
                        versionId: latest.id,
                        versionNumber: latest.versionNumber,
                        publishedAt: latest.publishedAt,
                        sectionCount: latest.sectionCount,
                    }
                    : null,
                versionStatus,
                versionsBehind: pinned && latest
                    ? Math.max(0, latest.versionNumber - pinned.versionNumber)
                    : null,
                progress: {
                    percentage: pct?.percentage ?? 0,
                    numerator: pct?.numerator ?? 0,
                    denominator: pct?.denominator ?? 0,
                    denominatorSource: pct?.denominatorSource ?? 'live',
                    isCompleted: pct?.isCompleted ?? false,
                    courseCompletedAt: completion?.courseCompletedAt ?? null,
                    assessmentPassedAt: completion?.assessmentPassedAt ?? null,
                    isPassed: completion?.isPassed ?? false,
                    certificateUrl: completion?.certificateUrl ?? null,
                },
                quizGate: quizGates.get(enrollment.courseId) ?? null,
                activity: {
                    timeSpentSeconds: time?._sum?.totalSeconds ?? 0,
                    firstActivityAt: time?._min?.firstAttemptAt ?? null,
                    lastActivityAt: time?._max?.lastAttemptAt ?? null,
                },
            };
        });
        const [auditTrail, assessments] = await Promise.all([
            includeAudit ? this.buildAuditTrail(userId, courseIds, auditLimit) : null,
            includeAssessments ? this.buildAssessments(userId, courseIds) : null,
        ]);
        return {
            message: 'Learner versioning snapshot retrieved',
            statusCode: 200,
            data: {
                learner,
                summary: this.buildSummary(courses),
                courses,
                ...(auditTrail ? { auditTrail } : {}),
                ...(assessments ? { assessments } : {}),
            },
        };
    }
    async buildQuizGates(userId, enrollments) {
        const gates = new Map();
        const chaptersByCourse = new Map();
        for (const enrollment of enrollments) {
            try {
                let chapterIds = [];
                if (enrollment.enrolledVersionId) {
                    const manifest = await (0, course_version_manifest_1.loadManifestForVersion)(this.prisma, enrollment.enrolledVersionId);
                    if (manifest) {
                        chapterIds = (0, course_version_manifest_1.getQuizBearingChapterIdsFromManifest)(manifest);
                    }
                }
                else {
                    const live = await this.prisma.chapter.findMany({
                        where: {
                            module: { courseId: enrollment.courseId, isArchived: false },
                            isArchived: false,
                            quizzes: { some: { isArchived: false } },
                        },
                        select: { id: true },
                    });
                    chapterIds = live.map((c) => c.id);
                }
                chaptersByCourse.set(enrollment.courseId, chapterIds);
            }
            catch {
                chaptersByCourse.set(enrollment.courseId, []);
            }
        }
        const allChapterIds = Array.from(chaptersByCourse.values()).flat();
        if (allChapterIds.length === 0)
            return gates;
        const [progressRows, chapterTitles] = await Promise.all([
            this.prisma.quizProgress.findMany({
                where: { userId, chapterId: { in: allChapterIds } },
            }),
            this.prisma.chapter.findMany({
                where: { id: { in: allChapterIds } },
                select: { id: true, title: true },
            }),
        ]);
        const progressByChapter = new Map(progressRows.map((p) => [p.chapterId, p]));
        const titleByChapter = new Map(chapterTitles.map((c) => [c.id, c.title]));
        for (const [courseId, chapterIds] of chaptersByCourse) {
            if (chapterIds.length === 0) {
                gates.set(courseId, {
                    quizBearingChapters: 0,
                    quizChaptersPassed: 0,
                    outstandingChapters: [],
                });
                continue;
            }
            const outstanding = chapterIds
                .filter((id) => progressByChapter.get(id)?.isPassed !== true)
                .map((id) => {
                const progress = progressByChapter.get(id);
                return {
                    chapterId: id,
                    chapterTitle: titleByChapter.get(id) ?? '(untitled chapter)',
                    attempts: progress?.totalAttempts ?? 0,
                    bestScore: progress?.score ?? null,
                    passingCriteria: progress?.passingCriteria ?? null,
                };
            });
            gates.set(courseId, {
                quizBearingChapters: chapterIds.length,
                quizChaptersPassed: chapterIds.length - outstanding.length,
                outstandingChapters: outstanding,
            });
        }
        return gates;
    }
    async buildAuditTrail(userId, courseIds, take) {
        const rows = await this.prisma.adminAuditLog.findMany({
            where: {
                action: { in: LEARNER_AUDIT_ACTIONS },
                OR: [{ userId }, { adminId: userId }],
            },
            orderBy: { createdAt: 'desc' },
            take,
        });
        if (rows.length === 0)
            return [];
        const auditCourseIds = Array.from(new Set(rows.map((r) => r.courseId).filter((id) => !!id)));
        const courses = auditCourseIds.length
            ? await this.prisma.course.findMany({
                where: { id: { in: auditCourseIds } },
                select: { id: true, title: true },
            })
            : [];
        const titleById = new Map(courses.map((c) => [c.id, c.title]));
        return rows.map((row) => ({
            id: row.id,
            action: row.action,
            actorEmail: row.adminEmail,
            courseId: row.courseId,
            courseTitle: row.courseId ? titleById.get(row.courseId) ?? null : null,
            isActor: row.adminId === userId && row.userId !== userId,
            metadata: row.metadata,
            createdAt: row.createdAt,
        }));
    }
    async buildAssessments(userId, courseIds) {
        const attempts = await this.prisma.assessmentAttempt.findMany({
            where: { userId, assessment: { courseId: { in: courseIds } } },
            select: {
                id: true,
                assessmentId: true,
                status: true,
                percentage: true,
                isPassed: true,
                startedAt: true,
                submittedAt: true,
                finalizedAt: true,
                snapshotTitle: true,
                snapshotPassingPct: true,
                assessment: { select: { courseId: true } },
            },
            orderBy: { startedAt: 'desc' },
        });
        const byAssessment = new Map();
        for (const attempt of attempts) {
            const existing = byAssessment.get(attempt.assessmentId);
            if (!existing) {
                byAssessment.set(attempt.assessmentId, {
                    courseId: attempt.assessment.courseId,
                    assessmentId: attempt.assessmentId,
                    title: attempt.snapshotTitle,
                    passingPercentage: attempt.snapshotPassingPct,
                    attempts: 1,
                    bestPercentage: attempt.percentage,
                    isPassed: attempt.isPassed === true,
                    lastAttemptAt: attempt.startedAt,
                    status: attempt.status,
                });
                continue;
            }
            existing.attempts += 1;
            existing.isPassed = existing.isPassed || attempt.isPassed === true;
            if (attempt.percentage != null &&
                (existing.bestPercentage == null ||
                    attempt.percentage > existing.bestPercentage)) {
                existing.bestPercentage = attempt.percentage;
            }
        }
        return Array.from(byAssessment.values());
    }
    buildSummary(courses) {
        return {
            totalCourses: courses.length,
            activeCourses: courses.filter((c) => c.enrollment.isActive).length,
            completedCourses: courses.filter((c) => c.progress.isCompleted).length,
            coursesOnLatestVersion: courses.filter((c) => c.versionStatus === 'on_latest').length,
            coursesBehindLatest: courses.filter((c) => c.versionStatus === 'behind')
                .length,
            coursesNotPinned: courses.filter((c) => c.versionStatus === 'not_pinned')
                .length,
            coursesAwaitingQuiz: courses.filter((c) => !c.progress.isCompleted &&
                c.progress.percentage >= 100 &&
                (c.quizGate?.outstandingChapters?.length ?? 0) > 0).length,
            totalTimeSpentSeconds: courses.reduce((sum, c) => sum + (c.activity.timeSpentSeconds ?? 0), 0),
        };
    }
    emptySnapshot(learner, auditTrail) {
        return {
            message: 'Learner versioning snapshot retrieved',
            statusCode: 200,
            data: {
                learner,
                summary: {
                    totalCourses: 0,
                    activeCourses: 0,
                    completedCourses: 0,
                    coursesOnLatestVersion: 0,
                    coursesBehindLatest: 0,
                    coursesNotPinned: 0,
                    coursesAwaitingQuiz: 0,
                    totalTimeSpentSeconds: 0,
                },
                courses: [],
                ...(auditTrail ? { auditTrail } : {}),
            },
        };
    }
};
exports.LearnerSnapshotService = LearnerSnapshotService;
exports.LearnerSnapshotService = LearnerSnapshotService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], LearnerSnapshotService);
//# sourceMappingURL=learner-snapshot.service.js.map