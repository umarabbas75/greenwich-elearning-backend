import {
  Controller,
  UseGuards,
  Get,
  Put,
  Body,
  // Delete,
} from '@nestjs/common';
import { NotificationService } from './notification.service';

import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/decorator';
import { User } from '@prisma/client';
// import { GetUser } from '../decorator';
// import { User } from '@prisma/client';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly forumThreadService: NotificationService) {}

  @UseGuards(AuthGuard('cJwt'))
  @Get()
  getUserNotifications(@GetUser() user: User): Promise<any> {
    return this.forumThreadService.getUserNotifications(user.id);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Put('/markAsRead')
  markNotificationAsRead(@Body() body: any) {
    return this.forumThreadService.markNotificationAsRead(body?.id);
  }
}
