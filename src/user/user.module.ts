import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { JwtModule } from '@nestjs/jwt';
import { JwtAdminStrategy, JwtUserStrategy } from 'src/strategy';
@Module({
  imports: [JwtModule.register({})],
  providers: [UserService, JwtUserStrategy,JwtAdminStrategy],
  controllers: [UserController],
  exports: [UserService],
})
export class UserModule {}
