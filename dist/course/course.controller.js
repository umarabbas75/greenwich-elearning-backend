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
exports.CourseController = void 0;
const common_1 = require("@nestjs/common");
const course_service_1 = require("./course.service");
const dto_1 = require("../dto");
const decorator_1 = require("../decorator");
const passport_1 = require("@nestjs/passport");
let CourseController = class CourseController {
    constructor(appService) {
        this.appService = appService;
    }
    getCourseReport(params) {
        return this.appService.getCourseReport(params.courseId);
    }
    createPostComment(params, user, body) {
        return this.appService.createPostComment(params.postId, user?.id, body);
    }
    getPostComments(params) {
        return this.appService.getPostComments(params.postId);
    }
    updatePostComment(params, body) {
        return this.appService.updatePostComment(params?.postId, params?.commentId, body);
    }
    deletePostComment(params) {
        return this.appService.deletePostComment(params.postId, params.commentId);
    }
    getPost(id) {
        return this.appService.getPost(id);
    }
    getAllPosts(params) {
        return this.appService.getAllPosts(params.courseId);
    }
    createPost(params, user, body) {
        return this.appService.createPost(params.courseId, user?.id, body);
    }
    createPolicies(user, body) {
        return this.appService.createPolicies(user?.id, body);
    }
    deletePolicies() {
        return this.appService.deletePolicies();
    }
    getUserPolicies(user) {
        return this.appService.getUserPolicies(user?.id);
    }
    updatePost(body, id) {
        return this.appService.updatePost(id, body);
    }
    deletePost(id) {
        return this.appService.deletePost(id);
    }
    getCourse(params) {
        return this.appService.getCourse(params.id);
    }
    getModule(params) {
        return this.appService.getModule(params.id);
    }
    getChapter(params) {
        return this.appService.getChapter(params.id);
    }
    getSection(params) {
        return this.appService.getSection(params.id);
    }
    getAllCourses() {
        return this.appService.getAllCourses();
    }
    getAllModules(params) {
        return this.appService.getAllModules(params.id);
    }
    getAllUserModules(params) {
        return this.appService.getAllUserModules(params.id);
    }
    getAllChapters(params) {
        return this.appService.getAllChapters(params.id);
    }
    getAllSections(params) {
        return this.appService.getAllSections(params.id);
    }
    getAllUserSections(params, user) {
        return this.appService.getAllUserSections(params?.id, user.id, params?.courseId);
    }
    createCourse(body) {
        return this.appService.createCourse(body);
    }
    updateCourse(body, params) {
        return this.appService.updateCourse(params.id, body);
    }
    updateModule(body, params) {
        return this.appService.updateModule(params.id, body);
    }
    updateChapter(body, params) {
        return this.appService.updateChapter(params.id, body);
    }
    updateSection(body, params) {
        return this.appService.updateSection(params.id, body);
    }
    assignCourse(params) {
        return this.appService.assignCourse(params.userId, params.courseId);
    }
    getAllAssignedCourses(params) {
        return this.appService.getAllAssignedCourses(params.id);
    }
    createModule(body) {
        return this.appService.createModule(body);
    }
    createChapter(body) {
        return this.appService.createChapter(body);
    }
    createSection(body) {
        return this.appService.createSection(body);
    }
    deleteCourse(params) {
        return this.appService.deleteCourse(params.id);
    }
    deleteModule(params) {
        return this.appService.deleteModule(params.id);
    }
    deleteChapter(params) {
        return this.appService.deleteChapter(params.id);
    }
    deleteSection(params) {
        return this.appService.deleteSection(params.id);
    }
    updateUserChapterProgress(body, user) {
        return this.appService.updateUserChapterProgress(user.id, body);
    }
    getUserChapterProgress(params) {
        return this.appService.getUserChapterProgress(params.userId, params.courseId, params.chapterId);
    }
    getLastSeen(param) {
        return this.appService.getLastSeenSection(param.userId, param.chapterId);
    }
    updateLastSeen(body, user) {
        return this.appService.updateLastSeenSection(user.id, body.chapterId, body.sectionId);
    }
};
exports.CourseController = CourseController;
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/report/:courseId'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getCourseReport", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('/postComment/:postId'),
    __param(0, (0, common_1.Param)()),
    __param(1, (0, decorator_1.GetUser)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "createPostComment", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/postComment/:postId'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getPostComments", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Put)('/postComment/:postId/:commentId'),
    __param(0, (0, common_1.Param)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "updatePostComment", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Delete)('/postComment/:postId/:commentId'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "deletePostComment", null);
__decorate([
    (0, common_1.Get)('/post/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getPost", null);
__decorate([
    (0, common_1.Get)('/posts/:courseId'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getAllPosts", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('/post/:courseId'),
    __param(0, (0, common_1.Param)()),
    __param(1, (0, decorator_1.GetUser)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "createPost", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('/policies'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "createPolicies", null);
__decorate([
    (0, common_1.Delete)('/policies/delete'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "deletePolicies", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/getUserPolicies'),
    __param(0, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getUserPolicies", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Put)('/post/:id'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "updatePost", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Delete)('/post/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "deletePost", null);
__decorate([
    (0, common_1.Get)('/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getCourse", null);
__decorate([
    (0, common_1.Get)('/module/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getModule", null);
__decorate([
    (0, common_1.Get)('/chapter/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getChapter", null);
__decorate([
    (0, common_1.Get)('/section/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getSection", null);
__decorate([
    (0, common_1.Get)('/'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getAllCourses", null);
__decorate([
    (0, common_1.Get)('/allModules/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getAllModules", null);
__decorate([
    (0, common_1.Get)('/user/allModules/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getAllUserModules", null);
__decorate([
    (0, common_1.Get)('/module/allChapters/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getAllChapters", null);
__decorate([
    (0, common_1.Get)('/module/chapter/allSections/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getAllSections", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('uJwt')),
    (0, common_1.Get)('/user/module/chapter/allSections/:id/:courseId'),
    __param(0, (0, common_1.Param)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto1, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getAllUserSections", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('/'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CourseDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "createCourse", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Put)('/:id'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CourseDto,
        dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "updateCourse", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Put)('/module/:id'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.UpdateCourseDto,
        dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "updateModule", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Put)('/chapter/:id'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.UpdateCourseDto,
        dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "updateChapter", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Put)('/section/update/:id'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.UpdateCourseDto,
        dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "updateSection", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Put)('/assignCourse/:userId/:courseId'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.AssignCourseDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "assignCourse", null);
__decorate([
    (0, common_1.Get)('/getAllAssignedCourses/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getAllAssignedCourses", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('/module'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ModuleDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "createModule", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('/chapter'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ModuleDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "createChapter", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('/section'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ModuleDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "createSection", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Delete)('/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "deleteCourse", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Delete)('/module/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "deleteModule", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Delete)('/chapter/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "deleteChapter", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Delete)('/section/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "deleteSection", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('uJwt')),
    (0, common_1.Put)('/updateUserChapter/progress'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.UpdateCourseProgress, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "updateUserChapterProgress", null);
__decorate([
    (0, common_1.Get)('/getUserChapterProgress/:userId/:courseId/:chapterId'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.AssignCourseDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getUserChapterProgress", null);
__decorate([
    (0, common_1.Get)('/section/getLastSeen/:userId/:chapterId'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.GetUpdateLastSeen]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "getLastSeen", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('uJwt')),
    (0, common_1.Post)('/section/updateLastSeen/'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.UpdateLastSeen, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "updateLastSeen", null);
exports.CourseController = CourseController = __decorate([
    (0, common_1.Controller)('courses'),
    __metadata("design:paramtypes", [course_service_1.CourseService])
], CourseController);
//# sourceMappingURL=course.controller.js.map