import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { User } from '@prisma/client';
import { GetUser } from '../decorator';
import { TrackingHeartbeatDto, SectionAttemptDto } from '../dto';
import { TrackingService } from './tracking.service';

@Controller('tracking')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  /**
   * These reports are addressed by a `:userId` in the path, but the guard
   * (`cJwt`) admits ANY authenticated user — student or admin. Without this
   * check a student could read any other user's report, including the IP
   * addresses in their login history. Admins keep full access; everyone else
   * may only read themselves.
   */
  private assertCanRead(requester: User, targetUserId: string): void {
    if (requester.role === 'admin') return;
    if (requester.id === targetUserId) return;
    throw new HttpException(
      { status: HttpStatus.FORBIDDEN, error: 'Forbidden' },
      HttpStatus.FORBIDDEN,
    );
  }

  /**
   * Time-tracking heartbeat for the CURRENT user. The FE pings while a section
   * is open; the user is always taken from the token (never the body), so a
   * client can't accrue time for someone else.
   *
   * Uses `cJwtHeartbeat` (signature-only) instead of `cJwt` so we don't load
   * the full user row on every ping — this route only needs `user.id`.
   */
  @UseGuards(AuthGuard('cJwtHeartbeat'))
  @Post('heartbeat')
  @HttpCode(200)
  heartbeat(
    @Body() body: TrackingHeartbeatDto,
    @GetUser() user: { id: string },
  ) {
    return this.tracking.heartbeat(
      user.id,
      body.sectionId,
      body.activeSeconds,
      body.intervalSeconds,
    );
  }

  /** Interactive section verify/check — increments aggregate attempt counter. */
  @UseGuards(AuthGuard('cJwt'))
  @Post('section-attempt')
  @HttpCode(200)
  sectionAttempt(@Body() body: SectionAttemptDto, @GetUser() user: User) {
    return this.tracking.recordSectionAttempt(
      user.id,
      body.sectionId,
      body.isCorrect,
    );
  }

  /** Login history for a user (admin view, or the caller's own). */
  @UseGuards(AuthGuard('cJwt'))
  @Get('login-history/:userId')
  getLoginHistory(
    @GetUser() requester: User,
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
  ) {
    this.assertCanRead(requester, userId);
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

  /** Time-spent roll-up for a user in a course (admin view, or the caller's own). */
  @UseGuards(AuthGuard('cJwt'))
  @Get('time-spent/:userId/:courseId')
  getUserCourseTimeSpent(
    @GetUser() requester: User,
    @Param('userId') userId: string,
    @Param('courseId') courseId: string,
  ) {
    this.assertCanRead(requester, userId);
    return this.tracking.getUserCourseTimeSpent(userId, courseId);
  }
}
