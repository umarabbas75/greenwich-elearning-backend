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
var CourseVersionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CourseVersionService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const course_version_snapshot_1 = require("./course-version.snapshot");
const versionInclude = {
    modules: {
        orderBy: { orderIndex: 'asc' },
        include: {
            chapters: {
                orderBy: { orderIndex: 'asc' },
                include: {
                    sections: true,
                    quizzes: true,
                },
            },
        },
    },
};
let CourseVersionService = CourseVersionService_1 = class CourseVersionService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(CourseVersionService_1.name);
    }
    async resolveCurriculumTree(userId, courseId) {
        await this.syncPublishedVersionWithLiveTree(courseId, null, 'Sync before learner curriculum read');
        const uc = await this.prisma.userCourse.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { id: true, enrolledVersionId: true },
        });
        if (!uc?.enrolledVersionId) {
            return { mode: 'live' };
        }
        let enrolledVersionId = uc.enrolledVersionId;
        const progressCount = await this.prisma.userCourseProgress.count({
            where: { userId, courseId },
        });
        if (progressCount === 0) {
            const latest = await this.getLatestPublishedVersion(courseId);
            if (latest && latest.id !== enrolledVersionId) {
                await this.prisma.userCourse.update({
                    where: { id: uc.id },
                    data: { enrolledVersionId: latest.id },
                });
                enrolledVersionId = latest.id;
                this.logger.log(`Bumped zero-progress enrollment ${uc.id} to version ${latest.versionNumber}`);
            }
        }
        const version = await this.prisma.courseVersion.findUnique({
            where: { id: enrolledVersionId },
            include: versionInclude,
        });
        if (!version) {
            this.logger.warn(`User ${userId} pinned to missing version ${uc.enrolledVersionId}; falling back to live tree`);
            return { mode: 'live' };
        }
        return {
            mode: 'versioned',
            versionId: version.id,
            versionNumber: version.versionNumber,
            version,
        };
    }
    async resolveCurriculumByEnrollment(enrolledVersionId) {
        if (!enrolledVersionId) {
            return { mode: 'live' };
        }
        const version = await this.prisma.courseVersion.findUnique({
            where: { id: enrolledVersionId },
            include: versionInclude,
        });
        if (!version) {
            return { mode: 'live' };
        }
        return {
            mode: 'versioned',
            versionId: version.id,
            versionNumber: version.versionNumber,
            version,
        };
    }
    async getLatestPublishedVersion(courseId) {
        return this.prisma.courseVersion.findFirst({
            where: { courseId, status: 'PUBLISHED', isLatest: true },
        });
    }
    async countLiveTreeStats(courseId, db = this.prisma) {
        const [modules, chapters, sections, quizzes] = await Promise.all([
            db.module.count({ where: { courseId, isArchived: false } }),
            db.chapter.count({
                where: {
                    isArchived: false,
                    module: { courseId, isArchived: false },
                },
            }),
            db.section.count({
                where: {
                    isArchived: false,
                    chapter: { isArchived: false, module: { courseId, isArchived: false } },
                },
            }),
            db.quiz.count({
                where: {
                    isArchived: false,
                    chapter: { isArchived: false, module: { courseId, isArchived: false } },
                },
            }),
        ]);
        return { modules, chapters, sections, quizzes };
    }
    async countVersionStats(versionId, db = this.prisma) {
        const [modules, chapters, sections, quizzes] = await Promise.all([
            db.courseVersionModule.count({ where: { versionId } }),
            db.courseVersionChapter.count({ where: { versionId } }),
            db.courseVersionSection.count({ where: { versionId } }),
            db.courseVersionQuiz.count({ where: { versionId } }),
        ]);
        return { modules, chapters, sections, quizzes };
    }
    async isLiveTreeDriftedFromLatest(courseId) {
        const live = await this.countLiveTreeStats(courseId);
        const latest = await this.getLatestPublishedVersion(courseId);
        if (!latest) {
            return live.sections > 0 || live.quizzes > 0;
        }
        const published = await this.countVersionStats(latest.id);
        return (live.modules !== published.modules ||
            live.chapters !== published.chapters ||
            live.sections !== published.sections ||
            live.quizzes !== published.quizzes);
    }
    async syncPublishedVersionWithLiveTree(courseId, adminId, changeNotes) {
        const drifted = await this.isLiveTreeDriftedFromLatest(courseId);
        if (!drifted) {
            return null;
        }
        this.logger.log(`Live tree drift detected for course ${courseId}; publishing new version`);
        return this.autoPublishAfterStructuralChange(courseId, adminId, changeNotes ?? 'Auto-publish: live curriculum differs from latest version');
    }
    async pinEnrollmentToLatest(userCourseId, tx) {
        const db = tx ?? this.prisma;
        const uc = await db.userCourse.findUnique({
            where: { id: userCourseId },
            select: { id: true, courseId: true, enrolledVersionId: true },
        });
        if (!uc || uc.enrolledVersionId)
            return;
        const latest = await db.courseVersion.findFirst({
            where: { courseId: uc.courseId, status: 'PUBLISHED', isLatest: true },
        });
        if (!latest) {
            this.logger.warn(`No published version for course ${uc.courseId}; enrollment ${userCourseId} stays unpinned`);
            return;
        }
        await db.userCourse.update({
            where: { id: userCourseId },
            data: { enrolledVersionId: latest.id },
        });
    }
    async syncSectionToLatestVersion(sectionId) {
        const section = await this.prisma.section.findUnique({
            where: { id: sectionId },
            include: {
                chapter: { select: { module: { select: { courseId: true } } } },
            },
        });
        if (!section)
            return;
        const latest = await this.getLatestPublishedVersion(section.chapter.module.courseId);
        if (!latest)
            return;
        try {
            await this.prisma.courseVersionSection.updateMany({
                where: { versionId: latest.id, sourceSectionId: section.id },
                data: {
                    title: section.title,
                    description: section.description,
                    shortDescription: section.shortDescription,
                    type: section.type,
                    orderIndex: section.orderIndex,
                    itemLabel: section.itemLabel,
                    categoryLabel: section.categoryLabel,
                    categories: section.categories,
                    maxPerCategory: section.maxPerCategory,
                    isActive: section.isActive,
                    questionText: section.questionText,
                    imageUrl: section.imageUrl,
                    allowMultipleSelection: section.allowMultipleSelection,
                    items: (section.items ?? client_1.Prisma.JsonNull),
                    options: (section.options ?? client_1.Prisma.JsonNull),
                    config: (section.config ?? client_1.Prisma.JsonNull),
                },
            });
        }
        catch (error) {
            this.logger.warn(`Failed to sync section ${sectionId} into latest version: ${error?.message ?? error}`);
        }
    }
    async syncChapterSectionOrderToLatestVersion(chapterId) {
        const chapter = await this.prisma.chapter.findUnique({
            where: { id: chapterId },
            include: {
                sections: { select: { id: true, orderIndex: true } },
                module: { select: { courseId: true } },
            },
        });
        if (!chapter)
            return;
        const latest = await this.getLatestPublishedVersion(chapter.module.courseId);
        if (!latest)
            return;
        try {
            await this.prisma.$transaction(chapter.sections.map((sec) => this.prisma.courseVersionSection.updateMany({
                where: { versionId: latest.id, sourceSectionId: sec.id },
                data: { orderIndex: sec.orderIndex },
            })));
        }
        catch (error) {
            this.logger.warn(`Failed to sync section order for chapter ${chapterId}: ${error?.message ?? error}`);
        }
    }
    async syncModuleToLatestVersion(moduleId) {
        const mod = await this.prisma.module.findUnique({
            where: { id: moduleId },
            select: { id: true, title: true, description: true, courseId: true },
        });
        if (!mod)
            return;
        const latest = await this.getLatestPublishedVersion(mod.courseId);
        if (!latest)
            return;
        try {
            await this.prisma.courseVersionModule.updateMany({
                where: { versionId: latest.id, sourceModuleId: mod.id },
                data: { title: mod.title, description: mod.description },
            });
        }
        catch (error) {
            this.logger.warn(`Failed to sync module ${moduleId}: ${error?.message ?? error}`);
        }
    }
    async syncQuizToLatestVersion(quizId) {
        const quiz = await this.prisma.quiz.findUnique({
            where: { id: quizId },
            include: {
                chapter: { include: { module: { select: { courseId: true } } } },
            },
        });
        if (!quiz?.chapter?.module?.courseId)
            return;
        const latest = await this.getLatestPublishedVersion(quiz.chapter.module.courseId);
        if (!latest)
            return;
        try {
            await this.prisma.courseVersionQuiz.updateMany({
                where: { versionId: latest.id, sourceQuizId: quiz.id },
                data: {
                    question: quiz.question,
                    answer: quiz.answer,
                    options: quiz.options,
                },
            });
        }
        catch (error) {
            this.logger.warn(`Failed to sync quiz ${quizId}: ${error?.message ?? error}`);
        }
    }
    async syncChapterToLatestVersion(chapterId) {
        const chapter = await this.prisma.chapter.findUnique({
            where: { id: chapterId },
            include: { module: { select: { courseId: true } } },
        });
        if (!chapter)
            return;
        const latest = await this.getLatestPublishedVersion(chapter.module.courseId);
        if (!latest)
            return;
        try {
            await this.prisma.courseVersionChapter.updateMany({
                where: { versionId: latest.id, sourceChapterId: chapter.id },
                data: {
                    title: chapter.title,
                    description: chapter.description,
                    pdfFile: chapter.pdfFile,
                },
            });
        }
        catch (error) {
            this.logger.warn(`Failed to sync chapter ${chapterId}: ${error?.message ?? error}`);
        }
    }
    async publishNewVersion(adminId, courseId, changeNotes) {
        const course = await this.prisma.course.findUnique({
            where: { id: courseId },
            select: { id: true, title: true },
        });
        if (!course) {
            throw new common_1.NotFoundException('Course not found');
        }
        return this.prisma.$transaction(async (tx) => {
            const latest = await tx.courseVersion.findFirst({
                where: { courseId, isLatest: true },
                orderBy: { versionNumber: 'desc' },
            });
            const nextNumber = (latest?.versionNumber ?? 0) + 1;
            if (latest) {
                await tx.courseVersion.update({
                    where: { id: latest.id },
                    data: { isLatest: false },
                });
            }
            const snapshot = await (0, course_version_snapshot_1.snapshotLiveTree)(tx, courseId, {
                versionNumber: nextNumber,
                status: 'PUBLISHED',
                isLatest: true,
                publishedAt: new Date(),
                publishedByAdminId: adminId ?? null,
                changeNotes: changeNotes ?? null,
            });
            const version = await tx.courseVersion.findUnique({
                where: { id: snapshot.versionId },
            });
            return {
                message: `Published version ${nextNumber} for "${course.title}"`,
                statusCode: 200,
                data: {
                    ...version,
                    stats: {
                        modules: snapshot.moduleCount,
                        chapters: snapshot.chapterCount,
                        sections: snapshot.sectionCount,
                        quizzes: snapshot.quizCount,
                    },
                },
            };
        }, course_version_snapshot_1.SNAPSHOT_TRANSACTION_OPTIONS);
    }
    async autoPublishAfterStructuralChange(courseId, adminId, changeNotes) {
        this.logger.log(`Auto-publishing ${courseId}: ${changeNotes}`);
        const result = await this.publishNewVersion(adminId, courseId, changeNotes);
        return {
            versionNumber: result.data.versionNumber,
            versionId: result.data.id,
        };
    }
    async listVersions(courseId) {
        const course = await this.prisma.course.findUnique({
            where: { id: courseId },
            select: { id: true, title: true },
        });
        if (!course) {
            throw new common_1.NotFoundException('Course not found');
        }
        const versions = await this.prisma.courseVersion.findMany({
            where: { courseId },
            orderBy: { versionNumber: 'desc' },
            include: {
                _count: {
                    select: {
                        modules: true,
                        sections: true,
                        enrollments: true,
                    },
                },
            },
        });
        return {
            message: 'Course versions retrieved',
            statusCode: 200,
            data: versions.map((v) => ({
                id: v.id,
                courseId: v.courseId,
                versionNumber: v.versionNumber,
                status: v.status,
                isLatest: v.isLatest,
                publishedAt: v.publishedAt,
                changeNotes: v.changeNotes,
                createdAt: v.createdAt,
                moduleCount: v._count.modules,
                sectionCount: v._count.sections,
                enrollmentCount: v._count.enrollments,
            })),
        };
    }
    async archiveVersion(adminId, courseId, versionId) {
        void adminId;
        const version = await this.prisma.courseVersion.findFirst({
            where: { id: versionId, courseId },
            include: {
                _count: { select: { enrollments: true } },
            },
        });
        if (!version) {
            throw new common_1.NotFoundException('Version not found for this course');
        }
        if (version._count.enrollments > 0) {
            throw new common_1.ConflictException(`Cannot archive version ${version.versionNumber}: ${version._count.enrollments} enrollment(s) are pinned to it`);
        }
        if (version.isLatest) {
            throw new common_1.ConflictException('Cannot archive the current latest version. Publish a newer version first.');
        }
        await this.prisma.courseVersion.update({
            where: { id: versionId },
            data: { status: 'ARCHIVED' },
        });
        return {
            message: `Version ${version.versionNumber} archived`,
            statusCode: 200,
            data: { versionId },
        };
    }
    async migrateLearnerToVersion(adminId, userCourseId, targetVersionId) {
        void adminId;
        const uc = await this.prisma.userCourse.findUnique({
            where: { id: userCourseId },
        });
        if (!uc) {
            throw new common_1.NotFoundException('Enrollment not found');
        }
        const target = await this.prisma.courseVersion.findFirst({
            where: {
                id: targetVersionId,
                courseId: uc.courseId,
                status: 'PUBLISHED',
            },
        });
        if (!target) {
            throw new common_1.NotFoundException('Target version not found or not published');
        }
        await this.prisma.userCourse.update({
            where: { id: userCourseId },
            data: { enrolledVersionId: target.id },
        });
        return {
            message: `Enrollment pinned to version ${target.versionNumber}`,
            statusCode: 200,
            data: {
                userCourseId,
                enrolledVersionId: target.id,
                versionNumber: target.versionNumber,
            },
        };
    }
    async countCompletionDenominator(userId, courseId) {
        const resolved = await this.resolveCurriculumTree(userId, courseId);
        if (resolved.mode === 'live') {
            const liveSectionIds = (await this.prisma.section.findMany({
                where: {
                    isActive: true,
                    isArchived: false,
                    chapter: { isArchived: false, module: { courseId, isArchived: false } },
                },
                select: { id: true },
            })).map((s) => s.id);
            return { total: liveSectionIds.length, liveSectionIds };
        }
        const ids = await (0, course_version_snapshot_1.getVersionActiveSectionSourceIds)(this.prisma, resolved.versionId);
        return { total: ids.length, liveSectionIds: ids };
    }
    async countVersionSectionsForCourse(versionId) {
        return (0, course_version_snapshot_1.countVersionActiveSections)(this.prisma, versionId);
    }
    buildUserModulesFromVersion(version, userId, progressByChapter, progressByModule) {
        return version.modules.map((mod) => {
            let moduleSectionTotal = 0;
            let moduleProgressTotal = 0;
            const chapters = mod.chapters.map((ch) => {
                const sourceChapterId = ch.sourceChapterId ?? ch.id;
                const sectionTotal = ch.sections.filter((s) => s.isActive).length;
                const progressCount = progressByChapter.get(sourceChapterId) ?? 0;
                moduleSectionTotal += sectionTotal;
                moduleProgressTotal += Math.min(progressCount, sectionTotal);
                return {
                    id: sourceChapterId,
                    title: ch.title,
                    _count: {
                        UserCourseProgress: Math.min(progressCount, sectionTotal),
                        sections: sectionTotal,
                        quizzes: ch.quizzes.length,
                    },
                    QuizProgress: [],
                };
            });
            return {
                id: mod.sourceModuleId ?? mod.id,
                title: mod.title,
                chapters,
                _count: {
                    UserCourseProgress: Math.min(progressByModule.get(mod.sourceModuleId ?? mod.id) ?? moduleProgressTotal, moduleSectionTotal),
                    sections: moduleSectionTotal,
                },
            };
        });
    }
    findVersionChapterBySourceId(version, sourceChapterId) {
        for (const mod of version.modules) {
            const ch = mod.chapters.find((c) => c.sourceChapterId === sourceChapterId);
            if (ch)
                return { module: mod, chapter: ch };
        }
        return null;
    }
    mapVersionSectionsForLearner(sections) {
        return (0, course_version_snapshot_1.sortVersionSections)(sections).map(course_version_snapshot_1.mapVersionSectionToLiveShape);
    }
    mapVersionQuizzesForLearner(quizzes, includeAnswers) {
        return quizzes.map((q) => {
            const mapped = (0, course_version_snapshot_1.mapVersionQuizToLiveShape)(q);
            if (!includeAnswers) {
                const { answer: _a, ...rest } = mapped;
                return rest;
            }
            return mapped;
        });
    }
    async summarizeNewSincePinnedVersion(userId, courseId) {
        const uc = await this.prisma.userCourse.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { enrolledVersionId: true },
        });
        if (!uc?.enrolledVersionId)
            return null;
        const latest = await this.getLatestPublishedVersion(courseId);
        if (!latest || latest.id === uc.enrolledVersionId)
            return null;
        const [pinnedSectionIds, pinnedChapterIds, latestSections, latestChapters] = await Promise.all([
            this.prisma.courseVersionSection
                .findMany({
                where: { versionId: uc.enrolledVersionId, isActive: true },
                select: { sourceSectionId: true },
            })
                .then((rows) => new Set(rows.map((s) => s.sourceSectionId).filter(Boolean))),
            this.prisma.courseVersionChapter
                .findMany({
                where: { versionId: uc.enrolledVersionId },
                select: { sourceChapterId: true },
            })
                .then((rows) => new Set(rows.map((c) => c.sourceChapterId).filter(Boolean))),
            this.prisma.courseVersionSection.findMany({
                where: { versionId: latest.id, isActive: true },
                select: { sourceSectionId: true, versionChapterId: true, createdAt: true },
            }),
            this.prisma.courseVersionChapter.findMany({
                where: { versionId: latest.id },
                select: { id: true, sourceChapterId: true },
            }),
        ]);
        const latestChapterByVersionId = new Map(latestChapters.map((c) => [c.id, c.sourceChapterId]));
        const newSections = latestSections.filter((s) => s.sourceSectionId && !pinnedSectionIds.has(s.sourceSectionId));
        if (newSections.length === 0)
            return null;
        const newChapterSourceIds = new Set();
        for (const s of newSections) {
            const sourceChapterId = latestChapterByVersionId.get(s.versionChapterId);
            if (sourceChapterId && !pinnedChapterIds.has(sourceChapterId)) {
                newChapterSourceIds.add(sourceChapterId);
            }
        }
        const addedAt = newSections.reduce((max, s) => {
            if (!max || s.createdAt > max)
                return s.createdAt;
            return max;
        }, null);
        return {
            newChapters: newChapterSourceIds.size,
            newSections: newSections.length,
            addedAt,
        };
    }
    async isReferencedByAnyVersion(table, sourceId) {
        switch (table) {
            case 'section':
                return ((await this.prisma.courseVersionSection.count({
                    where: { sourceSectionId: sourceId },
                })) > 0);
            case 'chapter':
                return ((await this.prisma.courseVersionChapter.count({
                    where: { sourceChapterId: sourceId },
                })) > 0);
            case 'module':
                return ((await this.prisma.courseVersionModule.count({
                    where: { sourceModuleId: sourceId },
                })) > 0);
            case 'quiz':
                return ((await this.prisma.courseVersionQuiz.count({
                    where: { sourceQuizId: sourceId },
                })) > 0);
        }
    }
};
exports.CourseVersionService = CourseVersionService;
exports.CourseVersionService = CourseVersionService = CourseVersionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CourseVersionService);
//# sourceMappingURL=course-version.service.js.map