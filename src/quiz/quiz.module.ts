import { Module } from '@nestjs/common';
import { QuizService } from './quiz.service';
import { QuizController } from './quiz.controller';
import { JwtModule } from '@nestjs/jwt';
import {
  JwtAdminStrategy,
  JwtCombineStrategy,
  JwtUserStrategy,
} from '../strategy';

import { CourseVersionModule } from '../course-version/course-version.module';
import { CourseCompletionModule } from '../course-completion/course-completion.module';

@Module({
  imports: [
    JwtModule.register({}),
    CourseVersionModule,
    CourseCompletionModule,
  ],
  providers: [
    QuizService,
    JwtUserStrategy,
    JwtAdminStrategy,
    JwtCombineStrategy,
  ],
  controllers: [QuizController],
  exports: [QuizService],
})
export class QuizModule {}
