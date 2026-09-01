import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CertificateController } from './certificate.controller';
import { CertificateService } from './certificate.service';
import { MailModule } from '../mail/mail.module';
import {
  JwtAdminStrategy,
  JwtCombineStrategy,
  JwtUserStrategy,
} from '../strategy';

@Module({
  imports: [MailModule, JwtModule.register({})],
  controllers: [CertificateController],
  providers: [
    CertificateService,
    JwtUserStrategy,
    JwtAdminStrategy,
    JwtCombineStrategy,
  ],
  exports: [CertificateService],
})
export class CertificateModule {}
