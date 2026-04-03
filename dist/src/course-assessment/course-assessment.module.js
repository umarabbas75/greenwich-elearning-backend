"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CourseAssessmentModule = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const strategy_1 = require("../strategy");
const prisma_module_1 = require("../prisma/prisma.module");
const notification_module_1 = require("../notifiications/notification.module");
const course_assessment_controller_1 = require("./course-assessment.controller");
const course_assessment_service_1 = require("./course-assessment.service");
let CourseAssessmentModule = class CourseAssessmentModule {
};
exports.CourseAssessmentModule = CourseAssessmentModule;
exports.CourseAssessmentModule = CourseAssessmentModule = __decorate([
    (0, common_1.Module)({
        imports: [jwt_1.JwtModule.register({}), prisma_module_1.PrismaModule, notification_module_1.NotificationModule],
        providers: [
            course_assessment_service_1.CourseAssessmentService,
            strategy_1.JwtUserStrategy,
            strategy_1.JwtAdminStrategy,
            strategy_1.JwtCombineStrategy,
        ],
        controllers: [course_assessment_controller_1.CourseAssessmentController],
        exports: [course_assessment_service_1.CourseAssessmentService],
    })
], CourseAssessmentModule);
//# sourceMappingURL=course-assessment.module.js.map