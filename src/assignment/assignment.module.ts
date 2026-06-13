import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import {
  JwtAdminStrategy,
  JwtCombineStrategy,
  JwtUserStrategy,
} from '../strategy';
import { AssignmentService } from './assignment.service';
import { AssignmentController } from './assignment.controller';
import { FeedbackModule } from '../feedback/feedback.module';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [JwtModule.register({}), FeedbackModule, NotificationModule],
  providers: [
    AssignmentService,
    JwtUserStrategy,
    JwtAdminStrategy,
    JwtCombineStrategy,
  ],
  controllers: [AssignmentController],
  exports: [AssignmentService],
})
export class AssignmentModule {}
