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
exports.TrackingController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const decorator_1 = require("../decorator");
const dto_1 = require("../dto");
const tracking_service_1 = require("./tracking.service");
let TrackingController = class TrackingController {
    constructor(tracking) {
        this.tracking = tracking;
    }
    heartbeat(body, user) {
        return this.tracking.heartbeat(user.id, body.sectionId, body.activeSeconds, body.intervalSeconds);
    }
    sectionAttempt(body, user) {
        return this.tracking.recordSectionAttempt(user.id, body.sectionId, body.isCorrect);
    }
    getLoginHistory(userId, limit) {
        return this.tracking.getLoginHistory(userId, limit ? parseInt(limit, 10) : undefined);
    }
    getMyLoginHistory(user, limit) {
        return this.tracking.getLoginHistory(user.id, limit ? parseInt(limit, 10) : undefined);
    }
    getUserCourseTimeSpent(userId, courseId) {
        return this.tracking.getUserCourseTimeSpent(userId, courseId);
    }
};
exports.TrackingController = TrackingController;
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('heartbeat'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.TrackingHeartbeatDto, Object]),
    __metadata("design:returntype", void 0)
], TrackingController.prototype, "heartbeat", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('section-attempt'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.SectionAttemptDto, Object]),
    __metadata("design:returntype", void 0)
], TrackingController.prototype, "sectionAttempt", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('login-history/:userId'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], TrackingController.prototype, "getLoginHistory", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('login-history'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], TrackingController.prototype, "getMyLoginHistory", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('time-spent/:userId/:courseId'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Param)('courseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], TrackingController.prototype, "getUserCourseTimeSpent", null);
exports.TrackingController = TrackingController = __decorate([
    (0, common_1.Controller)('tracking'),
    __metadata("design:paramtypes", [tracking_service_1.TrackingService])
], TrackingController);
//# sourceMappingURL=tracking.controller.js.map