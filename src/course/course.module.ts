import { Module } from '@nestjs/common';
import { CourseService } from './course.service';
import { CourseController } from './course.controller';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy, JwtUserStrategy } from '../strategy';

@Module({
  imports: [JwtModule.register({})],
  providers: [CourseService,JwtStrategy,JwtUserStrategy],
  controllers: [CourseController],
  exports: [CourseService],
})
export class CourseModule {}
