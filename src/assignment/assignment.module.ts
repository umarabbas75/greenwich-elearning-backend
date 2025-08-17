import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import {
  JwtAdminStrategy,
  JwtCombineStrategy,
  JwtUserStrategy,
} from '../strategy';
import { AssignmentService } from './assignment.service';
import { AssignmentController } from './assignment.controller';

@Module({
  imports: [JwtModule.register({})],
  providers: [
    AssignmentService,
    JwtUserStrategy,
    JwtAdminStrategy,
    JwtCombineStrategy,
  ],
  controllers: [AssignmentController],
  exports: [AssignmentService],
})
export class AssignmentModule {}
