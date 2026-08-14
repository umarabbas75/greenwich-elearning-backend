import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { LearnerSnapshotService } from './learner-snapshot.service';

/**
 * Admin read-only view of one learner's course-versioning state.
 *
 * Deliberately NOT mounted under `courses` or `/users`:
 *
 * - `courses` is shared by two controllers and already carries the
 *   literal-vs-`:param` ordering hazard that shipped `/versions/drift` dead
 *   (see the warning at course-version.controller.ts:114). Another literal
 *   segment there is another chance to reintroduce it.
 * - `UserController` has every `@UseGuards` commented out, so an admin
 *   endpoint added there would be unguarded.
 *
 * `admin/learners` is a fresh prefix with a single param route, so there is
 * nothing to shadow.
 */
@Controller('admin/learners')
export class LearnerSnapshotController {
  constructor(private readonly snapshotService: LearnerSnapshotService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get(':userId/versioning')
  getLearnerVersioning(
    @Param('userId') userId: string,
    @Query('includeAudit') includeAudit?: string,
    @Query('auditLimit') auditLimit?: string,
    @Query('includeAssessments') includeAssessments?: string,
  ) {
    return this.snapshotService.getLearnerVersioningSnapshot(userId, {
      // Query params arrive as strings and are never coerced, so compare
      // explicitly rather than relying on truthiness — `'false'` is truthy.
      includeAudit: includeAudit !== 'false',
      includeAssessments: includeAssessments !== 'false',
      auditLimit: auditLimit ? parseInt(auditLimit, 10) : undefined,
    });
  }

  /**
   * Drill-down: the full curriculum tree for one course as this learner sees
   * it, with per-lesson state and their actual quiz answers.
   *
   * Declared after the two-segment route above; both are literal-tailed under
   * distinct shapes, so there is nothing to shadow.
   */
  @UseGuards(AuthGuard('jwt'))
  @Get(':userId/courses/:courseId/detail')
  getLearnerCourseDetail(
    @Param('userId') userId: string,
    @Param('courseId') courseId: string,
  ) {
    return this.snapshotService.getLearnerCourseDetail(userId, courseId);
  }
}
