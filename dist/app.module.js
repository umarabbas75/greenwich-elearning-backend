"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const course_module_1 = require("./course/course.module");
const user_module_1 = require("./user/user.module");
const auth_module_1 = require("./auth/auth.module");
const prisma_module_1 = require("./prisma/prisma.module");
const quiz_module_1 = require("./quiz/quiz.module");
const forum_module_1 = require("./forum-thread/forum.module");
const forum_comment_module_1 = require("./forum-comment/forum-comment.module");
const todo_module_1 = require("./todo/todo.module");
const notification_module_1 = require("./notifiications/notification.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            prisma_module_1.PrismaModule,
            course_module_1.CourseModule,
            user_module_1.UserModule,
            auth_module_1.AuthModule,
            quiz_module_1.QuizModule,
            todo_module_1.TodoModule,
            forum_module_1.ForumModule,
            notification_module_1.NotificationModule,
            forum_comment_module_1.ForumCommentModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map