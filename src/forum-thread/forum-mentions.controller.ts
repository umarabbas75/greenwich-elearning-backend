import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { User } from '@prisma/client';
import { GetUser } from 'src/decorator';
import { ForumThreadService } from './forum-thread.service';

@Controller('forum')
export class ForumMentionsController {
  constructor(private readonly threads: ForumThreadService) {}

  @UseGuards(AuthGuard('cJwt'))
  @Get('/mentions')
  search(
    @GetUser() user: User,
    @Query('q') q?: string,
    @Query('threadId') threadId?: string,
    @Query('courseId') courseId?: string,
  ) {
    return this.threads.searchMentions(user, { q, threadId, courseId });
  }
}
