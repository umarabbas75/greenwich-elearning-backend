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
const course_category_service_1 = require("./course-category.service");
const decorator_1 = require("../decorator");
const passport_1 = require("@nestjs/passport");
let CourseController = class CourseController {
    constructor(appService, categories) {
        this.appService = appService;
        this.categories = categories;
    }
    markFormComplete(user, body) {
        return this.appService.markFormComplete(user.id, user.role, body.courseId, body.formId, body.metaData, body.courseFormId, body.changesRequestedAt);
    }
    updateFormMetadata(user, body) {
        return this.appService.updateFormMetadata(user.id, user.role, body.userId, body.courseId, body.formId, body.courseFormId, body.metaData, body.submissionCompletedAt);
    }
    requestFormChanges(user, body) {
        return this.appService.requestFormChanges({
            adminId: user.id,
            adminRole: user.role,
            learnerUserId: body.userId,
            courseId: body.courseId,
            formId: body.formId,
            courseFormId: body.courseFormId,
            comments: body.comments,
            submissionCompletedAt: body.submissionCompletedAt,
        });
    }
    markPolicyItemAsComplete(user, body) {
        return this.appService.markPolicyItemAsComplete({
            userId: user?.id,
            userRole: user?.role,
            courseId: body.courseId,
            policyId: body.policyId,
            policyItemId: body.policyItemId,
        });
    }
    getAllPublicCourses() {
        return this.appService.getAllPublicCourses();
    }
    getCourseDetailPublic(params) {
        return this.appService.getCourseDetailPublic(params.id);
    }
    getCourseReport(params) {
        return this.appService.getCourseReport(params.courseId, params.userId);
    }
    getCourseDates(params) {
        return this.appService.getCourseDates(params.courseId, params.userId);
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
    deletePolicies(admin) {
        return this.appService.deletePolicies(admin.id);
    }
    getUserPolicies(user) {
        return this.appService.getUserPolicies(user?.id);
    }
    getUserPolicyCompletions(user, params) {
        return this.appService.getUserPolicyCompletions({
            userId: user?.id,
            courseId: params?.courseId,
        });
    }
    getCourseFormsStatus(user, courseId) {
        return this.appService.getStudentCourseFormsStatus(user.id, user.role, courseId);
    }
    updatePost(body, id) {
        return this.appService.updatePost(id, body);
    }
    deletePost(id) {
        return this.appService.deletePost(id);
    }
    listCourseCategories() {
        return this.categories.list();
    }
    createCourseCategory(body) {
        return this.categories.create(body);
    }
    updateCourseCategory(id, body) {
        return this.categories.update(id, body);
    }
    deleteCourseCategory(id) {
        return this.categories.remove(id);
    }
    assignCourseCategory(id, body, admin) {
        return this.categories.assign(id, body.categoryId, admin.id);
    }
    getCourse(params) {
        return this.appService.getCourse(params.id);
    }
    canAccessCourseContent(user, params) {
        return this.appService.canAccessCourseContent(user.id, params.id, user.role);
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
    getAllUserModules(params, user) {
        return this.appService.getAllUserModules(params.id, user.id);
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
    setCourseActive(params, body, admin) {
        return this.appService.setCourseActive(params.id, body.isActive, admin.id);
    }
    createCourse(body, admin) {
        return this.appService.createCourse(body, admin.id);
    }
    updateCourse(body, params, admin) {
        return this.appService.updateCourse(params.id, body, admin.id);
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
    updateSectionOrder(body) {
        return this.appService.updateSectionOrder(body);
    }
    assignCourse(params) {
        return this.appService.assignCourse(params.userId, params.courseId);
    }
    assignCoursePublic(params) {
        return this.appService.assignCoursePublic(params.userId, params.courseId);
    }
    unAssignCourse(admin, body) {
        return this.appService.unAssignCourse(body.userId, body.courseId, {
            force: body?.force === true,
            adminId: admin?.id,
        });
    }
    toggleCourseStatus(body) {
        return this.appService.toggleCourseStatus(body.userId, body.courseId, body.isActive);
    }
    toggleCoursePaymentStatus(body) {
        return this.appService.toggleCoursePaymentStatus(body.userId, body.courseId, body.isPaid);
    }
    getAllAssignedCourses(params, user) {
        return this.appService.getAllAssignedCourses(params.id, user.role);
    }
    getAllAssignedCoursesPublic(params) {
        return this.appService.getAllAssignedCoursesPublic(params.id);
    }
    createModule(user, body) {
        return this.appService.createModule(body, user.id);
    }
    createChapter(user, body) {
        return this.appService.createChapter(body, user.id);
    }
    createSection(user, body) {
        return this.appService.createSection(body, user.id);
    }
    getCourseDeletionPreview(params) {
        return this.appService.getCourseDeletionPreview(params.id);
    }
    deleteCourse(user, params, force) {
        return this.appService.deleteCourse(params.id, {
            force: force === 'true' || force === '1',
            adminId: user?.id,
        });
    }
    deleteModule(user, params) {
        return this.appService.deleteModule(params.id, user.id);
    }
    deleteChapter(user, params) {
        return this.appService.deleteChapter(params.id, user.id);
    }
    deleteSection(user, params) {
        return this.appService.deleteSection(params.id, user.id);
    }
    restoreModule(user, params) {
        return this.appService.restoreModule(params.id, user.id);
    }
    restoreChapter(user, params) {
        return this.appService.restoreChapter(params.id, user.id);
    }
    restoreSection(user, params) {
        return this.appService.restoreSection(params.id, user.id);
    }
    getArchivedInventory(courseId, page, pageSize, entityType, search, sort) {
        return this.appService.getArchivedInventory(courseId, {
            page: page ? parseInt(page, 10) : undefined,
            pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
            entityType,
            search,
            sort,
        });
    }
    updateUserChapterProgress(body, user) {
        return this.appService.updateUserChapterProgress(user.id, body, user.email);
    }
    getUserChapterProgress(params) {
        return this.appService.getUserChapterProgress(params.userId, params.courseId, params.chapterId);
    }
    getLastSeen(param) {
        return this.appService.getLastSeenSection(param.userId, param.chapterId);
    }
    updateLastSeen(body, user) {
        return this.appService.updateLastSeenSection(user.id, body.chapterId, body.sectionId, body.moduleId, body.courseId, user.email);
    }
    async submitCourseFeedback(user, courseId, body) {
        return this.appService.submitCourseFeedback(user.id, courseId, body);
    }
    async getCourseFeedbackStatus(user, courseId) {
        return this.appService.getCourseFeedbackStatus(user.id, courseId);
    }
    async getCourseFeedbackSubmissions(user, courseId) {
        return this.appService.getCourseFeedbackSubmissions(courseId, user.id);
    }
    resetUserCourseProgress(admin, body) {
        return this.appService.resetUserCourseProgress(admin.id, body.userId, body.courseId);
    }
};
exports.CourseController = CourseController;
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('/markFormComplete'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.MarkFormCompleteDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "markFormComplete", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('/updateFormMetadata'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.UpdateFormMetadataDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "updateFormMetadata", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('/requestFormChanges'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.RequestFormChangesDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "requestFormChanges", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('/markPolicyComplete'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "markPolicyItemAsComplete", null);
__decorate([
    (0, common_1.Get)('/public'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getAllPublicCourses", null);
__decorate([
    (0, common_1.Get)('/public/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getCourseDetailPublic", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/report/:courseId/:userId'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getCourseReport", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/report/dates/:courseId/:userId'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getCourseDates", null);
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
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/post/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getPost", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
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
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Delete)('/policies/delete'),
    __param(0, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
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
    (0, common_1.Get)('/getUserPolicyCompletions/:courseId'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getUserPolicyCompletions", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/:courseId/forms/status'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('courseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getCourseFormsStatus", null);
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
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Get)('/categories'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "listCourseCategories", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('/categories'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateCourseCategoryDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "createCourseCategory", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Patch)('/categories/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.UpdateCourseCategoryDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "updateCourseCategory", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Delete)('/categories/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "deleteCourseCategory", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Put)('/:id/category'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.AssignCourseCategoryDto, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "assignCourseCategory", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getCourse", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/canAccessCourseContent/:id'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "canAccessCourseContent", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/module/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getModule", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/chapter/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getChapter", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/section/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getSection", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getAllCourses", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/allModules/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getAllModules", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/user/allModules/:id'),
    __param(0, (0, common_1.Param)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getAllUserModules", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/module/allChapters/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getAllChapters", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
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
    (0, common_1.Patch)('/admin/:id/active'),
    __param(0, (0, common_1.Param)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto,
        dto_1.SetCourseActiveDto, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "setCourseActive", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('/'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CourseDto, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "createCourse", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Put)('/:id'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Param)()),
    __param(2, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CourseDto,
        dto_1.ParamsDto, Object]),
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
    __metadata("design:paramtypes", [Object, dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "updateSection", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Put)('/sections/updateOrder'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.UpdateSectionOrderDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "updateSectionOrder", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Put)('/assignCourse/:userId/:courseId'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.AssignCourseDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "assignCourse", null);
__decorate([
    (0, common_1.Put)('/assignCourse/public/:userId/:courseId'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "assignCoursePublic", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Put)('/unAssignCourse/user'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "unAssignCourse", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Put)('/updateStatus/user'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "toggleCourseStatus", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Put)('/updatePayment/user'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "toggleCoursePaymentStatus", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/getAllAssignedCourses/:id'),
    __param(0, (0, common_1.Param)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getAllAssignedCourses", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/getAllAssignedCourses/public/:id'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getAllAssignedCoursesPublic", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('/module'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.ModuleDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "createModule", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('/chapter'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.ModuleDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "createChapter", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('/section'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "createSection", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Get)('/:id/deletion-preview'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getCourseDeletionPreview", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Delete)('/:id'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)()),
    __param(2, (0, common_1.Query)('force')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.ParamsDto, String]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "deleteCourse", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Delete)('/module/:id'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "deleteModule", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Delete)('/chapter/:id'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "deleteChapter", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Delete)('/section/:id'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "deleteSection", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('/module/:id/restore'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "restoreModule", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('/chapter/:id/restore'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "restoreChapter", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('/section/:id/restore'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.ParamsDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "restoreSection", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Get)('/:courseId/archived'),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('pageSize')),
    __param(3, (0, common_1.Query)('entityType')),
    __param(4, (0, common_1.Query)('search')),
    __param(5, (0, common_1.Query)('sort')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getArchivedInventory", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('uJwtLite')),
    (0, common_1.Put)('/updateUserChapter/progress'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "updateUserChapterProgress", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/getUserChapterProgress/:userId/:courseId/:chapterId'),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.AssignCourseDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getUserChapterProgress", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
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
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], CourseController.prototype, "updateLastSeen", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('/:courseId/feedback'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('courseId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "submitCourseFeedback", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/:courseId/feedback-status'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('courseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getCourseFeedbackStatus", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/:courseId/feedback-submissions'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('courseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "getCourseFeedbackSubmissions", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.Post)('/testing/resetUserCourseProgress'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.ResetUserCourseProgressDto]),
    __metadata("design:returntype", Promise)
], CourseController.prototype, "resetUserCourseProgress", null);
exports.CourseController = CourseController = __decorate([
    (0, common_1.Controller)('courses'),
    __metadata("design:paramtypes", [course_service_1.CourseService,
        course_category_service_1.CourseCategoryService])
], CourseController);
//# sourceMappingURL=course.controller.js.map