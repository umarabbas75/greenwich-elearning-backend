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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScormReconcileController = void 0;
const common_1 = require("@nestjs/common");
const cron_secret_guard_1 = require("../engagement/cron-secret.guard");
const scorm_runtime_service_1 = require("./scorm-runtime.service");
const scorm_service_1 = require("./scorm.service");
let ScormReconcileController = class ScormReconcileController {
    constructor(scorm, runtime) {
        this.scorm = scorm;
        this.runtime = runtime;
    }
    importJobsGet() {
        return this.runImportJobs();
    }
    importJobsPost() {
        return this.runImportJobs();
    }
    reconcileGet() {
        return this.runReconcile();
    }
    reconcilePost() {
        return this.runReconcile();
    }
    async runImportJobs() {
        const data = await this.scorm.processImportJobsCron();
        return {
            message: 'SCORM import-job sweep completed',
            statusCode: 200,
            data,
        };
    }
    async runReconcile() {
        const data = await this.runtime.reconcileCron();
        return {
            message: 'SCORM reconcile sweep completed',
            statusCode: 200,
            data,
        };
    }
};
exports.ScormReconcileController = ScormReconcileController;
__decorate([
    (0, common_1.UseGuards)(cron_secret_guard_1.CronSecretGuard),
    (0, common_1.Get)('scorm-import-jobs'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ScormReconcileController.prototype, "importJobsGet", null);
__decorate([
    (0, common_1.UseGuards)(cron_secret_guard_1.CronSecretGuard),
    (0, common_1.Post)('scorm-import-jobs'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ScormReconcileController.prototype, "importJobsPost", null);
__decorate([
    (0, common_1.UseGuards)(cron_secret_guard_1.CronSecretGuard),
    (0, common_1.Get)('scorm-reconcile'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ScormReconcileController.prototype, "reconcileGet", null);
__decorate([
    (0, common_1.UseGuards)(cron_secret_guard_1.CronSecretGuard),
    (0, common_1.Post)('scorm-reconcile'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ScormReconcileController.prototype, "reconcilePost", null);
exports.ScormReconcileController = ScormReconcileController = __decorate([
    (0, common_1.Controller)('internal/cron'),
    __metadata("design:paramtypes", [scorm_service_1.ScormService,
        scorm_runtime_service_1.ScormRuntimeService])
], ScormReconcileController);
//# sourceMappingURL=scorm-reconcile.controller.js.map