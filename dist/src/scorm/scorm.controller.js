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
exports.ScormController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const decorator_1 = require("../decorator");
const dto_1 = require("./dto");
const scorm_service_1 = require("./scorm.service");
let ScormController = class ScormController {
    constructor(scorm) {
        this.scorm = scorm;
    }
    createPackage(admin, body) {
        return this.scorm.createPackage(admin.id, body);
    }
    getPackage(id) {
        return this.scorm.getPackage(id);
    }
    getImportStatus(admin, id) {
        return this.scorm.getImportStatus(id, admin.id);
    }
    listPackages(courseId) {
        return this.scorm.listPackages(courseId);
    }
    replacePreview(courseId) {
        return this.scorm.replacePreview(courseId);
    }
};
exports.ScormController = ScormController;
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('packages'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.CreateScormPackageDto]),
    __metadata("design:returntype", void 0)
], ScormController.prototype, "createPackage", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Get)('packages/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ScormController.prototype, "getPackage", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Get)('packages/:id/import-status'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ScormController.prototype, "getImportStatus", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Get)('courses/:courseId/packages'),
    __param(0, (0, common_1.Param)('courseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ScormController.prototype, "listPackages", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Get)('courses/:courseId/replace-preview'),
    __param(0, (0, common_1.Param)('courseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ScormController.prototype, "replacePreview", null);
exports.ScormController = ScormController = __decorate([
    (0, common_1.Controller)('scorm'),
    __metadata("design:paramtypes", [scorm_service_1.ScormService])
], ScormController);
//# sourceMappingURL=scorm.controller.js.map