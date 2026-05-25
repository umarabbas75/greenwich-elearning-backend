import { Module } from '@nestjs/common';
import { ForumThreadService } from './forum-thread.service';
import { ForumThreadController } from './forum-thread.controller';
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
    ForumThreadService,
    JwtUserStrategy,
    JwtAdminStrategy,
    JwtCombineStrategy,
  ],
  controllers: [ForumThreadController],
  exports: [ForumThreadService],
})
export class ForumModule {}
