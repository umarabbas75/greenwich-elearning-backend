import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import {
  JwtUserStrategy,
  JwtAdminStrategy,
  JwtCombineStrategy,
} from '../strategy';

/**
 * Platform tracking: time-spent heartbeats + time/login reports. (Login events
 * themselves are written by AuthService on the login path.) PrismaModule is
 * global; the JWT strategies are registered here so the cJwt guard resolves.
 */
@Module({
  imports: [JwtModule.register({})],
  providers: [
    TrackingService,
    JwtUserStrategy,
    JwtAdminStrategy,
    JwtCombineStrategy,
  ],
  controllers: [TrackingController],
  exports: [TrackingService],
})
export class TrackingModule {}
