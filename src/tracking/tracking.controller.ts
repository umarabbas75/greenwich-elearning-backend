import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { User } from '@prisma/client';
import { GetUser } from '../decorator';
import { TrackingHeartbeatDto } from '../dto';
import { TrackingService } from './tracking.service';

@Controller('tracking')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  /**
   * Time-tracking heartbeat for the CURRENT user. The FE pings while a section
   * is open; the user is always taken from the token (never the body), so a
   * client can't accrue time for someone else.
   */
  @UseGuards(AuthGuard('cJwt'))
  @Post('heartbeat')
  @HttpCode(200)
  heartbeat(@Body() body: TrackingHeartbeatDto, @GetUser() user: User) {
    return this.tracking.heartbeat(
      user.id,
      body.sectionId,
      body.activeSeconds,
      body.intervalSeconds,
    );
  }

  /** Login history for a user (admin/report view). */
  @UseGuards(AuthGuard('cJwt'))
  @Get('login-history/:userId')
  getLoginHistory(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
  ) {
    return this.tracking.getLoginHistory(
      userId,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  /** My own login history (the current user). */
  @UseGuards(AuthGuard('cJwt'))
  @Get('login-history')
  getMyLoginHistory(@GetUser() user: User, @Query('limit') limit?: string) {
    return this.tracking.getLoginHistory(
      user.id,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  /** Time-spent roll-up for a user in a course (admin/report view). */
  @UseGuards(AuthGuard('cJwt'))
  @Get('time-spent/:userId/:courseId')
  getUserCourseTimeSpent(
    @Param('userId') userId: string,
    @Param('courseId') courseId: string,
  ) {
    return this.tracking.getUserCourseTimeSpent(userId, courseId);
  }
}
