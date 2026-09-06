import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { User } from '@prisma/client';
import { Request } from 'express';
import { GetUser } from '../decorator';
import { LaunchScormDto } from './dto';
import { ScormPostbackGuard } from './scorm-postback.guard';
import { ScormRuntimeService } from './scorm-runtime.service';

@Controller('scorm')
export class ScormLaunchController {
  constructor(private readonly runtime: ScormRuntimeService) {}

  @UseGuards(AuthGuard('uJwt'))
  @Post('launch')
  @HttpCode(200)
  launch(@GetUser() user: User, @Body() body: LaunchScormDto) {
    return this.runtime.launch(user, body);
  }

  /**
   * Cloud HTTPBASIC postback. No JWT. No whitelist DTO — read raw req.body
   * because ValidationPipe({ whitelist: true }) would strip Cloud fields.
   * 200 only after a durable write; unknown id / failed certify → 5xx.
   */
  @UseGuards(ScormPostbackGuard)
  @Post('postback')
  @HttpCode(200)
  async postback(@Req() req: Request) {
    await this.runtime.handlePostback(req.body);
    return { ok: true };
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('progress')
  getProgress(@GetUser() user: User, @Query('courseId') courseId: string) {
    return this.runtime.getLearnerProgress(user.id, courseId);
  }
}
