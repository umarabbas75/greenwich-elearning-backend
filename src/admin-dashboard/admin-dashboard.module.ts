import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import {
  JwtAdminStrategy,
  JwtCombineStrategy,
  JwtUserStrategy,
} from '../strategy';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';

/**
 * Admin analytics dashboard. Read-only aggregates over existing data + the
 * audit logs (email_logs, security_events). All routes are admin-only via
 * AuthGuard('jwt') → JwtAdminStrategy. PrismaService is @Global (no import).
 */
@Module({
  imports: [JwtModule.register({})],
  providers: [
    AdminDashboardService,
    JwtAdminStrategy,
    JwtCombineStrategy,
    JwtUserStrategy,
  ],
  controllers: [AdminDashboardController],
})
export class AdminDashboardModule {}
