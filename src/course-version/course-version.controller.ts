import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { User } from '@prisma/client';
import { GetUser } from '../decorator';
import { CourseVersionService } from './course-version.service';

class PublishVersionDto {
  changeNotes?: string;
}

class MigrateEnrollmentDto {
  userCourseId: string;
  targetVersionId: string;
}

@Controller('courses')
export class CourseVersionController {
  constructor(private readonly courseVersionService: CourseVersionService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post(':courseId/versions/publish')
  publishVersion(
    @GetUser() admin: User,
    @Param('courseId') courseId: string,
    @Body() body: PublishVersionDto,
  ) {
    return this.courseVersionService.publishNewVersion(
      admin.id,
      courseId,
      body?.changeNotes,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':courseId/versions')
  listVersions(@Param('courseId') courseId: string) {
    return this.courseVersionService.listVersions(courseId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':courseId/versions/:versionId/archive')
  archiveVersion(
    @GetUser() admin: User,
    @Param('courseId') courseId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.courseVersionService.archiveVersion(
      admin.id,
      courseId,
      versionId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('versions/prune-orphans')
  pruneOrphanVersions(@Body() body?: { courseId?: string }) {
    return this.courseVersionService.pruneOrphanVersions(body?.courseId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('enrollments/migrate-version')
  migrateLearner(@GetUser() admin: User, @Body() body: MigrateEnrollmentDto) {
    return this.courseVersionService.migrateLearnerToVersion(
      admin.id,
      body.userCourseId,
      body.targetVersionId,
    );
  }

  /**
   * PR 2 — Roster. Answers "who is on which version of this course, how
   * far along, and are they behind latest?". Paginated + sortable +
   * searchable — see CourseVersionService.getRoster for query semantics.
   */
  @UseGuards(AuthGuard('jwt'))
  @Get(':courseId/enrollments')
  getRoster(
    @Param('courseId') courseId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sort') sort?: string,
    @Query('search') search?: string,
    @Query('versionFilter') versionFilter?: string,
  ) {
    return this.courseVersionService.getRoster(courseId, {
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      sort,
      search,
      versionFilter,
    });
  }
}
