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

class BulkMigrateEnrollmentDto {
  userIds: string[];
  targetVersionId: string;
  dryRun: boolean;
  acceptRegressionFor?: string[];
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

  /**
   * PR 3a — Titled version tree. Expand one version's manifest into
   * a Module → Chapter → { Sections, Quizzes } tree with live titles.
   * `listVersions` deliberately omits the manifest; this is the drill-in.
   *
   * IMPORTANT: the `/diff` route must be registered BEFORE the generic
   * `/:versionId` route below, otherwise NestJS matches `diff` as a
   * versionId and returns a 404.
   */
  @UseGuards(AuthGuard('jwt'))
  @Get(':courseId/versions/diff')
  diffVersions(
    @Param('courseId') courseId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.courseVersionService.diffVersionsTitled(courseId, from, to);
  }

  /**
   * PR 4 — Drift. Registered HERE, above the generic `/:versionId` route,
   * for the same reason `/diff` is: NestJS matches in declaration order, so
   * a literal segment declared after `:versionId` is swallowed by it and
   * 404s. This was originally declared below and was dead on arrival —
   * caught by the FE team reading the controller rather than the handoff.
   *
   * Any future literal `/:courseId/versions/<word>` route belongs above the
   * `:versionId` route too.
   */
  @UseGuards(AuthGuard('jwt'))
  @Get(':courseId/versions/drift')
  getDrift(@Param('courseId') courseId: string) {
    return this.courseVersionService.getDrift(courseId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':courseId/versions/:versionId')
  getVersionTree(
    @Param('courseId') courseId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.courseVersionService.getVersionTree(courseId, versionId);
  }

  // ────────────────────────────────────────────────────────────────────
  // PR 4 — Coverage + Drift
  //
  // Coverage is course-scoped-globally (all courses); route sits at
  // /courses/versions/coverage. Drift is per-course.
  //
  // Reconcile stays CLI-only per decisions §7 — no POST endpoint here.
  // ────────────────────────────────────────────────────────────────────

  @UseGuards(AuthGuard('jwt'))
  @Get('versions/coverage')
  getCoverage() {
    return this.courseVersionService.getCoverage();
  }

  // Drift lives above the `:courseId/versions/:versionId` route — see the
  // note there. Declaring it here left it unreachable.

  // ────────────────────────────────────────────────────────────────────
  // PR 5 — Bulk migration
  //
  // Distinct route from the pre-existing single-learner
  // /enrollments/migrate-version. The two paths share
  // _migrateOneLearner but keep different HTTP contracts because the
  // single-learner endpoint doesn't do regression checking (row-action
  // on the roster) — see the plan's PR 5 rollout note.
  // ────────────────────────────────────────────────────────────────────

  @UseGuards(AuthGuard('jwt'))
  @Post(':courseId/enrollments/migrate-version-bulk')
  bulkMigrate(
    @GetUser() admin: User,
    @Param('courseId') courseId: string,
    @Body() body: BulkMigrateEnrollmentDto,
  ) {
    return this.courseVersionService.migrateLearnersToVersionBulk(
      admin.id,
      courseId,
      {
        userIds: body.userIds,
        targetVersionId: body.targetVersionId,
        dryRun: body.dryRun,
        acceptRegressionFor: body.acceptRegressionFor,
      },
    );
  }
}
