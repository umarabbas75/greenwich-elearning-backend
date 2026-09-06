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
import { ForumCategoryService } from './forum-category.service';

@Controller('forum/categories')
export class ForumCategoryController {
  constructor(private readonly categories: ForumCategoryService) {}

  @UseGuards(AuthGuard('cJwt'))
  @Get('/')
  list(
    @GetUser() user: User,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.categories.list(user, includeInactive === 'true');
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('/')
  create(@GetUser() user: User, @Body() body: any) {
    return this.categories.create(user, body);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Patch('/:id')
  update(
    @GetUser() user: User,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.categories.update(user, id, body);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('/:id/move-threads')
  moveThreads(
    @GetUser() user: User,
    @Param('id') id: string,
    @Body() body: { toCategoryId?: string | null },
  ) {
    return this.categories.moveThreads(
      user,
      id,
      body?.toCategoryId === undefined ? null : body.toCategoryId,
    );
  }

  @UseGuards(AuthGuard('cJwt'))
  @Delete('/:id')
  remove(@GetUser() user: User, @Param('id') id: string) {
    return this.categories.remove(user, id);
  }
}
