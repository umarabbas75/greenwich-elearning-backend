import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Param,
  Put,
  Delete,
  Query,
} from '@nestjs/common';
import { ForumCommentService } from './forum-comment.service';

import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/decorator';
import { User } from '@prisma/client';

@Controller('forum-thread-comment')
export class ForumCommentController {
  constructor(private readonly forumThreadService: ForumCommentService) {}

  @UseGuards(AuthGuard('cJwt'))
  @Post('/')
  createForumThreadComment(
    @Body() body: any,
    @GetUser() user: User,
  ): Promise<any> {
    return this.forumThreadService.createForumThreadComment(body, user);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('/:id/accept')
  acceptForumComment(
    @Param('id') id: string,
    @GetUser() user: User,
    @Body() body?: { accepted?: boolean },
  ) {
    return this.forumThreadService.acceptForumComment(id, user, body);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('/:id/vote')
  voteForumComment(
    @Param('id') id: string,
    @Body() body: unknown,
    @GetUser() user: User,
  ) {
    return this.forumThreadService.voteForumComment(id, body, user);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('/:forumThreadId')
  async getForumCommentsByThreadId(
    @Param('forumThreadId') forumThreadId: string,
    @GetUser() user: User,
    @Query('sort') sort?: string,
  ) {
    return this.forumThreadService.getForumCommentsByThreadId(
      forumThreadId,
      user,
      sort,
    );
  }

  @UseGuards(AuthGuard('cJwt'))
  @Put('/:forumThreadId')
  async updateForumThreadComment(
    @Param('forumThreadId') forumThreadId: string,
    @Body() body: any,
    @GetUser() user: User,
  ) {
    return this.forumThreadService.updateForumThreadComment(
      forumThreadId,
      body,
      user,
    );
  }

  @UseGuards(AuthGuard('cJwt'))
  @Delete('/:forumThreadId')
  async deleteForumThreadComment(
    @Param('forumThreadId') forumThreadId: string,
    @GetUser() user: User,
  ) {
    return this.forumThreadService.deleteForumThreadComment(
      forumThreadId,
      user,
    );
  }
}
