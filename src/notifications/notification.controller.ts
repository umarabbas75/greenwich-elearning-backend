import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NotificationType, User } from '@prisma/client';
import { GetUser } from 'src/decorator';
import { NotificationService } from './notification.service';

/** Sunset for legacy PUT/POST aliases — 60 days from 2026-05-21. */
const LEGACY_SUNSET = 'Wed, 20 Jul 2026 00:00:00 GMT';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  // ──────────────────────────────────────────────────────────────────────
  // Canonical endpoints — PATCH + kebab-case, IDs in path
  // ──────────────────────────────────────────────────────────────────────

  @UseGuards(AuthGuard('cJwt'))
  @Get()
  list(
    @GetUser() user: User,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('filter') filter?: 'all' | 'unread',
    @Query('type') type?: NotificationType,
  ) {
    return this.notificationService.listNotifications(user.id, {
      cursor,
      limit: limit ? Number(limit) : undefined,
      filter,
      type,
    });
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('/unread-count')
  unreadCount(@GetUser() user: User) {
    return this.notificationService.getCounts(user.id);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Patch('/mark-all-read')
  markAllAsRead(@GetUser() user: User) {
    return this.notificationService.markAllAsRead(user.id);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Patch('/mark-all-seen')
  markAllAsSeen(@GetUser() user: User) {
    return this.notificationService.markAllAsSeen(user.id);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Patch('/:id/mark-as-read')
  markOneAsRead(@Param('id') id: string, @GetUser() user: User) {
    return this.notificationService.markOneAsRead(id, user.id);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Legacy aliases — sunset 2026-07-20
  // ──────────────────────────────────────────────────────────────────────

  /** @deprecated Use PATCH /notifications/:id/mark-as-read. Sunset 2026-07-20. */
  @UseGuards(AuthGuard('cJwt'))
  @Put('/markAsRead')
  @Header('Deprecation', 'true')
  @Header('Sunset', LEGACY_SUNSET)
  legacyMarkAsRead(@Body() body: { id?: string }, @GetUser() user: User) {
    return this.notificationService.markOneAsRead(body?.id ?? '', user.id);
  }

  /** @deprecated Use PATCH /notifications/mark-all-read. Sunset 2026-07-20. */
  @UseGuards(AuthGuard('cJwt'))
  @Post('/mark-all-read')
  @Header('Deprecation', 'true')
  @Header('Sunset', LEGACY_SUNSET)
  legacyMarkAllAsRead(@GetUser() user: User) {
    return this.notificationService.markAllAsRead(user.id);
  }
}
