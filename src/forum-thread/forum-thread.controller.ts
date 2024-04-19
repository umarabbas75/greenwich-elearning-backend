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

  @UseGuards(AuthGuard('jwt'))
  @Post('/')
  createForumThread(@Body() body: any, @GetUser() user: User): Promise<any> {
    return this.forumThreadService.createForumThread(body, user.id);
  }
  @UseGuards(AuthGuard('jwt'))
  @Get('/')
  async getAllForumThreads(@GetUser() user: User) {
    return this.forumThreadService.getAllForumThreads(user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('/:forumThreadId')
  async getForumThread(@Param() params: any) {
    return this.forumThreadService.getForumThread(params.forumThreadId);
  }
  @UseGuards(AuthGuard('jwt'))
  @Put('/update/:forumThreadId')
  updateForumThread(@Param() params: any, @Body() body: any) {
    return this.forumThreadService.updateForumThread(
      params.forumThreadId,
      body,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('/delete/:forumThreadId')
  deleteForumThread(@Param() params: any): Promise<any> {
    return this.forumThreadService.deleteForumThread(params.forumThreadId);
  }
}
