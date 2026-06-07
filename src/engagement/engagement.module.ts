import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { EngagementController } from './engagement.controller';
import { EngagementService } from './engagement.service';
import { CronSecretGuard } from './cron-secret.guard';

/**
 * Automated low-engagement reminders. PrismaModule and ConfigModule are global,
 * so only MailModule is imported here.
 */
@Module({
  imports: [MailModule],
  controllers: [EngagementController],
  providers: [EngagementService, CronSecretGuard],
  exports: [EngagementService],
})
export class EngagementModule {}
