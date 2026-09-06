import { Module } from '@nestjs/common';
import { ForumThreadService } from './forum-thread.service';
import { ForumThreadController } from './forum-thread.controller';
import { ForumCategoryService } from './forum-category.service';
import { ForumCategoryController } from './forum-category.controller';
import { ForumMentionsController } from './forum-mentions.controller';
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
    ForumCategoryService,
    JwtUserStrategy,
    JwtAdminStrategy,
    JwtCombineStrategy,
  ],
  controllers: [
    ForumThreadController,
    ForumCategoryController,
    ForumMentionsController,
  ],
  exports: [ForumThreadService],
})
export class ForumModule {}
