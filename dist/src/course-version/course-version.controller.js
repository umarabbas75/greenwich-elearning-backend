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
exports.CourseVersionController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const decorator_1 = require("../decorator");
const course_version_service_1 = require("./course-version.service");
class PublishVersionDto {
}
class MigrateEnrollmentDto {
}
let CourseVersionController = class CourseVersionController {
    constructor(courseVersionService) {
        this.courseVersionService = courseVersionService;
    }
    publishVersion(admin, courseId, body) {
        return this.courseVersionService.publishNewVersion(admin.id, courseId, body?.changeNotes);
    }
    listVersions(courseId) {
        return this.courseVersionService.listVersions(courseId);
    }
    archiveVersion(admin, courseId, versionId) {
        return this.courseVersionService.archiveVersion(admin.id, courseId, versionId);
    }
    migrateLearner(admin, body) {
        return this.courseVersionService.migrateLearnerToVersion(admin.id, body.userCourseId, body.targetVersionId);
    }
};
exports.CourseVersionController = CourseVersionController;
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)(':courseId/versions/publish'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('courseId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, PublishVersionDto]),
    __metadata("design:returntype", void 0)
], CourseVersionController.prototype, "publishVersion", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Get)(':courseId/versions'),
    __param(0, (0, common_1.Param)('courseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CourseVersionController.prototype, "listVersions", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)(':courseId/versions/:versionId/archive'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('courseId')),
    __param(2, (0, common_1.Param)('versionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CourseVersionController.prototype, "archiveVersion", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('enrollments/migrate-version'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, MigrateEnrollmentDto]),
    __metadata("design:returntype", void 0)
], CourseVersionController.prototype, "migrateLearner", null);
exports.CourseVersionController = CourseVersionController = __decorate([
    (0, common_1.Controller)('courses'),
    __metadata("design:paramtypes", [course_version_service_1.CourseVersionService])
], CourseVersionController);
//# sourceMappingURL=course-version.controller.js.map