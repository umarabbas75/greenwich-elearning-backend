import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CourseCompletionModule } from '../course-completion/course-completion.module';
import { CourseVersionModule } from '../course-version/course-version.module';
import { CronSecretGuard } from '../engagement/cron-secret.guard';
import { ScormCloudModule } from '../scorm-cloud/scorm-cloud.module';
import {
  JwtAdminStrategy,
  JwtCombineStrategy,
  JwtUserStrategy,
} from '../strategy';
import { ScormController } from './scorm.controller';
import { ScormLaunchController } from './scorm-launch.controller';
import { ScormPostbackGuard } from './scorm-postback.guard';
import { ScormReconcileController } from './scorm-reconcile.controller';
import { ScormRuntimeService } from './scorm-runtime.service';
import { ScormService } from './scorm.service';

/**
 * Feature module: import, launch, postback, crons.
 * Does not import CourseModule or UserModule (leaf Cloud client is shared).
 */
@Module({
  imports: [
    JwtModule.register({}),
    ScormCloudModule,
    CourseCompletionModule,
    CourseVersionModule,
  ],
  controllers: [
    ScormController,
    ScormLaunchController,
    ScormReconcileController,
  ],
  providers: [
    ScormService,
    ScormRuntimeService,
    ScormPostbackGuard,
    CronSecretGuard,
    JwtUserStrategy,
    JwtAdminStrategy,
    JwtCombineStrategy,
  ],
})
export class ScormModule {}
