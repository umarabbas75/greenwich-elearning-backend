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
const user_agent_1 = require("../utils/user-agent");
function clamp(n, lo, hi) {
    if (!Number.isFinite(n))
        return lo;
    return Math.min(Math.max(n, lo), hi);
}
let TrackingService = TrackingService_1 = class TrackingService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async heartbeat(userId, sectionId, clientActiveSeconds, clientIntervalSeconds) {
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
        const now = new Date();
        const existing = await this.prisma.sectionTimeSpent.findUnique({
            where: { userId_sectionId: { userId, sectionId } },
        });
        const interval = clamp(clientIntervalSeconds ?? TrackingService_1.MAX_INTERVAL, TrackingService_1.MIN_INTERVAL, TrackingService_1.MAX_INTERVAL);
        const perPingCap = clamp(interval * TrackingService_1.CAP_FACTOR, TrackingService_1.MIN_INTERVAL, TrackingService_1.ABSOLUTE_CAP);
        const serverGap = existing
            ? (now.getTime() - existing.lastHeartbeatAt.getTime()) / 1000
            : null;
        let credit;
        if (serverGap === null) {
            credit = 0;
        }
        else if (clientActiveSeconds != null) {
            credit = Math.max(0, Math.min(clientActiveSeconds, serverGap, perPingCap));
        }
        else {
            credit = Math.max(0, Math.min(serverGap, interval * TrackingService_1.GRACE_FACTOR));
        }
        const creditSeconds = Math.round(credit);
        const row = await this.prisma.sectionTimeSpent.upsert({
            where: { userId_sectionId: { userId, sectionId } },
            create: {
                userId,
                sectionId,
                chapterId: section.chapterId,
                moduleId,
                courseId,
                totalSeconds: creditSeconds,
                lastHeartbeatAt: now,
            },
            update: {
                totalSeconds: { increment: creditSeconds },
                lastHeartbeatAt: now,
            },
        });
        if (creditSeconds > 0) {
            await this.accrueDailyTime(userId, courseId, now, creditSeconds);
        }
        return this.heartbeatResult(row.totalSeconds);
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
    heartbeatResult(totalSeconds) {
        return {
            message: 'Heartbeat recorded',
            statusCode: 200,
            data: { totalSeconds },
        };
    }
};
exports.TrackingService = TrackingService;
TrackingService.MIN_INTERVAL = 5;
TrackingService.MAX_INTERVAL = 60;
TrackingService.CAP_FACTOR = 3;
TrackingService.GRACE_FACTOR = 1.5;
TrackingService.ABSOLUTE_CAP = 90;
exports.TrackingService = TrackingService = TrackingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TrackingService);
//# sourceMappingURL=tracking.service.js.map