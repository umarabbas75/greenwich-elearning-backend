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
exports.ScormLaunchController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const decorator_1 = require("../decorator");
const dto_1 = require("./dto");
const scorm_postback_guard_1 = require("./scorm-postback.guard");
const scorm_runtime_service_1 = require("./scorm-runtime.service");
let ScormLaunchController = class ScormLaunchController {
    constructor(runtime) {
        this.runtime = runtime;
    }
    launch(user, body) {
        return this.runtime.launch(user, body);
    }
    async postback(req) {
        await this.runtime.handlePostback(req.body);
        return { ok: true };
    }
    getProgress(user, courseId) {
        return this.runtime.getLearnerProgress(user.id, courseId);
    }
};
exports.ScormLaunchController = ScormLaunchController;
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('uJwt')),
    (0, common_1.Post)('launch'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.LaunchScormDto]),
    __metadata("design:returntype", void 0)
], ScormLaunchController.prototype, "launch", null);
__decorate([
    (0, common_1.UseGuards)(scorm_postback_guard_1.ScormPostbackGuard),
    (0, common_1.Post)('postback'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ScormLaunchController.prototype, "postback", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('progress'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Query)('courseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ScormLaunchController.prototype, "getProgress", null);
exports.ScormLaunchController = ScormLaunchController = __decorate([
    (0, common_1.Controller)('scorm'),
    __metadata("design:paramtypes", [scorm_runtime_service_1.ScormRuntimeService])
], ScormLaunchController);
//# sourceMappingURL=scorm-launch.controller.js.map