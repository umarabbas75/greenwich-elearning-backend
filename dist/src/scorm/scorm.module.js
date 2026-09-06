"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScormModule = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const course_completion_module_1 = require("../course-completion/course-completion.module");
const course_version_module_1 = require("../course-version/course-version.module");
const cron_secret_guard_1 = require("../engagement/cron-secret.guard");
const scorm_cloud_module_1 = require("../scorm-cloud/scorm-cloud.module");
const strategy_1 = require("../strategy");
const scorm_controller_1 = require("./scorm.controller");
const scorm_launch_controller_1 = require("./scorm-launch.controller");
const scorm_postback_guard_1 = require("./scorm-postback.guard");
const scorm_reconcile_controller_1 = require("./scorm-reconcile.controller");
const scorm_runtime_service_1 = require("./scorm-runtime.service");
const scorm_service_1 = require("./scorm.service");
let ScormModule = class ScormModule {
};
exports.ScormModule = ScormModule;
exports.ScormModule = ScormModule = __decorate([
    (0, common_1.Module)({
        imports: [
            jwt_1.JwtModule.register({}),
            scorm_cloud_module_1.ScormCloudModule,
            course_completion_module_1.CourseCompletionModule,
            course_version_module_1.CourseVersionModule,
        ],
        controllers: [
            scorm_controller_1.ScormController,
            scorm_launch_controller_1.ScormLaunchController,
            scorm_reconcile_controller_1.ScormReconcileController,
        ],
        providers: [
            scorm_service_1.ScormService,
            scorm_runtime_service_1.ScormRuntimeService,
            scorm_postback_guard_1.ScormPostbackGuard,
            cron_secret_guard_1.CronSecretGuard,
            strategy_1.JwtUserStrategy,
            strategy_1.JwtAdminStrategy,
            strategy_1.JwtCombineStrategy,
        ],
    })
], ScormModule);
//# sourceMappingURL=scorm.module.js.map