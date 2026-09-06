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
exports.ForumCommentController = void 0;
const common_1 = require("@nestjs/common");
const forum_comment_service_1 = require("./forum-comment.service");
const passport_1 = require("@nestjs/passport");
const decorator_1 = require("../decorator");
let ForumCommentController = class ForumCommentController {
    constructor(forumThreadService) {
        this.forumThreadService = forumThreadService;
    }
    createForumThreadComment(body, user) {
        return this.forumThreadService.createForumThreadComment(body, user);
    }
    acceptForumComment(id, user, body) {
        return this.forumThreadService.acceptForumComment(id, user, body);
    }
    voteForumComment(id, body, user) {
        return this.forumThreadService.voteForumComment(id, body, user);
    }
    async getForumCommentsByThreadId(forumThreadId, user, sort) {
        return this.forumThreadService.getForumCommentsByThreadId(forumThreadId, user, sort);
    }
    async updateForumThreadComment(forumThreadId, body, user) {
        return this.forumThreadService.updateForumThreadComment(forumThreadId, body, user);
    }
    async deleteForumThreadComment(forumThreadId, user) {
        return this.forumThreadService.deleteForumThreadComment(forumThreadId, user);
    }
};
exports.ForumCommentController = ForumCommentController;
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('/'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ForumCommentController.prototype, "createForumThreadComment", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('/:id/accept'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, decorator_1.GetUser)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], ForumCommentController.prototype, "acceptForumComment", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('/:id/vote'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], ForumCommentController.prototype, "voteForumComment", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/:forumThreadId'),
    __param(0, (0, common_1.Param)('forumThreadId')),
    __param(1, (0, decorator_1.GetUser)()),
    __param(2, (0, common_1.Query)('sort')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], ForumCommentController.prototype, "getForumCommentsByThreadId", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Put)('/:forumThreadId'),
    __param(0, (0, common_1.Param)('forumThreadId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], ForumCommentController.prototype, "updateForumThreadComment", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Delete)('/:forumThreadId'),
    __param(0, (0, common_1.Param)('forumThreadId')),
    __param(1, (0, decorator_1.GetUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ForumCommentController.prototype, "deleteForumThreadComment", null);
exports.ForumCommentController = ForumCommentController = __decorate([
    (0, common_1.Controller)('forum-thread-comment'),
    __metadata("design:paramtypes", [forum_comment_service_1.ForumCommentService])
], ForumCommentController);
//# sourceMappingURL=forum-comment.controller.js.map