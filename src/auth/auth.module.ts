import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { JwtUserStrategy,JwtAdminStrategy,JwtCombineStrategy} from '../strategy';
@Module({
  imports: [JwtModule.register({})],
  providers: [AuthService, JwtUserStrategy,JwtAdminStrategy,JwtCombineStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
