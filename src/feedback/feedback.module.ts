import { Module } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { MailModule } from '../mail/mail.module';
import { NotificationModule } from '../notifications/notification.module';
import { CertificateModule } from '../certificate/certificate.module';

@Module({
  imports: [MailModule, NotificationModule, CertificateModule],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
