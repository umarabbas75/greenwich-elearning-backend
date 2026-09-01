"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CourseCompletionModule = void 0;
const common_1 = require("@nestjs/common");
const course_completion_service_1 = require("./course-completion.service");
const prisma_module_1 = require("../prisma/prisma.module");
const mail_module_1 = require("../mail/mail.module");
const feedback_module_1 = require("../feedback/feedback.module");
const course_version_module_1 = require("../course-version/course-version.module");
const certificate_module_1 = require("../certificate/certificate.module");
let CourseCompletionModule = class CourseCompletionModule {
};
exports.CourseCompletionModule = CourseCompletionModule;
exports.CourseCompletionModule = CourseCompletionModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, mail_module_1.MailModule, feedback_module_1.FeedbackModule, course_version_module_1.CourseVersionModule, certificate_module_1.CertificateModule],
        providers: [course_completion_service_1.CourseCompletionService],
        exports: [course_completion_service_1.CourseCompletionService],
    })
], CourseCompletionModule);
//# sourceMappingURL=course-completion.module.js.map