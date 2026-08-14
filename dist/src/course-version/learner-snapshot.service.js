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
const chapter_progression_1 = require("../utils/chapter-progression");
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
    async getLearnerCourseDetail(userId, courseId) {
        const enrollment = await this.prisma.userCourse.findUnique({
            where: { userId_courseId: { userId, courseId } },
            include: {
                course: { select: { id: true, title: true } },
                enrolledVersion: {
                    select: { id: true, versionNumber: true, status: true, manifest: true },
                },
            },
        });
        if (!enrollment) {
            throw new common_1.NotFoundException(`User ${userId} is not enrolled in course ${courseId}`);
        }
        const manifest = enrollment.enrolledVersionId
            ? await (0, course_version_manifest_1.loadManifestForVersion)(this.prisma, enrollment.enrolledVersionId)
            : null;
        const structure = manifest
            ? await this.buildTreeFromManifest(courseId, manifest)
            : await this.buildLiveTree(courseId);
        const chapterIds = structure.flatMap((m) => m.chapters.map((c) => c.chapterId));
        const sectionIds = structure.flatMap((m) => m.chapters.flatMap((c) => c.sections.map((s) => s.sectionId)));
        const quizIds = structure.flatMap((m) => m.chapters.flatMap((c) => c.quizIds));
        const [progressRows, timeRows, lastSeenRows, chapterCompletions, moduleCompletions, quizProgressRows, quizzes, quizAnswers,] = await Promise.all([
            this.prisma.userCourseProgress.findMany({
                where: { userId, courseId },
                select: { sectionId: true, createdAt: true },
            }),
            this.prisma.sectionTimeSpent.findMany({
                where: { userId, sectionId: { in: sectionIds } },
                select: {
                    sectionId: true,
                    totalSeconds: true,
                    totalAttempts: true,
                    firstAttemptAt: true,
                    lastAttemptAt: true,
                },
            }),
            this.prisma.lastSeenSection.findMany({
                where: { userId, chapterId: { in: chapterIds } },
                select: { chapterId: true, sectionId: true, updatedAt: true },
            }),
            this.prisma.userChapterCompletion.findMany({
                where: { userId, chapterId: { in: chapterIds } },
                select: { chapterId: true, completedAt: true },
            }),
            this.prisma.userModuleCompletion.findMany({
                where: { userId, courseId },
                select: { moduleId: true, completedAt: true },
            }),
            this.prisma.quizProgress.findMany({
                where: { userId, chapterId: { in: chapterIds } },
            }),
            this.prisma.quiz.findMany({
                where: { id: { in: quizIds } },
                select: {
                    id: true,
                    question: true,
                    options: true,
                    answer: true,
                    chapterId: true,
                    orderIndex: true,
                },
            }),
            this.prisma.quizAnswer.findMany({
                where: { userId, quizId: { in: quizIds } },
                select: {
                    quizId: true,
                    answer: true,
                    isAnswerCorrect: true,
                    updatedAt: true,
                },
            }),
        ]);
        const completedAtBySection = new Map(progressRows.map((p) => [p.sectionId, p.createdAt]));
        const timeBySection = new Map(timeRows.map((t) => [t.sectionId, t]));
        const lastSeenByChapter = new Map(lastSeenRows.map((l) => [l.chapterId, l]));
        const chapterCompletedAt = new Map(chapterCompletions.map((c) => [c.chapterId, c.completedAt]));
        const moduleCompletedAt = new Map(moduleCompletions.map((m) => [m.moduleId, m.completedAt]));
        const quizProgressByChapter = new Map(quizProgressRows.map((q) => [q.chapterId, q]));
        const answerByQuiz = new Map(quizAnswers.map((a) => [a.quizId, a]));
        const quizzesByChapter = new Map();
        for (const quiz of quizzes) {
            if (!quiz.chapterId)
                continue;
            const list = quizzesByChapter.get(quiz.chapterId) ?? [];
            list.push(quiz);
            quizzesByChapter.set(quiz.chapterId, list);
        }
        const modules = structure.map((mod) => {
            const chapters = mod.chapters.map((chapter) => {
                const sections = chapter.sections.map((section) => {
                    const completedAt = completedAtBySection.get(section.sectionId) ?? null;
                    const time = timeBySection.get(section.sectionId);
                    const isLastSeen = lastSeenByChapter.get(chapter.chapterId)?.sectionId ===
                        section.sectionId;
                    return {
                        sectionId: section.sectionId,
                        title: section.title,
                        type: section.type,
                        orderIndex: section.orderIndex,
                        status: completedAt ? 'completed' : isLastSeen ? 'opened' : 'not_opened',
                        completedAt,
                        isLastSeen,
                        timeSpentSeconds: time?.totalSeconds ?? 0,
                        attempts: time?.totalAttempts ?? 0,
                        firstAttemptAt: time?.firstAttemptAt ?? null,
                        lastAttemptAt: time?.lastAttemptAt ?? null,
                    };
                });
                const chapterQuizzes = (quizzesByChapter.get(chapter.chapterId) ?? [])
                    .slice()
                    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
                    .map((quiz) => {
                    const given = answerByQuiz.get(quiz.id);
                    return {
                        quizId: quiz.id,
                        question: quiz.question,
                        options: quiz.options,
                        correctAnswer: quiz.answer,
                        givenAnswer: given?.answer ?? null,
                        isCorrect: given?.isAnswerCorrect ?? null,
                        answeredAt: given?.updatedAt ?? null,
                    };
                });
                const quizProgress = quizProgressByChapter.get(chapter.chapterId);
                const sectionsCompleted = sections.filter((s) => s.status === 'completed').length;
                return {
                    chapterId: chapter.chapterId,
                    title: chapter.title,
                    completedAt: chapterCompletedAt.get(chapter.chapterId) ?? null,
                    sectionsTotal: sections.length,
                    sectionsCompleted,
                    timeSpentSeconds: sections.reduce((sum, s) => sum + s.timeSpentSeconds, 0),
                    sections,
                    quiz: chapterQuizzes.length
                        ? {
                            totalQuestions: chapterQuizzes.length,
                            answered: chapterQuizzes.filter((q) => q.givenAnswer != null)
                                .length,
                            correct: chapterQuizzes.filter((q) => q.isCorrect === true)
                                .length,
                            attempts: quizProgress?.totalAttempts ?? 0,
                            score: quizProgress?.score ?? null,
                            passingCriteria: (0, chapter_progression_1.resolvePassingCriteria)(quizProgress?.passingCriteria),
                            isPassed: quizProgress?.isPassed ?? false,
                            questions: chapterQuizzes,
                        }
                        : null,
                };
            });
            return {
                moduleId: mod.moduleId,
                title: mod.title,
                completedAt: moduleCompletedAt.get(mod.moduleId) ?? null,
                chaptersTotal: chapters.length,
                chaptersCompleted: chapters.filter((c) => c.completedAt).length,
                chapters,
            };
        });
        return {
            message: 'Learner course detail retrieved',
            statusCode: 200,
            data: {
                courseId,
                courseTitle: enrollment.course?.title ?? '(unknown course)',
                curriculumSource: manifest ? 'pinned' : 'live',
                pinnedVersion: enrollment.enrolledVersion
                    ? {
                        versionId: enrollment.enrolledVersion.id,
                        versionNumber: enrollment.enrolledVersion.versionNumber,
                        status: enrollment.enrolledVersion.status,
                    }
                    : null,
                answersAreLatestAttemptOnly: true,
                modules,
            },
        };
    }
    async buildTreeFromManifest(courseId, manifest) {
        const moduleIds = manifest.modules.map((m) => m.sourceId);
        const chapterIds = manifest.modules.flatMap((m) => m.chapters.map((c) => c.sourceId));
        const sectionIds = manifest.modules.flatMap((m) => m.chapters.flatMap((c) => c.sectionIds));
        const [modules, chapters, sections] = await Promise.all([
            this.prisma.module.findMany({
                where: { id: { in: moduleIds } },
                select: { id: true, title: true },
            }),
            this.prisma.chapter.findMany({
                where: { id: { in: chapterIds } },
                select: { id: true, title: true },
            }),
            this.prisma.section.findMany({
                where: { id: { in: sectionIds } },
                select: { id: true, title: true, type: true, orderIndex: true },
            }),
        ]);
        const moduleById = new Map(modules.map((m) => [m.id, m]));
        const chapterById = new Map(chapters.map((c) => [c.id, c]));
        const sectionById = new Map(sections.map((s) => [s.id, s]));
        return manifest.modules
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((mod) => ({
            moduleId: mod.sourceId,
            title: moduleById.get(mod.sourceId)?.title ?? '(removed unit)',
            chapters: mod.chapters
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((chapter) => ({
                chapterId: chapter.sourceId,
                title: chapterById.get(chapter.sourceId)?.title ?? '(removed chapter)',
                quizIds: chapter.quizIds,
                sections: chapter.sectionIds.map((sectionId) => {
                    const section = sectionById.get(sectionId);
                    return {
                        sectionId,
                        title: section?.title ?? '(removed lesson)',
                        type: section?.type ?? null,
                        orderIndex: section?.orderIndex ?? null,
                    };
                }),
            })),
        }));
    }
    async buildLiveTree(courseId) {
        const modules = await this.prisma.module.findMany({
            where: { courseId, isArchived: false },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                title: true,
                chapters: {
                    where: { isArchived: false },
                    orderBy: { createdAt: 'asc' },
                    select: {
                        id: true,
                        title: true,
                        quizzes: {
                            where: { isArchived: false },
                            select: { id: true },
                            orderBy: { orderIndex: 'asc' },
                        },
                        sections: {
                            where: { isArchived: false, isActive: true },
                            orderBy: { orderIndex: 'asc' },
                            select: { id: true, title: true, type: true, orderIndex: true },
                        },
                    },
                },
            },
        });
        return modules.map((mod) => ({
            moduleId: mod.id,
            title: mod.title,
            chapters: mod.chapters.map((chapter) => ({
                chapterId: chapter.id,
                title: chapter.title,
                quizIds: chapter.quizzes.map((q) => q.id),
                sections: chapter.sections.map((section) => ({
                    sectionId: section.id,
                    title: section.title,
                    type: section.type,
                    orderIndex: section.orderIndex,
                })),
            })),
        }));
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