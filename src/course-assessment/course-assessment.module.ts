import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import {
  JwtAdminStrategy,
  JwtCombineStrategy,
  JwtUserStrategy,
} from '../strategy';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notifiications/notification.module';
import { CourseAssessmentController } from './course-assessment.controller';
import { CourseAssessmentService } from './course-assessment.service';

@Module({
  imports: [JwtModule.register({}), PrismaModule, NotificationModule],
  providers: [
    CourseAssessmentService,
    JwtUserStrategy,
    JwtAdminStrategy,
    JwtCombineStrategy,
  ],
  controllers: [CourseAssessmentController],
  exports: [CourseAssessmentService],
})
export class CourseAssessmentModule {}
