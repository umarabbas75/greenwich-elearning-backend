import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Put,
  Param,
  Delete,
} from '@nestjs/common';
import { ForumThreadService } from './forum-thread.service';

import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/decorator';
import { User } from '@prisma/client';
// import { GetUser } from '../decorator';
// import { User } from '@prisma/client';

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
    return this.forumThreadService.createForumThread(body, user.id);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/')
  async getAllForumThreads(@GetUser() user: User) {
    return this.forumThreadService.getAllForumThreads(user);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('/:forumThreadId')
  async getForumThread(@Param() params: any) {
    return this.forumThreadService.getForumThread(params.forumThreadId);
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
      user?.id,
    );
  }

  @UseGuards(AuthGuard('cJwt'))
  @Delete('/delete/:forumThreadId')
  deleteForumThread(@Param() params: any): Promise<any> {
    return this.forumThreadService.deleteForumThread(params.forumThreadId);
  }
}
