"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForumModule = void 0;
const common_1 = require("@nestjs/common");
const forum_thread_service_1 = require("./forum-thread.service");
const forum_thread_controller_1 = require("./forum-thread.controller");
const jwt_1 = require("@nestjs/jwt");
const strategy_1 = require("../strategy");
let ForumModule = class ForumModule {
};
exports.ForumModule = ForumModule;
exports.ForumModule = ForumModule = __decorate([
    (0, common_1.Module)({
        imports: [jwt_1.JwtModule.register({})],
        providers: [
            forum_thread_service_1.ForumThreadService,
            strategy_1.JwtUserStrategy,
            strategy_1.JwtAdminStrategy,
            strategy_1.JwtCombineStrategy,
        ],
        controllers: [forum_thread_controller_1.ForumThreadController],
        exports: [forum_thread_service_1.ForumThreadService],
    })
], ForumModule);
//# sourceMappingURL=forum.module.js.map