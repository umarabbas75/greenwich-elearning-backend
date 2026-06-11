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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminDashboardController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const admin_dashboard_service_1 = require("./admin-dashboard.service");
let AdminDashboardController = class AdminDashboardController {
    constructor(dashboard) {
        this.dashboard = dashboard;
    }
    overview() {
        return this.dashboard.getOverview();
    }
    loginsToday() {
        return this.dashboard.getLoginsToday();
    }
    loginsTrend(days) {
        return this.dashboard.getLoginsTrend(this.toInt(days, 7));
    }
    logins(cursor, limit) {
        return this.dashboard.getRecentLogins({
            cursor,
            limit: this.toInt(limit, 30),
        });
    }
    loginsBreakdown(days) {
        return this.dashboard.getLoginBreakdown(this.toInt(days, 30));
    }
    activity(days, cursor, limit, userId) {
        return this.dashboard.getActivityFeed({
            days: this.toInt(days, 5),
            cursor,
            limit: this.toInt(limit, 50),
            userId,
        });
    }
    dailyActive(days) {
        return this.dashboard.getDailyActiveUsers(this.toInt(days, 7));
    }
    forumViews(days, cursor, limit, userId, threadId, scope) {
        return this.dashboard.getForumViews({
            days: this.toInt(days, 30),
            cursor,
            limit: this.toInt(limit, 50),
            userId,
            threadId,
            scope,
        });
    }
    completions(courseId, from, to, passed, cursor, limit) {
        return this.dashboard.getCompletions({
            courseId,
            from,
            to,
            passed: passed === undefined ? undefined : passed === 'true',
            cursor,
            limit: this.toInt(limit, 30),
        });
    }
    completionsByCourse() {
        return this.dashboard.getCompletionsByCourse();
    }
    engagementCohorts() {
        return this.dashboard.getEngagementCohorts();
    }
    engagementSent(from, to, cursor, limit) {
        return this.dashboard.getEngagementSent({
            from,
            to,
            cursor,
            limit: this.toInt(limit, 30),
        });
    }
    passwordEvents(from, to, cursor, limit) {
        return this.dashboard.getPasswordEvents({
            from,
            to,
            cursor,
            limit: this.toInt(limit, 30),
        });
    }
    pendingFirstLogin() {
        return this.dashboard.getPendingFirstLogin();
    }
    recentAccounts(days) {
        return this.dashboard.getRecentAccounts(this.toInt(days, 7));
    }
    timeLeaderboard(courseId, limit) {
        return this.dashboard.getTimeLeaderboard({
            courseId,
            limit: this.toInt(limit, 20),
        });
    }
    toInt(value, def) {
        const n = value ? parseInt(value, 10) : NaN;
        return Number.isFinite(n) && n > 0 ? n : def;
    }
};
exports.AdminDashboardController = AdminDashboardController;
__decorate([
    (0, common_1.Get)('overview'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "overview", null);
__decorate([
    (0, common_1.Get)('logins/today'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "loginsToday", null);
__decorate([
    (0, common_1.Get)('logins/trend'),
    __param(0, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "loginsTrend", null);
__decorate([
    (0, common_1.Get)('logins'),
    __param(0, (0, common_1.Query)('cursor')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "logins", null);
__decorate([
    (0, common_1.Get)('logins/breakdown'),
    __param(0, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "loginsBreakdown", null);
__decorate([
    (0, common_1.Get)('activity'),
    __param(0, (0, common_1.Query)('days')),
    __param(1, (0, common_1.Query)('cursor')),
    __param(2, (0, common_1.Query)('limit')),
    __param(3, (0, common_1.Query)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "activity", null);
__decorate([
    (0, common_1.Get)('activity/daily-active'),
    __param(0, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "dailyActive", null);
__decorate([
    (0, common_1.Get)('forum/views'),
    __param(0, (0, common_1.Query)('days')),
    __param(1, (0, common_1.Query)('cursor')),
    __param(2, (0, common_1.Query)('limit')),
    __param(3, (0, common_1.Query)('userId')),
    __param(4, (0, common_1.Query)('threadId')),
    __param(5, (0, common_1.Query)('scope')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "forumViews", null);
__decorate([
    (0, common_1.Get)('completions'),
    __param(0, (0, common_1.Query)('courseId')),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('passed')),
    __param(4, (0, common_1.Query)('cursor')),
    __param(5, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "completions", null);
__decorate([
    (0, common_1.Get)('completions/by-course'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "completionsByCourse", null);
__decorate([
    (0, common_1.Get)('engagement/cohorts'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "engagementCohorts", null);
__decorate([
    (0, common_1.Get)('engagement/sent'),
    __param(0, (0, common_1.Query)('from')),
    __param(1, (0, common_1.Query)('to')),
    __param(2, (0, common_1.Query)('cursor')),
    __param(3, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "engagementSent", null);
__decorate([
    (0, common_1.Get)('security/password-events'),
    __param(0, (0, common_1.Query)('from')),
    __param(1, (0, common_1.Query)('to')),
    __param(2, (0, common_1.Query)('cursor')),
    __param(3, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "passwordEvents", null);
__decorate([
    (0, common_1.Get)('security/pending-first-login'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "pendingFirstLogin", null);
__decorate([
    (0, common_1.Get)('security/recent-accounts'),
    __param(0, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "recentAccounts", null);
__decorate([
    (0, common_1.Get)('leaderboards/time'),
    __param(0, (0, common_1.Query)('courseId')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AdminDashboardController.prototype, "timeLeaderboard", null);
exports.AdminDashboardController = AdminDashboardController = __decorate([
    (0, common_1.Controller)('admin/dashboard'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    __metadata("design:paramtypes", [admin_dashboard_service_1.AdminDashboardService])
], AdminDashboardController);
//# sourceMappingURL=admin-dashboard.controller.js.map