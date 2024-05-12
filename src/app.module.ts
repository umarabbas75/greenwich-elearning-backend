import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CourseModule } from './course/course.module';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuizModule } from './quiz/quiz.module';
import { ForumModule } from './forum-thread/forum.module';
import { ForumCommentModule } from './forum-comment/forum-comment.module';
import { TodoModule } from './todo/todo.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CourseModule,
    UserModule,
    AuthModule,
    QuizModule,
    TodoModule,
    ForumModule,
    ForumCommentModule,
  ],
})
export class AppModule {}
