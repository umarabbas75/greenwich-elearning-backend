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
exports.ForumThreadController = void 0;
const common_1 = require("@nestjs/common");
const forum_thread_service_1 = require("./forum-thread.service");
const passport_1 = require("@nestjs/passport");
const decorator_1 = require("../decorator");
let ForumThreadController = class ForumThreadController {
    constructor(forumThreadService) {
        this.forumThreadService = forumThreadService;
    }
    subscribeForumThread(body, user) {
        return this.forumThreadService.subscribeForumThread(body, user.id);
    }
    unSubscribeForumThread(params, user) {
        return this.forumThreadService.unSubscribeForumThread(params, user.id);
    }
    createFavoriteForumThread(body, user) {
        return this.forumThreadService.createFavoriteForumThread(body, user.id);
    }
    unFavoriteForumThread(params, user) {
        return this.forumThreadService.unFavoriteForumThread(params, user.id);
    }
    createForumThread(body, user) {
        return this.forumThreadService.createForumThread(body, user);
    }
    async getAllForumThreads(user, categoryId, courseId, q, sort, tagId, tag) {
        return this.forumThreadService.getAllForumThreads(user, {
            categoryId,
            courseId,
            q,
            sort,
            tagId,
            tag,
        });
    }
    deleteForumAttachment(forumThreadId, attachmentId, user) {
        return this.forumThreadService.deleteForumAttachment(forumThreadId, attachmentId, user);
    }
    voteForumThread(forumThreadId, body, user) {
        return this.forumThreadService.voteForumThread(forumThreadId, body, user);
    }
    async getForumThread(params, user) {
        return this.forumThreadService.getForumThread(params.forumThreadId, user);
    }
    updateForumThread(params, body, user) {
        return this.forumThreadService.updateForumThread(params.forumThreadId, body, user);
    }
    deleteForumThread(params, user) {
        return this.forumThreadService.deleteForumThread(params.forumThreadId, user);
    }
};
exports.ForumThreadController = ForumThreadController;
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('/subscribe'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ForumThreadController.prototype, "subscribeForumThread", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Delete)('/subscribe/:id'),
    __param(0, (0, common_1.Param)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ForumThreadController.prototype, "unSubscribeForumThread", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('/favorite'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ForumThreadController.prototype, "createFavoriteForumThread", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Delete)('/favorite/:id'),
    __param(0, (0, common_1.Param)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ForumThreadController.prototype, "unFavoriteForumThread", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('/'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ForumThreadController.prototype, "createForumThread", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Query)('categoryId')),
    __param(2, (0, common_1.Query)('courseId')),
    __param(3, (0, common_1.Query)('q')),
    __param(4, (0, common_1.Query)('sort')),
    __param(5, (0, common_1.Query)('tagId')),
    __param(6, (0, common_1.Query)('tag')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], ForumThreadController.prototype, "getAllForumThreads", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Delete)('/:forumThreadId/attachments/:attachmentId'),
    __param(0, (0, common_1.Param)('forumThreadId')),
    __param(1, (0, common_1.Param)('attachmentId')),
    __param(2, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], ForumThreadController.prototype, "deleteForumAttachment", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('/:forumThreadId/vote'),
    __param(0, (0, common_1.Param)('forumThreadId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], ForumThreadController.prototype, "voteForumThread", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/:forumThreadId'),
    __param(0, (0, common_1.Param)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ForumThreadController.prototype, "getForumThread", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Put)('/update/:forumThreadId'),
    __param(0, (0, common_1.Param)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], ForumThreadController.prototype, "updateForumThread", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Delete)('/delete/:forumThreadId'),
    __param(0, (0, common_1.Param)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ForumThreadController.prototype, "deleteForumThread", null);
exports.ForumThreadController = ForumThreadController = __decorate([
    (0, common_1.Controller)('forum-thread'),
    __metadata("design:paramtypes", [forum_thread_service_1.ForumThreadService])
], ForumThreadController);
//# sourceMappingURL=forum-thread.controller.js.map