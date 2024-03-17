import { Module } from '@nestjs/common';
import { CourseService } from './course.service';
import { CourseController } from './course.controller';
import { JwtModule } from '@nestjs/jwt';
import {  JwtAdminStrategy, JwtCombineStrategy, JwtUserStrategy } from '../strategy';

@Module({
  imports: [JwtModule.register({})],
  providers: [CourseService,JwtUserStrategy,JwtAdminStrategy,JwtCombineStrategy],
  controllers: [CourseController],
  exports: [CourseService],
})
export class CourseModule {}
