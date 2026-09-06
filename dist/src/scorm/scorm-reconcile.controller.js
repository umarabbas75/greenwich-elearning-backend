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
const engagement_service_1 = require("../engagement/engagement.service");
const error_message_1 = require("../utils/error-message");
const scorm_runtime_service_1 = require("./scorm-runtime.service");
const scorm_service_1 = require("./scorm.service");
let ScormReconcileController = class ScormReconcileController {
    constructor(scorm, runtime, engagement) {
        this.scorm = scorm;
        this.runtime = runtime;
        this.engagement = engagement;
    }
    dailyGet() {
        return this.runDaily();
    }
    dailyPost() {
        return this.runDaily();
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
    pruneSupersededGet() {
        return this.runPruneSuperseded();
    }
    pruneSupersededPost() {
        return this.runPruneSuperseded();
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
    async runPruneSuperseded() {
        const data = await this.runtime.pruneSupersededPackagesCron();
        return {
            message: 'SCORM superseded-package prune completed',
            statusCode: 200,
            data,
        };
    }
    async runDaily() {
        const data = {
            engagement: await this.runSettled(() => this.engagement.runSweep()),
            importJobs: await this.runSettled(() => this.scorm.processImportJobsCron()),
            reconcile: await this.runSettled(() => this.runtime.reconcileCron()),
            pruneSuperseded: await this.runSettled(() => this.runtime.pruneSupersededPackagesCron()),
        };
        return {
            message: 'Daily cron sweep completed',
            statusCode: 200,
            data,
        };
    }
    async runSettled(fn) {
        try {
            return await fn();
        }
        catch (err) {
            return { error: (0, error_message_1.errorMessage)(err) };
        }
    }
};
exports.ScormReconcileController = ScormReconcileController;
__decorate([
    (0, common_1.UseGuards)(cron_secret_guard_1.CronSecretGuard),
    (0, common_1.Get)('daily'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ScormReconcileController.prototype, "dailyGet", null);
__decorate([
    (0, common_1.UseGuards)(cron_secret_guard_1.CronSecretGuard),
    (0, common_1.Post)('daily'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ScormReconcileController.prototype, "dailyPost", null);
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
__decorate([
    (0, common_1.UseGuards)(cron_secret_guard_1.CronSecretGuard),
    (0, common_1.Get)('scorm-prune-superseded'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ScormReconcileController.prototype, "pruneSupersededGet", null);
__decorate([
    (0, common_1.UseGuards)(cron_secret_guard_1.CronSecretGuard),
    (0, common_1.Post)('scorm-prune-superseded'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ScormReconcileController.prototype, "pruneSupersededPost", null);
exports.ScormReconcileController = ScormReconcileController = __decorate([
    (0, common_1.Controller)('internal/cron'),
    __metadata("design:paramtypes", [scorm_service_1.ScormService,
        scorm_runtime_service_1.ScormRuntimeService,
        engagement_service_1.EngagementService])
], ScormReconcileController);
//# sourceMappingURL=scorm-reconcile.controller.js.map