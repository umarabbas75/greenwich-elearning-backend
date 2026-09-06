import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Put,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { ForumThreadService } from './forum-thread.service';

import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/decorator';
import { User } from '@prisma/client';

@Controller('forum-thread')
export class ForumThreadController {
  constructor(private readonly forumThreadService: ForumThreadService) {}

  @UseGuards(AuthGuard('cJwt'))
  @Post('/subscribe')
  subscribeForumThread(@Body() body: any, @GetUser() user: User): Promise<any> {
    return this.forumThreadService.subscribeForumThread(body, user.id);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Delete('/subscribe/:id')
  unSubscribeForumThread(
    @Param() params: any,
    @GetUser() user: User,
  ): Promise<any> {
    return this.forumThreadService.unSubscribeForumThread(params, user.id);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('/favorite')
  createFavoriteForumThread(
    @Body() body: any,
    @GetUser() user: User,
  ): Promise<any> {
    return this.forumThreadService.createFavoriteForumThread(body, user.id);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Delete('/favorite/:id')
  unFavoriteForumThread(
    @Param() params: any,
    @GetUser() user: User,
  ): Promise<any> {
    return this.forumThreadService.unFavoriteForumThread(params, user.id);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('/')
  createForumThread(@Body() body: any, @GetUser() user: User): Promise<any> {
    return this.forumThreadService.createForumThread(body, user);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/')
  async getAllForumThreads(
    @GetUser() user: User,
    @Query('categoryId') categoryId?: string,
    @Query('courseId') courseId?: string,
    @Query('q') q?: string,
    @Query('sort') sort?: string,
    @Query('tagId') tagId?: string,
    @Query('tag') tag?: string,
  ) {
    return this.forumThreadService.getAllForumThreads(user, {
      categoryId,
      courseId,
      q,
      sort,
      tagId,
      tag,
    });
  }

  @UseGuards(AuthGuard('cJwt'))
  @Delete('/:forumThreadId/attachments/:attachmentId')
  deleteForumAttachment(
    @Param('forumThreadId') forumThreadId: string,
    @Param('attachmentId') attachmentId: string,
    @GetUser() user: User,
  ) {
    return this.forumThreadService.deleteForumAttachment(
      forumThreadId,
      attachmentId,
      user,
    );
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('/:forumThreadId/vote')
  voteForumThread(
    @Param('forumThreadId') forumThreadId: string,
    @Body() body: unknown,
    @GetUser() user: User,
  ) {
    return this.forumThreadService.voteForumThread(forumThreadId, body, user);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('/:forumThreadId')
  async getForumThread(@Param() params: any, @GetUser() user: User) {
    return this.forumThreadService.getForumThread(
      params.forumThreadId,
      user,
    );
  }
  @UseGuards(AuthGuard('cJwt'))
  @Put('/update/:forumThreadId')
  updateForumThread(
    @Param() params: any,
    @Body() body: any,
    @GetUser() user: User,
  ) {
    return this.forumThreadService.updateForumThread(
      params.forumThreadId,
      body,
      user,
    );
  }

  @UseGuards(AuthGuard('cJwt'))
  @Delete('/delete/:forumThreadId')
  deleteForumThread(@Param() params: any, @GetUser() user: User): Promise<any> {
    return this.forumThreadService.deleteForumThread(
      params.forumThreadId,
      user,
    );
  }
}
