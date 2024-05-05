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
exports.QuizController = void 0;
const common_1 = require("@nestjs/common");
const quiz_service_1 = require("./quiz.service");
const dto_1 = require("../dto");
const passport_1 = require("@nestjs/passport");
const decorator_1 = require("../decorator");
let QuizController = class QuizController {
    constructor(appService) {
        this.appService = appService;
    }
    getQuiz(params, user) {
        return this.appService.getQuiz(params.id, user.role);
    }
    getAllQuizzes(user) {
        return this.appService.getAllQuizzes(user.role);
    }
    getAllAssignQuizzes(params, user) {
        return this.appService.getAllAssignQuizzes(params.id, user.role);
    }
    createQuiz(body) {
        return this.appService.createQuiz(body);
    }
    updateQuiz(body, params) {
        return this.appService.updateQuiz(params.id, body);
    }
    deleteQuiz(params) {
        return this.appService.deleteQuiz(params.id);
    }
    assignQuiz(params) {
        return this.appService.assignQuiz(params.quizId, params.chapterId);
    }
    checkQuiz(body, user) {
        return this.appService.checkQuiz(user.id, body);
    }
    getUserQuizAnswers(params, user) {
        return this.appService.getUserQuizAnswers(user.id, params.id);
    }
};
exports.QuizController = QuizController;
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/:id'),
    __param(0, (0, common_1.Param)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto, Object]),
    __metadata("design:returntype", Promise)
], QuizController.prototype, "getQuiz", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/'),
    __param(0, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], QuizController.prototype, "getAllQuizzes", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/getAllAssignQuizzes/:id'),
    __param(0, (0, common_1.Param)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto, Object]),
    __metadata("design:returntype", Promise)
], QuizController.prototype, "getAllAssignQuizzes", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('/'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.QuizDto]),
    __metadata("design:returntype", Promise)
], QuizController.prototype, "createQuiz", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Put)('/:id'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.UpdateQuizDto,
        dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], QuizController.prototype, "updateQuiz", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Delete)('/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], QuizController.prototype, "deleteQuiz", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Put)('/assignQuiz/:quizId/:chapterId'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.AssignQuizDto]),
    __metadata("design:returntype", Promise)
], QuizController.prototype, "assignQuiz", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('uJwt')),
    (0, common_1.Post)('/checkQuiz/'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CheckQuiz, Object]),
    __metadata("design:returntype", Promise)
], QuizController.prototype, "checkQuiz", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('uJwt')),
    (0, common_1.Get)('/user/getQuizAnswers/:id'),
    __param(0, (0, common_1.Param)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto, Object]),
    __metadata("design:returntype", Promise)
], QuizController.prototype, "getUserQuizAnswers", null);
exports.QuizController = QuizController = __decorate([
    (0, common_1.Controller)('quizzes'),
    __metadata("design:paramtypes", [quiz_service_1.QuizService])
], QuizController);
//# sourceMappingURL=quiz.controller.js.map