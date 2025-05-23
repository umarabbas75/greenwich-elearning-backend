import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  // Put,
  Param,
  Put,
  Delete,
  // Delete,
} from '@nestjs/common';
import { ForumCommentService } from './forum-comment.service';

import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/decorator';
import { User } from '@prisma/client';
// import { GetUser } from '../decorator';
// import { User } from '@prisma/client';

@Controller('forum-thread-comment')
export class ForumCommentController {
  constructor(private readonly forumThreadService: ForumCommentService) {}

  @UseGuards(AuthGuard('cJwt'))
  @Post('/')
  createForumThreadComment(
    @Body() body: any,
    @GetUser() user: User,
  ): Promise<any> {
    return this.forumThreadService.createForumThreadComment(body, user.id);
  }
  @UseGuards(AuthGuard('cJwt'))
  @Get('/:forumThreadId')
  async getForumCommentsByThreadId(@Param() params: any) {
    return this.forumThreadService.getForumCommentsByThreadId(
      params?.forumThreadId,
    );
  }

  @UseGuards(AuthGuard('cJwt'))
  @Put('/:forumThreadId')
  async updateForumThreadComment(@Param() params: any, @Body() body: any) {
    return this.forumThreadService.updateForumThreadComment(
      params?.forumThreadId,
      body,
    );
  }

  @UseGuards(AuthGuard('cJwt'))
  @Delete('/:forumThreadId')
  async deleteForumThreadComment(@Param() params: any) {
    return this.forumThreadService.deleteForumThreadComment(
      params?.forumThreadId,
    );
  }
}
