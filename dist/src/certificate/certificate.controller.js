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
exports.CertificateController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const client_1 = require("@prisma/client");
const decorator_1 = require("../decorator");
const certificate_service_1 = require("./certificate.service");
let CertificateController = class CertificateController {
    constructor(certificateService) {
        this.certificateService = certificateService;
    }
    async downloadVerifiedCertificate(certificateId) {
        const { buffer, filename } = await this.certificateService.buildVerifiedCertificatePdf(certificateId);
        return new common_1.StreamableFile(Buffer.from(buffer), {
            type: 'application/pdf',
            disposition: `attachment; filename="${filename}"`,
        });
    }
    verify(certificateId) {
        return this.certificateService.verifyCertificate(certificateId);
    }
    getStudentCertificate(user, courseId) {
        return this.certificateService.getStudentCertificate(user.id, courseId);
    }
    async downloadStudentCertificate(user, courseId) {
        const { buffer, filename } = await this.certificateService.buildStudentCertificatePdf(user.id, courseId);
        return new common_1.StreamableFile(Buffer.from(buffer), {
            type: 'application/pdf',
            disposition: `attachment; filename="${filename}"`,
        });
    }
    listIssued(courseId, source, from, to, cursor, limit) {
        return this.certificateService.listIssuedCertificates({
            courseId,
            source,
            from,
            to,
            cursor,
            limit: limit ? parseInt(limit, 10) : 50,
        });
    }
};
exports.CertificateController = CertificateController;
__decorate([
    (0, common_1.Get)('verify/:certificateId/file'),
    __param(0, (0, common_1.Param)('certificateId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], CertificateController.prototype, "downloadVerifiedCertificate", null);
__decorate([
    (0, common_1.Get)('verify/:certificateId'),
    __param(0, (0, common_1.Param)('certificateId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CertificateController.prototype, "verify", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('uJwt')),
    (0, common_1.Get)('student/:courseId'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('courseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CertificateController.prototype, "getStudentCertificate", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('uJwt')),
    (0, common_1.Get)('student/:courseId/file'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('courseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], CertificateController.prototype, "downloadStudentCertificate", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Get)('admin/issued'),
    __param(0, (0, common_1.Query)('courseId')),
    __param(1, (0, common_1.Query)('source')),
    __param(2, (0, common_1.Query)('from')),
    __param(3, (0, common_1.Query)('to')),
    __param(4, (0, common_1.Query)('cursor')),
    __param(5, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], CertificateController.prototype, "listIssued", null);
exports.CertificateController = CertificateController = __decorate([
    (0, common_1.Controller)('certificates'),
    __metadata("design:paramtypes", [certificate_service_1.CertificateService])
], CertificateController);
//# sourceMappingURL=certificate.controller.js.map