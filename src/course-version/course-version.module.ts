import { Module } from '@nestjs/common';
import { CourseVersionService } from './course-version.service';
import { CourseVersionController } from './course-version.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [CourseVersionService],
  controllers: [CourseVersionController],
  exports: [CourseVersionService],
})
export class CourseVersionModule {}
