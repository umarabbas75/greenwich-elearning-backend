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
exports.EngagementController = void 0;
const common_1 = require("@nestjs/common");
const cron_secret_guard_1 = require("./cron-secret.guard");
const engagement_service_1 = require("./engagement.service");
let EngagementController = class EngagementController {
    constructor(engagement) {
        this.engagement = engagement;
    }
    runEngagementRemindersCron() {
        return this.runSweep();
    }
    runEngagementRemindersManual() {
        return this.runSweep();
    }
    async runSweep() {
        const summary = await this.engagement.runSweep();
        return {
            message: 'Engagement reminder sweep completed',
            statusCode: 200,
            data: summary,
        };
    }
};
exports.EngagementController = EngagementController;
__decorate([
    (0, common_1.UseGuards)(cron_secret_guard_1.CronSecretGuard),
    (0, common_1.Get)('engagement-reminders'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], EngagementController.prototype, "runEngagementRemindersCron", null);
__decorate([
    (0, common_1.UseGuards)(cron_secret_guard_1.CronSecretGuard),
    (0, common_1.Post)('engagement-reminders'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], EngagementController.prototype, "runEngagementRemindersManual", null);
exports.EngagementController = EngagementController = __decorate([
    (0, common_1.Controller)('internal/cron'),
    __metadata("design:paramtypes", [engagement_service_1.EngagementService])
], EngagementController);
//# sourceMappingURL=engagement.controller.js.map