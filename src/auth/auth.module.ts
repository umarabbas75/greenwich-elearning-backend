import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { JwtModule } from '@nestjs/jwt';
import { MailModule } from '../mail/mail.module';
import {
  JwtUserStrategy,
  JwtAdminStrategy,
  JwtCombineStrategy,
} from '../strategy';
@Module({
  imports: [JwtModule.register({}), MailModule],
  providers: [
    AuthService,
    PasswordResetService,
    JwtUserStrategy,
    JwtAdminStrategy,
    JwtCombineStrategy,
  ],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
