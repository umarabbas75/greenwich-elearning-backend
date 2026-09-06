import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { User } from '@prisma/client';
import { GetUser } from 'src/decorator';
import { ForumTagService } from './forum-tag.service';

@Controller('forum/tags')
export class ForumTagController {
  constructor(private readonly tags: ForumTagService) {}

  @UseGuards(AuthGuard('cJwt'))
  @Get('/')
  list(@Query('q') q?: string) {
    return this.tags.list(q);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('/')
  create(@GetUser() user: User, @Body() body: { name?: string }) {
    return this.tags.create(user, body);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Patch('/:id')
  update(
    @GetUser() user: User,
    @Param('id') id: string,
    @Body() body: { name?: string },
  ) {
    return this.tags.update(user, id, body);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Delete('/:id')
  remove(@GetUser() user: User, @Param('id') id: string) {
    return this.tags.remove(user, id);
  }
}
