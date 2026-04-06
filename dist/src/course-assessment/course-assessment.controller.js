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
exports.CourseAssessmentController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const client_1 = require("@prisma/client");
const decorator_1 = require("../decorator");
const dto_1 = require("../dto");
const course_assessment_service_1 = require("./course-assessment.service");
let CourseAssessmentController = class CourseAssessmentController {
    constructor(service) {
        this.service = service;
    }
    createCategory(user, body) {
        return this.service.createCategory(user.id, body);
    }
    getCategoriesByCourse(courseId) {
        return this.service.getCategoriesByCourse(courseId);
    }
    updateCategory(id, body) {
        return this.service.updateCategory(id, body);
    }
    deleteCategory(id) {
        return this.service.deleteCategory(id);
    }
    createQuestion(user, body) {
        return this.service.createQuestion(user.id, body);
    }
    getQuestions(courseId, categoryId, difficulty, type, isActive) {
        return this.service.getQuestions(courseId, {
            categoryId,
            difficulty,
            type,
            isActive: isActive !== undefined ? isActive === 'true' : undefined,
        });
    }
    getQuestionById(id) {
        return this.service.getQuestionById(id);
    }
    updateQuestion(id, body) {
        return this.service.updateQuestion(id, body);
    }
    deleteQuestion(id, permanent) {
        return this.service.deleteQuestion(id, permanent === 'true');
    }
    createAssessment(user, body) {
        return this.service.createAssessment(user.id, body);
    }
    getAssessmentsByCourse(courseId) {
        return this.service.getAssessmentsByCourse(courseId);
    }
    getAssessmentById(id) {
        return this.service.getAssessmentById(id);
    }
    updateAssessment(id, body) {
        return this.service.updateAssessment(id, body);
    }
    activateAssessment(id) {
        return this.service.activateAssessment(id);
    }
    deactivateAssessment(id) {
        return this.service.deactivateAssessment(id);
    }
    addQuestionToAssessment(assessmentId, body) {
        return this.service.addQuestionToAssessment(assessmentId, body);
    }
    removeQuestionFromAssessment(assessmentId, questionId) {
        return this.service.removeQuestionFromAssessment(assessmentId, questionId);
    }
    reorderQuestions(assessmentId, body) {
        return this.service.reorderAssessmentQuestions(assessmentId, body);
    }
    getAdminAttempts(courseId, status, userId) {
        return this.service.getAdminAttempts(courseId, { status, userId });
    }
    getAdminAttemptDetail(id) {
        return this.service.getAdminAttemptDetail(id);
    }
    gradeAttempt(id, body) {
        return this.service.gradeAttempt(id, body);
    }
    finalizeGrade(user, id) {
        return this.service.finalizeGrade(user.id, id);
    }
    setCertificate(attemptId, userId, courseId, body) {
        return this.service.setCertificate(userId, courseId, body);
    }
    getActiveAssessmentForStudent(user, courseId) {
        return this.service.getActiveAssessmentForStudent(user.id, courseId);
    }
    startAttempt(user, body) {
        return this.service.startAttempt(user.id, body);
    }
    getAttempt(user, id) {
        return this.service.getAttempt(user.id, id);
    }
    submitAttempt(user, id, body) {
        return this.service.submitAttempt(user.id, id, body);
    }
    getStudentAttemptHistory(user, courseId) {
        return this.service.getStudentAttemptHistory(user.id, courseId);
    }
    getStudentCompletion(user, courseId) {
        return this.service.getStudentCompletion(user.id, courseId);
    }
};
exports.CourseAssessmentController = CourseAssessmentController;
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('admin/questions/categories'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.CreateQuestionCategoryDto]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "createCategory", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Get)('admin/questions/categories/:courseId'),
    __param(0, (0, common_1.Param)('courseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "getCategoriesByCourse", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Patch)('admin/questions/categories/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.UpdateQuestionCategoryDto]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "updateCategory", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Delete)('admin/questions/categories/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "deleteCategory", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('admin/questions'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.CreateQuestionDto]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "createQuestion", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Get)('admin/questions'),
    __param(0, (0, common_1.Query)('courseId')),
    __param(1, (0, common_1.Query)('categoryId')),
    __param(2, (0, common_1.Query)('difficulty')),
    __param(3, (0, common_1.Query)('type')),
    __param(4, (0, common_1.Query)('isActive')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "getQuestions", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Get)('admin/questions/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "getQuestionById", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Patch)('admin/questions/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.UpdateQuestionDto]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "updateQuestion", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Delete)('admin/questions/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('permanent')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "deleteQuestion", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('admin/assessments'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.CreateAssessmentDto]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "createAssessment", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Get)('admin/assessments'),
    __param(0, (0, common_1.Query)('courseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "getAssessmentsByCourse", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Get)('admin/assessments/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "getAssessmentById", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Patch)('admin/assessments/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.UpdateAssessmentDto]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "updateAssessment", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('admin/assessments/:id/activate'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "activateAssessment", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('admin/assessments/:id/deactivate'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "deactivateAssessment", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('admin/assessments/:id/questions'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.AddAssessmentQuestionDto]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "addQuestionToAssessment", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Delete)('admin/assessments/:id/questions/:questionId'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Param)('questionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "removeQuestionFromAssessment", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Patch)('admin/assessments/:id/questions/reorder'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.ReorderAssessmentQuestionsDto]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "reorderQuestions", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Get)('admin/attempts'),
    __param(0, (0, common_1.Query)('courseId')),
    __param(1, (0, common_1.Query)('status')),
    __param(2, (0, common_1.Query)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "getAdminAttempts", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Get)('admin/attempts/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "getAdminAttemptDetail", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Patch)('admin/attempts/:id/grade'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.GradeAttemptDto]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "gradeAttempt", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('admin/attempts/:id/finalize'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "finalizeGrade", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('admin/attempts/:attemptId/certificate'),
    __param(0, (0, common_1.Param)('attemptId')),
    __param(1, (0, common_1.Query)('userId')),
    __param(2, (0, common_1.Query)('courseId')),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, dto_1.SetCertificateDto]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "setCertificate", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('uJwt')),
    (0, common_1.Get)('student/assessments/:courseId'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('courseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "getActiveAssessmentForStudent", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('uJwt')),
    (0, common_1.Post)('student/attempts/start'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.StartAttemptDto]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "startAttempt", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('uJwt')),
    (0, common_1.Get)('student/attempts/:id'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "getAttempt", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('uJwt')),
    (0, common_1.Post)('student/attempts/:id/submit'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, dto_1.SubmitAttemptDto]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "submitAttempt", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('uJwt')),
    (0, common_1.Get)('student/attempts'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Query)('courseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "getStudentAttemptHistory", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('uJwt')),
    (0, common_1.Get)('student/completion/:courseId'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('courseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CourseAssessmentController.prototype, "getStudentCompletion", null);
exports.CourseAssessmentController = CourseAssessmentController = __decorate([
    (0, common_1.Controller)('course-assessment'),
    __metadata("design:paramtypes", [course_assessment_service_1.CourseAssessmentService])
], CourseAssessmentController);
//# sourceMappingURL=course-assessment.controller.js.map