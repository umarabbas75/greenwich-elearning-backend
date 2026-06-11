import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { JwtModule } from '@nestjs/jwt';
import {
  JwtAdminStrategy,
  JwtCombineStrategy,
  JwtUserStrategy,
} from 'src/strategy';
import { MailModule } from '../mail/mail.module';
@Module({
  imports: [JwtModule.register({}), MailModule],
  providers: [
    UserService,
    JwtUserStrategy,
    JwtAdminStrategy,
    JwtCombineStrategy,
  ],
  controllers: [UserController],
  exports: [UserService],
})
export class UserModule {}
