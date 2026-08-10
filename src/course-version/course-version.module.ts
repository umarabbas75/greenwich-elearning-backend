import { Module } from '@nestjs/common';
import { CourseVersionService } from './course-version.service';
import { CourseVersionController } from './course-version.controller';
import { LearnerSnapshotController } from './learner-snapshot.controller';
import { LearnerSnapshotService } from './learner-snapshot.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [CourseVersionService, LearnerSnapshotService],
  controllers: [CourseVersionController, LearnerSnapshotController],
  exports: [CourseVersionService, LearnerSnapshotService],
})
export class CourseVersionModule {}
