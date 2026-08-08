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
    async resolveCurriculumTreeForReport(userId, courseId, preloadedUc) {
        const enrolledVersionId = await this.resolveEnrolledVersionId(userId, courseId, preloadedUc);
        if (!enrolledVersionId) {
            return { mode: 'live' };
        }
        const tree = await (0, course_version_manifest_1.loadPinnedCurriculumForReport)(this.prisma, enrolledVersionId);
        if (!tree) {
            this.logger.warn(`User ${userId} pinned to missing or invalid version ${enrolledVersionId}; falling back to live tree for report`);
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
        const enrolledVersionId = uc.enrolledVersionId;
        const manifest = await (0, course_version_manifest_1.loadManifestForVersion)(this.prisma, enrolledVersionId);
        if (!manifest) {
            this.logger.warn(`User ${userId} pinned to missing/invalid version ${enrolledVersionId}; falling back to live tree`);
            return null;
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
        return (0, course_version_manifest_1.loadPinnedChapterQuizzes)(this.prisma, versionId, sourceChapterId, includeAnswers);
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
            select: { id: true },
        });
        if (!latest) {
            this.logger.warn(`No published version for course ${uc.courseId}; enrollment ${userCourseId} stays unpinned`);
            return;
        }
        await db.userCourse.updateMany({
            where: { id: userCourseId, enrolledVersionId: null },
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
        return this.prisma.$transaction(async (tx) => {
            const [{ locked }] = await tx.$queryRaw(client_1.Prisma.sql `SELECT pg_try_advisory_xact_lock(hashtextextended(${courseId}, 0)) AS locked`);
            if (!locked) {
                throw new common_1.ConflictException(`Another publish is already in progress for course ${courseId}; retry`);
            }
            const built = await (0, course_version_manifest_1.buildManifestFromLiveTree)(tx, courseId);
            const currentLatest = await tx.courseVersion.findFirst({
                where: { courseId, isLatest: true },
                orderBy: { versionNumber: 'desc' },
            });
            if (currentLatest?.manifest) {
                const latestManifest = (0, course_version_manifest_1.parseManifest)(currentLatest.manifest);
                if (latestManifest &&
                    (0, course_version_manifest_1.computeStructuralFingerprint)(latestManifest) ===
                        (0, course_version_manifest_1.computeStructuralFingerprint)(built.manifest)) {
                    return {
                        message: `No structural change — still on version ${currentLatest.versionNumber}`,
                        statusCode: 200,
                        data: {
                            ...currentLatest,
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
            const maxAgg = await tx.courseVersion.aggregate({
                where: { courseId },
                _max: { versionNumber: true },
            });
            const nextNumber = (maxAgg._max.versionNumber ?? 0) + 1;
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
                prebuiltManifest: built,
            });
            const pinned = await tx.userCourse.updateMany({
                where: { courseId, isActive: true, enrolledVersionId: null },
                data: { enrolledVersionId: snapshot.versionId },
            });
            if (pinned.count > 0) {
                this.logger.log(`Pinned ${pinned.count} active unpinned enrollment(s) on course ${courseId} to v${nextNumber}`);
            }
            const version = await tx.courseVersion.findUnique({
                where: { id: snapshot.versionId },
            });
            if (!version) {
                throw new Error(`Published version ${snapshot.versionId} not found after create`);
            }
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
        }, { timeout: 15000, maxWait: 5000 });
    }
    async autoPublishAfterStructuralChange(courseId, adminId, changeNotes) {
        this.logger.log(`Auto-publishing ${courseId}: ${changeNotes}`);
        const result = await this.publishNewVersion(adminId, courseId, changeNotes);
        if (result.data && 'skipped' in result.data && result.data.skipped) {
            this.logger.log(`Skipped auto-publish for ${courseId}: no structural change (${changeNotes})`);
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
        await this.writeAudit({
            adminId,
            action: 'ARCHIVE_VERSION',
            targetType: 'CourseVersion',
            targetId: versionId,
            courseId,
            metadata: {
                versionNumber: version.versionNumber,
                priorStatus: version.status,
            },
        });
        return {
            message: `Version ${version.versionNumber} archived`,
            statusCode: 200,
            data: { versionId },
        };
    }
    async migrateLearnerToVersion(adminId, userCourseId, targetVersionId) {
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
        const priorVersion = uc.enrolledVersionId
            ? await this.prisma.courseVersion.findUnique({
                where: { id: uc.enrolledVersionId },
                select: { id: true, versionNumber: true },
            })
            : null;
        await this.prisma.userCourse.update({
            where: { id: userCourseId },
            data: { enrolledVersionId: target.id },
        });
        await this.writeAudit({
            adminId,
            action: 'MIGRATE_LEARNER_VERSION',
            targetType: 'UserCourse',
            targetId: userCourseId,
            courseId: uc.courseId,
            userId: uc.userId,
            metadata: {
                fromVersionId: priorVersion?.id ?? null,
                fromVersionNumber: priorVersion?.versionNumber ?? null,
                toVersionId: target.id,
                toVersionNumber: target.versionNumber,
            },
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
    async writeAudit(entry, tx) {
        const client = tx ?? this.prisma;
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
            this.logger.warn(`AdminAuditLog write failed (${entry.action}, target=${entry.targetType}:${entry.targetId ?? '-'}, course=${entry.courseId ?? '-'}, user=${entry.userId ?? '-'}): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async countCompletionDenominator(userId, courseId) {
        const liveDenominator = async () => {
            const liveSectionIds = (await this.prisma.section.findMany({
                where: {
                    isActive: true,
                    isArchived: false,
                    chapter: {
                        isArchived: false,
                        module: { courseId, isArchived: false },
                    },
                },
                select: { id: true },
            })).map((s) => s.id);
            return { total: liveSectionIds.length, liveSectionIds };
        };
        const uc = await this.prisma.userCourse.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { enrolledVersionId: true },
        });
        const enrolledVersionId = uc?.enrolledVersionId ?? null;
        if (!enrolledVersionId) {
            return liveDenominator();
        }
        const manifest = await (0, course_version_manifest_1.loadManifestForVersion)(this.prisma, enrolledVersionId);
        if (!manifest) {
            return liveDenominator();
        }
        const ids = (0, course_version_manifest_1.getSectionIdsFromManifest)(manifest);
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
    async summarizeNewSincePinnedVersion(userId, courseId, enrolledVersionId) {
        let pinnedVersionId = enrolledVersionId;
        if (pinnedVersionId === undefined) {
            const uc = await this.prisma.userCourse.findUnique({
                where: { userId_courseId: { userId, courseId } },
                select: { enrolledVersionId: true },
            });
            pinnedVersionId = uc?.enrolledVersionId ?? null;
        }
        if (!pinnedVersionId)
            return null;
        const [pinnedVersion, latest] = await Promise.all([
            this.prisma.courseVersion.findUnique({
                where: { id: pinnedVersionId },
                select: { manifest: true, publishedAt: true },
            }),
            this.getLatestPublishedVersion(courseId),
        ]);
        if (!latest || latest.id === pinnedVersionId)
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
    buildArchiveMessage(entity, stillServedTo, versions) {
        if (stillServedTo === 0) {
            return `Archived — ${entity.toLowerCase()} hidden from new users. No active enrollments are currently pinned to a version that still references it.`;
        }
        const versionList = versions.map((v) => `v${v.versionNumber}`).join(', ');
        const userWord = stillServedTo === 1 ? 'user' : 'users';
        return `Archived — hidden from new users, but still shown to ${stillServedTo} active ${userWord} pinned to ${versionList}. Use POST /courses/enrollments/migrate-version to move learners forward.`;
    }
    async getReferencingVersionsWithEnrollments(table, sourceId, courseId) {
        const map = await this.getReferencingVersionsWithEnrollmentsBatch(table, [sourceId], courseId);
        return map.get(sourceId) ?? { stillServedTo: 0, versions: [] };
    }
    async getReferencingVersionsWithEnrollmentsBatch(table, sourceIds, courseId) {
        const result = new Map();
        for (const id of sourceIds) {
            result.set(id, { stillServedTo: 0, versions: [] });
        }
        if (sourceIds.length === 0)
            return result;
        const versions = await this.prisma.courseVersion.findMany({
            where: courseId ? { courseId } : undefined,
            select: {
                id: true,
                versionNumber: true,
                status: true,
                manifest: true,
                _count: {
                    select: { enrollments: { where: { isActive: true } } },
                },
            },
        });
        const idSet = new Set(sourceIds);
        for (const v of versions) {
            const manifest = (0, course_version_manifest_1.parseManifest)(v.manifest);
            if (!manifest)
                continue;
            for (const id of idSet) {
                if (!(0, course_version_manifest_1.isIdReferencedInManifest)(manifest, table, id))
                    continue;
                const entry = result.get(id);
                entry.versions.push({
                    versionId: v.id,
                    versionNumber: v.versionNumber,
                    status: v.status,
                    enrollmentCount: v._count.enrollments,
                });
                entry.stillServedTo += v._count.enrollments;
            }
        }
        for (const entry of result.values()) {
            entry.versions.sort((a, b) => b.versionNumber - a.versionNumber);
        }
        return result;
    }
    buildRestoreNote(latestVersionNumber) {
        if (!latestVersionNumber) {
            return 'Restored to the live tree. No published versions exist yet — publish a new version to make this row visible to new enrollments.';
        }
        return `Restored to the live tree. Latest published version (v${latestVersionNumber}) does not reference this row; new enrollments will not see it until you publish a new version.`;
    }
    async getRoster(courseId, opts) {
        const page = Math.max(1, opts.page ?? 1);
        const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
        const sort = opts.sort || 'percentage:desc';
        const search = opts.search?.trim() || undefined;
        const latest = await this.prisma.courseVersion.findFirst({
            where: { courseId, status: 'PUBLISHED' },
            orderBy: { versionNumber: 'desc' },
            select: { id: true, versionNumber: true },
        });
        const sortIsPercentage = sort === 'percentage:desc' || sort === 'percentage:asc';
        const orderBy = this._buildRosterOrderBy(sort);
        const searchWhere = search
            ? {
                OR: [
                    { email: { contains: search, mode: 'insensitive' } },
                    {
                        firstName: {
                            contains: search,
                            mode: 'insensitive',
                        },
                    },
                    {
                        lastName: { contains: search, mode: 'insensitive' },
                    },
                ],
            }
            : undefined;
        const userFilter = searchWhere
            ? { deletedAt: null, ...searchWhere }
            : { deletedAt: null };
        const whereClause = {
            courseId,
            user: userFilter,
            ...(opts.versionFilter ? { enrolledVersionId: opts.versionFilter } : {}),
        };
        const rosterSelect = {
            userId: true,
            isActive: true,
            isPaid: true,
            enrolledVersionId: true,
            user: { select: { email: true, firstName: true, lastName: true } },
            enrolledVersion: {
                select: { versionNumber: true, sectionCount: true },
            },
        };
        const [rowsRaw, total] = await Promise.all([
            sortIsPercentage
                ? this.prisma.userCourse.findMany({
                    where: whereClause,
                    select: rosterSelect,
                })
                : this.prisma.userCourse.findMany({
                    where: whereClause,
                    select: rosterSelect,
                    orderBy,
                    take: pageSize,
                    skip: (page - 1) * pageSize,
                }),
            this.prisma.userCourse.count({ where: whereClause }),
        ]);
        const userIds = rowsRaw.map((r) => r.userId);
        const [progressCounts, completions, liveSectionCount] = await Promise.all([
            userIds.length
                ? this.prisma.userCourseProgress.groupBy({
                    by: ['userId'],
                    where: {
                        courseId,
                        userId: { in: userIds },
                        Section: { isArchived: false, isActive: true },
                    },
                    _count: { _all: true },
                })
                : Promise.resolve([]),
            userIds.length
                ? this.prisma.courseCompletion.findMany({
                    where: {
                        courseId,
                        userId: { in: userIds },
                        courseCompletedAt: { not: null },
                    },
                    select: { userId: true },
                })
                : Promise.resolve([]),
            this.prisma.section.count({
                where: {
                    isActive: true,
                    isArchived: false,
                    chapter: {
                        isArchived: false,
                        module: { courseId, isArchived: false },
                    },
                },
            }),
        ]);
        const progressByUser = new Map(progressCounts.map((p) => [p.userId, p._count._all]));
        const completedSet = new Set(completions.map((c) => c.userId));
        const rows = rowsRaw.map((r) => {
            const isCompleted = completedSet.has(r.userId);
            const denom = r.enrolledVersion?.sectionCount ?? liveSectionCount;
            const numer = progressByUser.get(r.userId) ?? 0;
            const percentage = isCompleted
                ? 100
                : denom > 0
                    ? Math.min(100, Math.round((numer * 100) / denom) / 1)
                    : 0;
            const userLabel = [r.user.firstName, r.user.lastName].filter(Boolean).join(' ') ||
                r.user.email;
            return {
                userId: r.userId,
                userLabel,
                email: r.user.email,
                enrolledVersionId: r.enrolledVersionId,
                enrolledVersionNumber: r.enrolledVersion?.versionNumber ?? null,
                percentage,
                isCompleted,
                isActive: r.isActive,
                isPaid: r.isPaid,
            };
        });
        let paged;
        if (sortIsPercentage) {
            const dir = sort === 'percentage:asc' ? 1 : -1;
            rows.sort((a, b) => {
                const d = (a.percentage - b.percentage) * dir;
                return d !== 0 ? d : a.email.localeCompare(b.email);
            });
            paged = rows.slice((page - 1) * pageSize, page * pageSize);
        }
        else {
            paged = rows;
        }
        return {
            message: 'OK',
            statusCode: 200,
            data: {
                latestPublishedVersionId: latest?.id ?? null,
                latestPublishedVersionNumber: latest?.versionNumber ?? null,
                rows: paged,
                total,
                page,
                pageSize,
            },
        };
    }
    _buildRosterOrderBy(sort) {
        switch (sort) {
            case 'email:asc':
                return { user: { email: 'asc' } };
            case 'email:desc':
                return { user: { email: 'desc' } };
            case 'enrolledVersionNumber:asc':
                return { enrolledVersion: { versionNumber: 'asc' } };
            case 'enrolledVersionNumber:desc':
                return { enrolledVersion: { versionNumber: 'desc' } };
            case 'isCompleted:asc':
            case 'isCompleted:desc':
                return { createdAt: sort === 'isCompleted:desc' ? 'desc' : 'asc' };
            default:
                return { user: { email: 'asc' } };
        }
    }
    async getVersionTree(courseId, versionId) {
        const version = await this.prisma.courseVersion.findFirst({
            where: { id: versionId, courseId },
            select: {
                id: true,
                versionNumber: true,
                status: true,
                publishedAt: true,
            },
        });
        if (!version) {
            throw new common_1.NotFoundException(`Version ${versionId} not found for course ${courseId}`);
        }
        const tree = await (0, course_version_manifest_1.loadPinnedCurriculum)(this.prisma, versionId);
        if (!tree) {
            return {
                message: 'OK',
                statusCode: 200,
                data: {
                    versionId: version.id,
                    versionNumber: version.versionNumber,
                    status: version.status,
                    publishedAt: version.publishedAt,
                    modules: [],
                },
            };
        }
        return {
            message: 'OK',
            statusCode: 200,
            data: {
                versionId: version.id,
                versionNumber: version.versionNumber,
                status: version.status,
                publishedAt: version.publishedAt,
                modules: tree.modules.map((m) => ({
                    id: m.sourceModuleId,
                    sourceId: m.sourceModuleId,
                    title: m.title,
                    orderIndex: m.orderIndex,
                    chapters: m.chapters.map((c) => ({
                        id: c.sourceChapterId,
                        sourceId: c.sourceChapterId,
                        title: c.title,
                        orderIndex: c.orderIndex,
                        hasQuiz: c.quizzes.length > 0,
                        sections: c.sections.map((s) => ({
                            id: s.id,
                            sourceId: s.id,
                            title: s.title,
                            type: s.type,
                            orderIndex: s.orderIndex,
                        })),
                        quizzes: c.quizzes.map((q) => ({
                            id: q.id,
                            sourceId: q.id,
                            question: q.question,
                            orderIndex: null,
                        })),
                    })),
                })),
            },
        };
    }
    async diffVersionsTitled(courseId, fromVersionId, toVersionId) {
        const [from, to] = await Promise.all([
            this.prisma.courseVersion.findFirst({
                where: { id: fromVersionId, courseId },
                select: { versionNumber: true, manifest: true },
            }),
            this.prisma.courseVersion.findFirst({
                where: { id: toVersionId, courseId },
                select: { versionNumber: true, manifest: true },
            }),
        ]);
        if (!from) {
            throw new common_1.NotFoundException(`Version ${fromVersionId} not found for course ${courseId}`);
        }
        if (!to) {
            throw new common_1.NotFoundException(`Version ${toVersionId} not found for course ${courseId}`);
        }
        const fromManifest = (0, course_version_manifest_1.parseManifest)(from.manifest);
        const toManifest = (0, course_version_manifest_1.parseManifest)(to.manifest);
        if (!fromManifest || !toManifest) {
            return {
                message: 'OK',
                statusCode: 200,
                data: {
                    fromVersionNumber: from.versionNumber,
                    toVersionNumber: to.versionNumber,
                    added: [],
                    removed: [],
                    moved: [],
                    renamed: [],
                },
            };
        }
        const moduleIds = new Set();
        const chapterIds = new Set();
        const sectionIds = new Set();
        const quizIds = new Set();
        for (const m of [...fromManifest.modules, ...toManifest.modules]) {
            moduleIds.add(m.sourceId);
            for (const ch of m.chapters) {
                chapterIds.add(ch.sourceId);
                for (const sid of ch.sectionIds)
                    sectionIds.add(sid);
                for (const qid of ch.quizIds)
                    quizIds.add(qid);
            }
        }
        const [modules, chapters, sections, quizzes] = await Promise.all([
            moduleIds.size > 0
                ? this.prisma.module.findMany({
                    where: { id: { in: Array.from(moduleIds) } },
                    select: { id: true, title: true },
                })
                : Promise.resolve([]),
            chapterIds.size > 0
                ? this.prisma.chapter.findMany({
                    where: { id: { in: Array.from(chapterIds) } },
                    select: { id: true, title: true },
                })
                : Promise.resolve([]),
            sectionIds.size > 0
                ? this.prisma.section.findMany({
                    where: { id: { in: Array.from(sectionIds) } },
                    select: { id: true, title: true },
                })
                : Promise.resolve([]),
            quizIds.size > 0
                ? this.prisma.quiz.findMany({
                    where: { id: { in: Array.from(quizIds) } },
                    select: { id: true, question: true },
                })
                : Promise.resolve([]),
        ]);
        const titles = new Map();
        for (const m of modules)
            titles.set(m.id, m.title);
        for (const c of chapters)
            titles.set(c.id, c.title);
        for (const s of sections)
            titles.set(s.id, s.title);
        for (const q of quizzes) {
            const snippet = q.question.length > 120 ? q.question.slice(0, 120) + '…' : q.question;
            titles.set(q.id, snippet);
        }
        const diff = (0, course_version_manifest_1.diffManifestsTitled)(fromManifest, toManifest, titles);
        return {
            message: 'OK',
            statusCode: 200,
            data: {
                fromVersionNumber: from.versionNumber,
                toVersionNumber: to.versionNumber,
                ...diff,
            },
        };
    }
    async getCoverage() {
        const [unpinnedGroups, coursesWithoutV1] = await Promise.all([
            this.prisma.userCourse.groupBy({
                by: ['courseId'],
                where: { isActive: true, enrolledVersionId: null },
                _count: { _all: true },
            }),
            this.prisma.course.findMany({
                where: {
                    courseVersions: {
                        none: { versionNumber: 1 },
                    },
                },
                select: { id: true, title: true },
                orderBy: { title: 'asc' },
            }),
        ]);
        const courseIds = unpinnedGroups.map((u) => u.courseId);
        const titles = courseIds.length
            ? await this.prisma.course.findMany({
                where: { id: { in: courseIds } },
                select: { id: true, title: true },
            })
            : [];
        const titleById = new Map(titles.map((c) => [c.id, c.title]));
        const rows = unpinnedGroups
            .map((u) => ({
            courseId: u.courseId,
            courseTitle: titleById.get(u.courseId) ?? '(unknown)',
            activeEnrollmentsWithNullPin: u._count._all,
        }))
            .sort((a, b) => b.activeEnrollmentsWithNullPin - a.activeEnrollmentsWithNullPin);
        return {
            message: 'OK',
            statusCode: 200,
            data: {
                rows,
                coursesWithoutV1: coursesWithoutV1.map((c) => ({
                    courseId: c.id,
                    courseTitle: c.title,
                })),
            },
        };
    }
    async getDrift(courseId) {
        const [latest, liveManifest] = await Promise.all([
            this.prisma.courseVersion.findFirst({
                where: { courseId, status: 'PUBLISHED' },
                orderBy: { versionNumber: 'desc' },
                select: {
                    id: true,
                    versionNumber: true,
                    publishedAt: true,
                    manifest: true,
                },
            }),
            (0, course_version_manifest_1.buildManifestFromLiveTree)(this.prisma, courseId),
        ]);
        const liveFingerprint = (0, course_version_manifest_1.computeStructuralFingerprint)(liveManifest.manifest);
        const emptyTitles = new Map();
        if (!latest) {
            const emptyManifest = { modules: [] };
            const { added, removed, moved, renamed } = (0, course_version_manifest_1.diffManifestsTitled)(emptyManifest, liveManifest.manifest, emptyTitles);
            return {
                message: 'OK',
                statusCode: 200,
                data: {
                    hasDrift: liveManifest.manifest.modules.length > 0,
                    changeCount: {
                        added: added.length,
                        removed: removed.length,
                        moved: moved.length,
                        renamed: renamed.length,
                    },
                    latestPublishedVersionId: null,
                    latestPublishedVersionNumber: null,
                    latestPublishedAt: null,
                    liveFingerprint,
                    publishedFingerprint: null,
                },
            };
        }
        const publishedManifest = (0, course_version_manifest_1.parseManifest)(latest.manifest);
        if (!publishedManifest) {
            return {
                message: 'OK',
                statusCode: 200,
                data: {
                    hasDrift: true,
                    changeCount: { added: 0, removed: 0, moved: 0, renamed: 0 },
                    latestPublishedVersionId: latest.id,
                    latestPublishedVersionNumber: latest.versionNumber,
                    latestPublishedAt: latest.publishedAt,
                    liveFingerprint,
                    publishedFingerprint: null,
                },
            };
        }
        const publishedFingerprint = (0, course_version_manifest_1.computeStructuralFingerprint)(publishedManifest);
        const { added, removed, moved, renamed } = (0, course_version_manifest_1.diffManifestsTitled)(publishedManifest, liveManifest.manifest, emptyTitles);
        const changeCount = {
            added: added.length,
            removed: removed.length,
            moved: moved.length,
            renamed: renamed.length,
        };
        const hasDrift = liveFingerprint !== publishedFingerprint;
        return {
            message: 'OK',
            statusCode: 200,
            data: {
                hasDrift,
                changeCount,
                latestPublishedVersionId: latest.id,
                latestPublishedVersionNumber: latest.versionNumber,
                latestPublishedAt: latest.publishedAt,
                liveFingerprint,
                publishedFingerprint,
            },
        };
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