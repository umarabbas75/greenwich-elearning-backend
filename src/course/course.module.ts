import { Module } from '@nestjs/common';
import { CourseService } from './course.service';
import { CourseController } from './course.controller';
import { JwtModule } from '@nestjs/jwt';
import {
  JwtAdminStrategy,
  JwtCombineStrategy,
  JwtUserStrategy,
} from '../strategy';
import { MailModule } from '../mail/mail.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { CourseVersionModule } from '../course-version/course-version.module';
import { CourseCompletionModule } from '../course-completion/course-completion.module';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [
    JwtModule.register({}),
    MailModule,
    FeedbackModule,
    CourseVersionModule,
    CourseCompletionModule,
    NotificationModule,
  ],
  providers: [
    CourseService,
    JwtUserStrategy,
    JwtAdminStrategy,
    JwtCombineStrategy,
  ],
  controllers: [CourseController],
  exports: [CourseService],
})
export class CourseModule {}
