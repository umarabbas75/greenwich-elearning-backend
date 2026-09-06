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
exports.ForumCategoryController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const decorator_1 = require("../decorator");
const forum_category_service_1 = require("./forum-category.service");
let ForumCategoryController = class ForumCategoryController {
    constructor(categories) {
        this.categories = categories;
    }
    list(user, includeInactive) {
        return this.categories.list(user, includeInactive === 'true');
    }
    create(user, body) {
        return this.categories.create(user, body);
    }
    update(user, id, body) {
        return this.categories.update(user, id, body);
    }
    moveThreads(user, id, body) {
        return this.categories.moveThreads(user, id, body?.toCategoryId === undefined ? null : body.toCategoryId);
    }
    remove(user, id) {
        return this.categories.remove(user, id);
    }
};
exports.ForumCategoryController = ForumCategoryController;
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Get)('/'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Query)('includeInactive')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ForumCategoryController.prototype, "list", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('/'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ForumCategoryController.prototype, "create", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Patch)('/:id'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ForumCategoryController.prototype, "update", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Post)('/:id/move-threads'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ForumCategoryController.prototype, "moveThreads", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('cJwt')),
    (0, common_1.Delete)('/:id'),
    __param(0, (0, decorator_1.GetUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ForumCategoryController.prototype, "remove", null);
exports.ForumCategoryController = ForumCategoryController = __decorate([
    (0, common_1.Controller)('forum/categories'),
    __metadata("design:paramtypes", [forum_category_service_1.ForumCategoryService])
], ForumCategoryController);
//# sourceMappingURL=forum-category.controller.js.map