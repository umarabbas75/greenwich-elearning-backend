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
const crypto_1 = require("crypto");
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const platform_express_1 = require("@nestjs/platform-express");
const decorator_1 = require("../decorator");
const dto_1 = require("./dto");
const scorm_service_1 = require("./scorm.service");
const MAX_SCORM_ZIP_BYTES = 50 * 1024 * 1024;
const ZIP_MIME_TYPES = new Set([
    'application/zip',
    'application/x-zip-compressed',
    'multipart/x-zip',
    'application/octet-stream',
]);
let ScormController = class ScormController {
    constructor(scorm) {
        this.scorm = scorm;
    }
    createPackage(admin, body) {
        return this.scorm.createPackage(admin.id, body);
    }
    createPackageUpload(admin, file, body) {
        if (!file?.buffer?.length) {
            throw new common_1.BadRequestException('Multipart field "file" is required (SCORM .zip package)');
        }
        const name = file.originalname?.toLowerCase() ?? '';
        const mimeOk = file.mimetype ? ZIP_MIME_TYPES.has(file.mimetype) : false;
        if (!mimeOk && !name.endsWith('.zip')) {
            throw new common_1.BadRequestException('Upload must be a .zip SCORM package (application/zip)');
        }
        const zipSha256 = body.zipSha256?.trim() ||
            (0, crypto_1.createHash)('sha256').update(file.buffer).digest('hex');
        return this.scorm.createPackageFromUpload(admin.id, file.buffer, {
            ...body,
            zipSha256,
            filename: file.originalname || 'package.zip',
        });
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
    (0, common_1.Post)('packages/upload'),
    (0, common_1.HttpCode)(200),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', { limits: { fileSize: MAX_SCORM_ZIP_BYTES } })),
    (0, common_1.UsePipes)(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
    })),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.UploadedFile)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, dto_1.CreateScormPackageUploadDto]),
    __metadata("design:returntype", void 0)
], ScormController.prototype, "createPackageUpload", null);
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