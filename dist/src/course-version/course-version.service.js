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
const prisma_service_1 = require("../prisma/prisma.service");
const course_version_manifest_1 = require("./course-version.manifest");
let CourseVersionService = CourseVersionService_1 = class CourseVersionService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(CourseVersionService_1.name);
        this.getChapterIdsFromManifest = course_version_manifest_1.getChapterIdsFromManifest;
        this.getSectionIdsFromManifest = course_version_manifest_1.getSectionIdsFromManifest;
        this.getQuizIdsFromManifest = course_version_manifest_1.getQuizIdsFromManifest;
    }
    async resolveCurriculumTree(userId, courseId) {
        const enrolledVersionId = await this.resolveEnrolledVersionId(userId, courseId);
        if (!enrolledVersionId) {
            return { mode: 'live' };
        }
        const tree = await (0, course_version_manifest_1.loadPinnedCurriculum)(this.prisma, enrolledVersionId);
        if (!tree) {
            this.logger.warn(`User ${userId} pinned to missing or invalid version ${enrolledVersionId}; falling back to live tree`);
            return { mode: 'live' };
        }
        return {
            mode: 'versioned',
            versionId: tree.versionId,
            versionNumber: tree.versionNumber,
            tree,
        };
    }
    async resolveEnrolledVersionId(userId, courseId, preloadedUc) {
        const uc = preloadedUc ??
            (await this.prisma.userCourse.findUnique({
                where: { userId_courseId: { userId, courseId } },
                select: { id: true, enrolledVersionId: true },
            }));
        if (!uc?.enrolledVersionId) {
            return null;
        }
        let enrolledVersionId = uc.enrolledVersionId;
        const [progressCount, versionExists] = await Promise.all([
            this.prisma.userCourseProgress.count({
                where: { userId, courseId },
            }),
            this.prisma.courseVersion.findUnique({
                where: { id: enrolledVersionId },
                select: { id: true },
            }),
        ]);
        if (!versionExists) {
            this.logger.warn(`User ${userId} pinned to missing version ${enrolledVersionId}; falling back to live tree`);
            return null;
        }
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
        return enrolledVersionId;
    }
    async getVersionQuizzesForChapter(userId, courseId, sourceChapterId, includeAnswers = false, preResolvedVersionId) {
        const versionId = preResolvedVersionId !== undefined
            ? preResolvedVersionId
            : await this.resolveEnrolledVersionId(userId, courseId);
        if (!versionId) {
            return null;
        }
        const tree = await (0, course_version_manifest_1.loadPinnedCurriculum)(this.prisma, versionId);
        if (!tree) {
            return [];
        }
        for (const mod of tree.modules) {
            const ch = mod.chapters.find((c) => c.sourceChapterId === sourceChapterId);
            if (ch) {
                return (0, course_version_manifest_1.mapPinnedQuizzesForLearner)(ch.quizzes, includeAnswers);
            }
        }
        return [];
    }
    async resolveCurriculumByEnrollment(enrolledVersionId) {
        if (!enrolledVersionId) {
            return { mode: 'live' };
        }
        const tree = await (0, course_version_manifest_1.loadPinnedCurriculum)(this.prisma, enrolledVersionId);
        if (!tree) {
            return { mode: 'live' };
        }
        return {
            mode: 'versioned',
            versionId: tree.versionId,
            versionNumber: tree.versionNumber,
            tree,
        };
    }
    async getLatestPublishedVersion(courseId) {
        return this.prisma.courseVersion.findFirst({
            where: { courseId, status: 'PUBLISHED', isLatest: true },
            select: {
                id: true,
                versionNumber: true,
                manifest: true,
                sectionCount: true,
                publishedAt: true,
            },
        });
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
    async publishNewVersion(adminId, courseId, changeNotes) {
        const course = await this.prisma.course.findUnique({
            where: { id: courseId },
            select: { id: true, title: true },
        });
        if (!course) {
            throw new common_1.NotFoundException('Course not found');
        }
        const latest = await this.getLatestPublishedVersion(courseId);
        const built = await (0, course_version_manifest_1.buildManifestFromLiveTree)(this.prisma, courseId);
        if (latest?.manifest) {
            const latestManifest = (0, course_version_manifest_1.parseManifest)(latest.manifest);
            if (latestManifest &&
                (0, course_version_manifest_1.computeStructuralFingerprint)(latestManifest) ===
                    (0, course_version_manifest_1.computeStructuralFingerprint)(built.manifest)) {
                return {
                    message: `No structural change — still on version ${latest.versionNumber}`,
                    statusCode: 200,
                    data: {
                        ...latest,
                        stats: {
                            modules: built.moduleCount,
                            chapters: built.chapterCount,
                            sections: built.sectionCount,
                            quizzes: built.quizCount,
                        },
                        skipped: true,
                    },
                };
            }
        }
        return this.prisma.$transaction(async (tx) => {
            const currentLatest = await tx.courseVersion.findFirst({
                where: { courseId, isLatest: true },
                orderBy: { versionNumber: 'desc' },
            });
            const nextNumber = (currentLatest?.versionNumber ?? 0) + 1;
            if (currentLatest) {
                await tx.courseVersion.update({
                    where: { id: currentLatest.id },
                    data: { isLatest: false },
                });
            }
            const snapshot = await (0, course_version_manifest_1.publishManifestVersion)(tx, courseId, {
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
        });
    }
    async autoPublishAfterStructuralChange(courseId, adminId, changeNotes) {
        const latest = await this.getLatestPublishedVersion(courseId);
        const built = await (0, course_version_manifest_1.buildManifestFromLiveTree)(this.prisma, courseId);
        if (latest?.manifest) {
            const latestManifest = (0, course_version_manifest_1.parseManifest)(latest.manifest);
            if (latestManifest &&
                (0, course_version_manifest_1.computeStructuralFingerprint)(latestManifest) ===
                    (0, course_version_manifest_1.computeStructuralFingerprint)(built.manifest)) {
                this.logger.log(`Skipping auto-publish for ${courseId}: no structural change (${changeNotes})`);
                return null;
            }
        }
        this.logger.log(`Auto-publishing ${courseId}: ${changeNotes}`);
        const result = await this.publishNewVersion(adminId, courseId, changeNotes);
        if (result.data && 'skipped' in result.data && result.data.skipped) {
            return null;
        }
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
                _count: { select: { enrollments: true } },
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
                sectionCount: v.sectionCount,
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
        const enrolledVersionId = await this.resolveEnrolledVersionId(userId, courseId);
        if (!enrolledVersionId) {
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
        const version = await this.prisma.courseVersion.findUnique({
            where: { id: enrolledVersionId },
            select: { sectionCount: true, manifest: true },
        });
        if (version?.sectionCount != null) {
            const manifest = (0, course_version_manifest_1.parseManifest)(version.manifest);
            if (manifest) {
                const ids = (0, course_version_manifest_1.getSectionIdsFromManifest)(manifest);
                return { total: version.sectionCount, liveSectionIds: ids };
            }
        }
        const tree = await (0, course_version_manifest_1.loadPinnedCurriculum)(this.prisma, enrolledVersionId);
        if (!tree) {
            return { total: 0, liveSectionIds: [] };
        }
        const ids = (0, course_version_manifest_1.getSectionIdsFromManifest)(tree.manifest);
        return { total: ids.length, liveSectionIds: ids };
    }
    async countVersionSectionsForCourse(versionId) {
        const version = await this.prisma.courseVersion.findUnique({
            where: { id: versionId },
            select: { sectionCount: true, manifest: true },
        });
        if (version?.sectionCount != null) {
            return version.sectionCount;
        }
        const manifest = (0, course_version_manifest_1.parseManifest)(version?.manifest);
        return manifest ? (0, course_version_manifest_1.countSectionsInManifest)(manifest) : 0;
    }
    buildUserModulesFromVersion(tree, progressByChapter, progressByModule) {
        return tree.modules.map((mod) => {
            let moduleSectionTotal = 0;
            let moduleProgressTotal = 0;
            const chapters = mod.chapters.map((ch) => {
                const sourceChapterId = ch.sourceChapterId;
                const sectionTotal = ch.sections.length;
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
                id: mod.sourceModuleId,
                title: mod.title,
                chapters,
                _count: {
                    UserCourseProgress: Math.min(progressByModule.get(mod.sourceModuleId) ?? moduleProgressTotal, moduleSectionTotal),
                    sections: moduleSectionTotal,
                },
            };
        });
    }
    findVersionChapterBySourceId(tree, sourceChapterId) {
        for (const mod of tree.modules) {
            const ch = mod.chapters.find((c) => c.sourceChapterId === sourceChapterId);
            if (ch) {
                return { module: mod, chapter: ch };
            }
        }
        return null;
    }
    mapVersionSectionsForLearner(sections) {
        return (0, course_version_manifest_1.mapPinnedSectionsForLearner)(sections);
    }
    mapVersionQuizzesForLearner(quizzes, includeAnswers) {
        return (0, course_version_manifest_1.mapPinnedQuizzesForLearner)(quizzes, includeAnswers);
    }
    async summarizeNewSincePinnedVersion(userId, courseId) {
        const uc = await this.prisma.userCourse.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { enrolledVersionId: true },
        });
        if (!uc?.enrolledVersionId)
            return null;
        const [pinnedVersion, latest] = await Promise.all([
            this.prisma.courseVersion.findUnique({
                where: { id: uc.enrolledVersionId },
                select: { manifest: true, publishedAt: true },
            }),
            this.getLatestPublishedVersion(courseId),
        ]);
        if (!latest || latest.id === uc.enrolledVersionId)
            return null;
        const pinnedManifest = (0, course_version_manifest_1.parseManifest)(pinnedVersion?.manifest);
        const latestManifest = (0, course_version_manifest_1.parseManifest)(latest.manifest);
        if (!pinnedManifest || !latestManifest)
            return null;
        const diff = (0, course_version_manifest_1.diffManifests)(pinnedManifest, latestManifest);
        if (diff.newSections === 0)
            return null;
        return {
            newChapters: diff.newChapters,
            newSections: diff.newSections,
            addedAt: latest.publishedAt ?? null,
        };
    }
    async isReferencedByAnyVersion(table, sourceId, courseId) {
        const versions = await this.prisma.courseVersion.findMany({
            where: courseId ? { courseId } : undefined,
            select: { manifest: true },
        });
        for (const v of versions) {
            const manifest = (0, course_version_manifest_1.parseManifest)(v.manifest);
            if (manifest && (0, course_version_manifest_1.isIdReferencedInManifest)(manifest, table, sourceId)) {
                return true;
            }
        }
        return false;
    }
    async pruneOrphanVersions(courseId) {
        const versions = await this.prisma.courseVersion.findMany({
            where: courseId ? { courseId } : undefined,
            orderBy: { versionNumber: 'asc' },
            include: { _count: { select: { enrollments: true } } },
        });
        const toDelete = versions.filter((v) => v._count.enrollments === 0 && !v.isLatest);
        for (const v of toDelete) {
            await this.prisma.courseVersion.delete({ where: { id: v.id } });
        }
        return {
            message: `Pruned ${toDelete.length} orphan version(s)`,
            statusCode: 200,
            data: {
                deleted: toDelete.length,
                versionNumbers: toDelete.map((v) => v.versionNumber),
            },
        };
    }
    async getManifestForVersion(versionId) {
        const version = await this.prisma.courseVersion.findUnique({
            where: { id: versionId },
            select: { manifest: true, sectionCount: true },
        });
        return version ? (0, course_version_manifest_1.parseManifest)(version.manifest) : null;
    }
};
exports.CourseVersionService = CourseVersionService;
exports.CourseVersionService = CourseVersionService = CourseVersionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CourseVersionService);
//# sourceMappingURL=course-version.service.js.map