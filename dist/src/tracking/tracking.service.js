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
var TrackingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrackingService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const interactive_section_types_1 = require("../utils/interactive-section-types");
const user_agent_1 = require("../utils/user-agent");
function clamp(n, lo, hi) {
    if (!Number.isFinite(n))
        return lo;
    return Math.min(Math.max(n, lo), hi);
}
function lruSet(map, key, value, max) {
    map.delete(key);
    map.set(key, value);
    if (map.size > max) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined)
            map.delete(oldest);
    }
}
let TrackingService = TrackingService_1 = class TrackingService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(TrackingService_1.name);
        this.sectionPlaceCache = new Map();
        this.frozenTotals = new Map();
        this.notFrozenUntil = new Map();
    }
    async heartbeat(userId, sectionId, clientActiveSeconds, clientIntervalSeconds) {
        const place = await this.resolveSectionPlace(sectionId);
        const frozenTotal = this.getFrozenTotal(userId, place.courseId);
        if (frozenTotal !== undefined) {
            return this.heartbeatResult(frozenTotal, 0, true);
        }
        const skipCompletionLookup = this.isKnownNotFrozen(userId, place.courseId);
        const [completion, existing] = await Promise.all([
            skipCompletionLookup
                ? Promise.resolve(null)
                : this.prisma.courseCompletion.findUnique({
                    where: { userId_courseId: { userId, courseId: place.courseId } },
                    select: { courseCompletedAt: true },
                }),
            this.prisma.sectionTimeSpent.findUnique({
                where: { userId_sectionId: { userId, sectionId } },
                select: { totalSeconds: true, lastHeartbeatAt: true },
            }),
        ]);
        if (completion?.courseCompletedAt) {
            this.rememberFrozen(userId, place.courseId, existing?.totalSeconds ?? 0);
            return this.heartbeatResult(existing?.totalSeconds ?? 0, 0, true);
        }
        if (!skipCompletionLookup) {
            this.rememberNotFrozen(userId, place.courseId);
        }
        const now = new Date();
        if (!existing) {
            const opened = await this.prisma.sectionTimeSpent.upsert({
                where: { userId_sectionId: { userId, sectionId } },
                create: {
                    userId,
                    sectionId,
                    chapterId: place.chapterId,
                    moduleId: place.moduleId,
                    courseId: place.courseId,
                    totalSeconds: 0,
                    lastHeartbeatAt: now,
                },
                update: { lastHeartbeatAt: now },
            });
            return this.heartbeatResult(opened.totalSeconds, 0);
        }
        const interval = clamp(clientIntervalSeconds ?? TrackingService_1.MAX_INTERVAL, TrackingService_1.MIN_INTERVAL, TrackingService_1.MAX_INTERVAL);
        const perPingCap = clamp(interval * TrackingService_1.CAP_FACTOR, TrackingService_1.MIN_INTERVAL, TrackingService_1.ABSOLUTE_CAP);
        const serverGap = (now.getTime() - existing.lastHeartbeatAt.getTime()) / 1000;
        let credit;
        if (clientActiveSeconds != null) {
            credit = Math.max(0, Math.min(clientActiveSeconds, serverGap, perPingCap));
        }
        else {
            credit = Math.max(0, Math.min(serverGap, interval * TrackingService_1.GRACE_FACTOR));
        }
        const creditSeconds = Math.round(credit);
        const applied = await this.prisma.sectionTimeSpent.updateMany({
            where: { userId, sectionId, lastHeartbeatAt: existing.lastHeartbeatAt },
            data: {
                totalSeconds: { increment: creditSeconds },
                lastHeartbeatAt: now,
            },
        });
        if (applied.count === 0) {
            const current = await this.prisma.sectionTimeSpent.findUnique({
                where: { userId_sectionId: { userId, sectionId } },
                select: { totalSeconds: true },
            });
            return this.heartbeatResult(current?.totalSeconds ?? existing.totalSeconds, 0);
        }
        const totalSeconds = existing.totalSeconds + creditSeconds;
        if (creditSeconds > 0) {
            void this.accrueDailyTime(userId, place.courseId, now, creditSeconds).catch((err) => this.logger.warn(`Daily time roll-up failed for user ${userId} course ${place.courseId}: ${err}`));
        }
        return this.heartbeatResult(totalSeconds, creditSeconds);
    }
    async recordSectionAttempt(userId, sectionId, _isCorrect) {
        const section = await this.prisma.section.findUnique({
            where: { id: sectionId },
            select: {
                id: true,
                type: true,
                chapterId: true,
                moduleId: true,
                chapter: {
                    select: { moduleId: true, module: { select: { courseId: true } } },
                },
            },
        });
        if (!section) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error: 'Section not found' }, common_1.HttpStatus.NOT_FOUND);
        }
        if (!(0, interactive_section_types_1.isInteractiveSectionType)(section.type)) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.BAD_REQUEST,
                error: 'Section attempts are only tracked for interactive section types',
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        const moduleId = section.moduleId ?? section.chapter?.moduleId ?? null;
        const courseId = section.chapter?.module?.courseId;
        if (!courseId) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.BAD_REQUEST,
                error: 'Section is not linked to a course',
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        const enrollment = await this.prisma.userCourse.findFirst({
            where: { userId, courseId, isActive: true },
            select: { id: true },
        });
        if (!enrollment) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.FORBIDDEN,
                error: 'You are not assigned to this course, or the enrolment is inactive',
            }, common_1.HttpStatus.FORBIDDEN);
        }
        const now = new Date();
        const row = await this.prisma.sectionTimeSpent.upsert({
            where: { userId_sectionId: { userId, sectionId } },
            create: {
                userId,
                sectionId,
                chapterId: section.chapterId,
                moduleId,
                courseId,
                totalSeconds: 0,
                totalAttempts: 1,
                firstAttemptAt: now,
                lastAttemptAt: now,
                lastHeartbeatAt: now,
            },
            update: {
                totalAttempts: { increment: 1 },
                lastAttemptAt: now,
            },
        });
        return {
            message: 'Section attempt recorded',
            statusCode: 200,
            data: {
                totalAttempts: row.totalAttempts,
                lastAttemptAt: row.lastAttemptAt,
            },
        };
    }
    frozenKey(userId, courseId) {
        return `${userId}:${courseId}`;
    }
    async resolveSectionPlace(sectionId) {
        const cached = this.sectionPlaceCache.get(sectionId);
        if (cached && cached.expiresAt > Date.now()) {
            lruSet(this.sectionPlaceCache, sectionId, cached, TrackingService_1.SECTION_PLACE_CACHE_MAX);
            return cached.value;
        }
        const section = await this.prisma.section.findUnique({
            where: { id: sectionId },
            select: {
                id: true,
                chapterId: true,
                moduleId: true,
                chapter: {
                    select: { moduleId: true, module: { select: { courseId: true } } },
                },
            },
        });
        if (!section) {
            throw new common_1.HttpException({ status: common_1.HttpStatus.NOT_FOUND, error: 'Section not found' }, common_1.HttpStatus.NOT_FOUND);
        }
        const moduleId = section.moduleId ?? section.chapter?.moduleId ?? null;
        const courseId = section.chapter?.module?.courseId;
        if (!courseId) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.BAD_REQUEST,
                error: 'Section is not linked to a course',
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        const place = {
            chapterId: section.chapterId,
            moduleId,
            courseId,
        };
        lruSet(this.sectionPlaceCache, sectionId, {
            value: place,
            expiresAt: Date.now() + TrackingService_1.SECTION_PLACE_TTL_MS,
        }, TrackingService_1.SECTION_PLACE_CACHE_MAX);
        return place;
    }
    getFrozenTotal(userId, courseId) {
        return this.frozenTotals.get(this.frozenKey(userId, courseId));
    }
    isKnownNotFrozen(userId, courseId) {
        const until = this.notFrozenUntil.get(this.frozenKey(userId, courseId));
        if (until === undefined)
            return false;
        if (until < Date.now()) {
            this.notFrozenUntil.delete(this.frozenKey(userId, courseId));
            return false;
        }
        return true;
    }
    rememberFrozen(userId, courseId, totalSeconds) {
        const key = this.frozenKey(userId, courseId);
        this.notFrozenUntil.delete(key);
        lruSet(this.frozenTotals, key, totalSeconds, TrackingService_1.FROZEN_CACHE_MAX);
    }
    rememberNotFrozen(userId, courseId) {
        lruSet(this.notFrozenUntil, this.frozenKey(userId, courseId), Date.now() + TrackingService_1.NOT_FROZEN_TTL_MS, TrackingService_1.FROZEN_CACHE_MAX);
    }
    utcDay(d) {
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    async accrueDailyTime(userId, courseId, at, seconds) {
        const day = this.utcDay(at);
        await this.prisma.sectionTimeSpentDaily.upsert({
            where: { userId_courseId_day: { userId, courseId, day } },
            create: { userId, courseId, day, totalSeconds: seconds },
            update: { totalSeconds: { increment: seconds } },
        });
    }
    async getLoginHistory(userId, limit = 50) {
        const safeLimit = Math.min(Math.max(limit, 1), 200);
        const events = await this.prisma.loginEvent.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: safeLimit,
            select: { id: true, ipAddress: true, userAgent: true, createdAt: true },
        });
        const data = events.map((e) => {
            const parsed = (0, user_agent_1.parseUserAgent)(e.userAgent);
            return {
                ...e,
                device: parsed?.label ?? 'Unknown device',
                browser: parsed?.browser ?? 'Unknown',
                os: parsed?.os ?? 'Unknown',
                deviceType: parsed?.deviceType ?? 'desktop',
            };
        });
        return {
            message: 'Login history fetched successfully',
            statusCode: 200,
            data,
        };
    }
    async getUserCourseTimeSpent(userId, courseId) {
        const rows = await this.prisma.sectionTimeSpent.findMany({
            where: { userId, courseId },
            select: {
                sectionId: true,
                chapterId: true,
                moduleId: true,
                totalSeconds: true,
            },
        });
        const sectionIds = [...new Set(rows.map((r) => r.sectionId))];
        const chapterIds = [...new Set(rows.map((r) => r.chapterId))];
        const moduleIds = [
            ...new Set(rows.map((r) => r.moduleId).filter((m) => !!m)),
        ];
        const [sections, chapters, modules] = [
            await this.prisma.section.findMany({
                where: { id: { in: sectionIds } },
                select: { id: true, title: true },
            }),
            await this.prisma.chapter.findMany({
                where: { id: { in: chapterIds } },
                select: { id: true, title: true },
            }),
            await this.prisma.module.findMany({
                where: { id: { in: moduleIds } },
                select: { id: true, title: true },
            }),
        ];
        const sectionTitle = new Map(sections.map((s) => [s.id, s.title]));
        const chapterTitle = new Map(chapters.map((c) => [c.id, c.title]));
        const moduleTitle = new Map(modules.map((m) => [m.id, m.title]));
        const UNKNOWN_MODULE = 'unassigned';
        const moduleMap = new Map();
        const chapterMap = new Map();
        let courseTotal = 0;
        for (const r of rows) {
            courseTotal += r.totalSeconds;
            const mKey = r.moduleId ?? UNKNOWN_MODULE;
            let mod = moduleMap.get(mKey);
            if (!mod) {
                mod = {
                    moduleId: r.moduleId ?? null,
                    title: r.moduleId
                        ? moduleTitle.get(r.moduleId) ?? 'Untitled module'
                        : 'Unassigned',
                    totalSeconds: 0,
                    chapters: [],
                };
                moduleMap.set(mKey, mod);
            }
            mod.totalSeconds += r.totalSeconds;
            const cKey = `${mKey}:${r.chapterId}`;
            let ch = chapterMap.get(cKey);
            if (!ch) {
                ch = {
                    chapterId: r.chapterId,
                    title: chapterTitle.get(r.chapterId) ?? 'Untitled chapter',
                    totalSeconds: 0,
                    sections: [],
                };
                chapterMap.set(cKey, ch);
                mod.chapters.push(ch);
            }
            ch.totalSeconds += r.totalSeconds;
            ch.sections.push({
                sectionId: r.sectionId,
                title: sectionTitle.get(r.sectionId) ?? 'Untitled lesson',
                totalSeconds: r.totalSeconds,
            });
        }
        const modulesTree = [...moduleMap.values()];
        return {
            message: 'Time spent fetched successfully',
            statusCode: 200,
            data: {
                courseId,
                totalSeconds: courseTotal,
                modules: modulesTree,
                perSection: rows.map((r) => ({
                    ...r,
                    title: sectionTitle.get(r.sectionId) ?? 'Untitled lesson',
                })),
            },
        };
    }
    heartbeatResult(totalSeconds, creditedSeconds, frozen = false) {
        return {
            message: 'Heartbeat recorded',
            statusCode: 200,
            data: { totalSeconds, creditedSeconds, frozen },
        };
    }
};
exports.TrackingService = TrackingService;
TrackingService.MIN_INTERVAL = 5;
TrackingService.MAX_INTERVAL = 60;
TrackingService.CAP_FACTOR = 3;
TrackingService.GRACE_FACTOR = 1.5;
TrackingService.ABSOLUTE_CAP = 90;
TrackingService.SECTION_PLACE_TTL_MS = 5 * 60 * 1000;
TrackingService.NOT_FROZEN_TTL_MS = 10000;
TrackingService.SECTION_PLACE_CACHE_MAX = 2048;
TrackingService.FROZEN_CACHE_MAX = 4096;
exports.TrackingService = TrackingService = TrackingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TrackingService);
//# sourceMappingURL=tracking.service.js.map