import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Provides the transactional email transport. ConfigModule is global, so no
 * imports are needed here. Exported so any feature module can inject MailService.
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
