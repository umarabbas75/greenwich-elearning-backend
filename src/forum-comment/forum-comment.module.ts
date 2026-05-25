import { Module } from '@nestjs/common';
import { ForumCommentService } from './forum-comment.service';
import { ForumCommentController } from './forum-comment.controller';
import { JwtModule } from '@nestjs/jwt';
import {
  JwtAdminStrategy,
  JwtCombineStrategy,
  JwtUserStrategy,
} from '../strategy';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [JwtModule.register({}), NotificationModule],
  providers: [
    ForumCommentService,
    JwtUserStrategy,
    JwtAdminStrategy,
    JwtCombineStrategy,
  ],
  controllers: [ForumCommentController],
  exports: [ForumCommentService],
})
export class ForumCommentModule {}
