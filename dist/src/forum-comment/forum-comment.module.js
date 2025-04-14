"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForumCommentModule = void 0;
const common_1 = require("@nestjs/common");
const forum_comment_service_1 = require("./forum-comment.service");
const forum_comment_controller_1 = require("./forum-comment.controller");
const jwt_1 = require("@nestjs/jwt");
const strategy_1 = require("../strategy");
let ForumCommentModule = class ForumCommentModule {
};
exports.ForumCommentModule = ForumCommentModule;
exports.ForumCommentModule = ForumCommentModule = __decorate([
    (0, common_1.Module)({
        imports: [jwt_1.JwtModule.register({})],
        providers: [
            forum_comment_service_1.ForumCommentService,
            strategy_1.JwtUserStrategy,
            strategy_1.JwtAdminStrategy,
            strategy_1.JwtCombineStrategy,
        ],
        controllers: [forum_comment_controller_1.ForumCommentController],
        exports: [forum_comment_service_1.ForumCommentService],
    })
], ForumCommentModule);
//# sourceMappingURL=forum-comment.module.js.map