import { Module } from '@nestjs/common';
import { CourseService } from './course.service';
import { CourseController } from './course.controller';
import { JwtModule } from '@nestjs/jwt';
import {  JwtUserStrategy,JwtAdminStrategy } from '../strategy';

@Module({
  imports: [JwtModule.register({})],
  providers: [CourseService,JwtUserStrategy,JwtAdminStrategy],
  controllers: [CourseController],
  exports: [CourseService],
})
export class CourseModule {}
