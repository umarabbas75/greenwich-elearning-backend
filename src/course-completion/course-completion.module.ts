import { Module } from '@nestjs/common';
import { CourseCompletionService } from './course-completion.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { CourseVersionModule } from '../course-version/course-version.module';

/**
 * Leaf module owning course-completion evaluation. Imported by BOTH
 * CourseModule (section-completion path) and QuizModule (quiz-pass path) so a
 * course can be completed by either terminal act and the milestone emails fire
 * either way.
 *
 * Deliberately a shared leaf rather than QuizModule -> CourseModule: the latter
 * would pull a ~6k-line service plus its Mail/Feedback deps into QuizService,
 * and would turn any future CourseModule -> QuizModule edge into a real cycle
 * (this codebase has zero forwardRef usages and it is worth keeping it that
 * way). Same shape as CourseVersionModule, which is already shared by
 * CourseModule, QuizModule and CourseAssessmentModule.
 *
 * No controller — nothing to register in AppModule; Nest resolves it
 * transitively via the two importers.
 */
@Module({
  imports: [PrismaModule, MailModule, FeedbackModule, CourseVersionModule],
  providers: [CourseCompletionService],
  exports: [CourseCompletionService],
})
export class CourseCompletionModule {}
