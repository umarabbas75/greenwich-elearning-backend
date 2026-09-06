import { Module } from '@nestjs/common';
import { ForumThreadService } from './forum-thread.service';
import { ForumThreadController } from './forum-thread.controller';
import { ForumCategoryService } from './forum-category.service';
import { ForumCategoryController } from './forum-category.controller';
import { ForumMentionsController } from './forum-mentions.controller';
import { ForumTagService } from './forum-tag.service';
import { ForumTagController } from './forum-tag.controller';
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
    ForumTagService,
    JwtUserStrategy,
    JwtAdminStrategy,
    JwtCombineStrategy,
  ],
  controllers: [
    ForumThreadController,
    ForumCategoryController,
    ForumMentionsController,
    ForumTagController,
  ],
  exports: [ForumThreadService],
})
export class ForumModule {}
