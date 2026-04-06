import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AssessmentAttemptStatus, QuestionDifficulty, QuestionType } from '@prisma/client';
import { GetUser } from '../decorator';
import { User } from '@prisma/client';
import {
  AddAssessmentQuestionDto,
  CreateAssessmentDto,
  CreateQuestionCategoryDto,
  CreateQuestionDto,
  GradeAttemptDto,
  ReorderAssessmentQuestionsDto,
  SetCertificateDto,
  StartAttemptDto,
  SubmitAttemptDto,
  UpdateAssessmentDto,
  UpdateQuestionCategoryDto,
  UpdateQuestionDto,
} from '../dto';
import { CourseAssessmentService } from './course-assessment.service';

@Controller('course-assessment')
export class CourseAssessmentController {
  constructor(private readonly service: CourseAssessmentService) {}

  // ──────────────────────────────────────────────────────────────────────────
  // ADMIN — Question Categories
  // ──────────────────────────────────────────────────────────────────────────

  @UseGuards(AuthGuard('jwt'))
  @Post('admin/questions/categories')
  createCategory(@GetUser() user: User, @Body() body: CreateQuestionCategoryDto) {
    return this.service.createCategory(user.id, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('admin/questions/categories/:courseId')
  getCategoriesByCourse(@Param('courseId') courseId: string) {
    return this.service.getCategoriesByCourse(courseId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('admin/questions/categories/:id')
  updateCategory(@Param('id') id: string, @Body() body: UpdateQuestionCategoryDto) {
    return this.service.updateCategory(id, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('admin/questions/categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.service.deleteCategory(id);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ADMIN — Question Bank
  // ──────────────────────────────────────────────────────────────────────────

  @UseGuards(AuthGuard('jwt'))
  @Post('admin/questions')
  createQuestion(@GetUser() user: User, @Body() body: CreateQuestionDto) {
    return this.service.createQuestion(user.id, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('admin/questions')
  getQuestions(
    @Query('courseId') courseId: string,
    @Query('categoryId') categoryId?: string,
    @Query('difficulty') difficulty?: QuestionDifficulty,
    @Query('type') type?: QuestionType,
    @Query('isActive') isActive?: string,
  ) {
    return this.service.getQuestions(courseId, {
      categoryId,
      difficulty,
      type,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('admin/questions/:id')
  getQuestionById(@Param('id') id: string) {
    return this.service.getQuestionById(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('admin/questions/:id')
  updateQuestion(@Param('id') id: string, @Body() body: UpdateQuestionDto) {
    return this.service.updateQuestion(id, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('admin/questions/:id')
  deleteQuestion(
    @Param('id') id: string,
    @Query('permanent') permanent?: string,
  ) {
    return this.service.deleteQuestion(id, permanent === 'true');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ADMIN — Assessment Management
  // ──────────────────────────────────────────────────────────────────────────

  @UseGuards(AuthGuard('jwt'))
  @Post('admin/assessments')
  createAssessment(@GetUser() user: User, @Body() body: CreateAssessmentDto) {
    return this.service.createAssessment(user.id, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('admin/assessments')
  getAssessmentsByCourse(@Query('courseId') courseId: string) {
    return this.service.getAssessmentsByCourse(courseId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('admin/assessments/:id')
  getAssessmentById(@Param('id') id: string) {
    return this.service.getAssessmentById(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('admin/assessments/:id')
  updateAssessment(@Param('id') id: string, @Body() body: UpdateAssessmentDto) {
    return this.service.updateAssessment(id, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('admin/assessments/:id/activate')
  activateAssessment(@Param('id') id: string) {
    return this.service.activateAssessment(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('admin/assessments/:id/deactivate')
  deactivateAssessment(@Param('id') id: string) {
    return this.service.deactivateAssessment(id);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ADMIN — Manual Question Roster
  // ──────────────────────────────────────────────────────────────────────────

  @UseGuards(AuthGuard('jwt'))
  @Post('admin/assessments/:id/questions')
  addQuestionToAssessment(
    @Param('id') assessmentId: string,
    @Body() body: AddAssessmentQuestionDto,
  ) {
    return this.service.addQuestionToAssessment(assessmentId, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('admin/assessments/:id/questions/:questionId')
  removeQuestionFromAssessment(
    @Param('id') assessmentId: string,
    @Param('questionId') questionId: string,
  ) {
    return this.service.removeQuestionFromAssessment(assessmentId, questionId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('admin/assessments/:id/questions/reorder')
  reorderQuestions(
    @Param('id') assessmentId: string,
    @Body() body: ReorderAssessmentQuestionsDto,
  ) {
    return this.service.reorderAssessmentQuestions(assessmentId, body);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ADMIN — Grading
  // ──────────────────────────────────────────────────────────────────────────

  @UseGuards(AuthGuard('jwt'))
  @Get('admin/attempts')
  getAdminAttempts(
    @Query('courseId') courseId: string,
    @Query('status') status?: AssessmentAttemptStatus,
    @Query('userId') userId?: string,
  ) {
    return this.service.getAdminAttempts(courseId, { status, userId });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('admin/attempts/:id')
  getAdminAttemptDetail(@Param('id') id: string) {
    return this.service.getAdminAttemptDetail(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('admin/attempts/:id/grade')
  gradeAttempt(@Param('id') id: string, @Body() body: GradeAttemptDto) {
    return this.service.gradeAttempt(id, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('admin/attempts/:id/finalize')
  finalizeGrade(@GetUser() user: User, @Param('id') id: string) {
    return this.service.finalizeGrade(user.id, id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('admin/attempts/:attemptId/certificate')
  setCertificate(
    @Param('attemptId') attemptId: string,
    @Query('userId') userId: string,
    @Query('courseId') courseId: string,
    @Body() body: SetCertificateDto,
  ) {
    return this.service.setCertificate(userId, courseId, body);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STUDENT — Assessment Flow
  // ──────────────────────────────────────────────────────────────────────────

  @UseGuards(AuthGuard('uJwt'))
  @Get('student/assessments/:courseId')
  getActiveAssessmentForStudent(
    @GetUser() user: User,
    @Param('courseId') courseId: string,
  ) {
    return this.service.getActiveAssessmentForStudent(user.id, courseId);
  }

  @UseGuards(AuthGuard('uJwt'))
  @Post('student/attempts/start')
  startAttempt(@GetUser() user: User, @Body() body: StartAttemptDto) {
    return this.service.startAttempt(user.id, body);
  }

  @UseGuards(AuthGuard('uJwt'))
  @Get('student/attempts/:id')
  getAttempt(@GetUser() user: User, @Param('id') id: string) {
    return this.service.getAttempt(user.id, id);
  }

  @UseGuards(AuthGuard('uJwt'))
  @Post('student/attempts/:id/submit')
  submitAttempt(
    @GetUser() user: User,
    @Param('id') id: string,
    @Body() body: SubmitAttemptDto,
  ) {
    return this.service.submitAttempt(user.id, id, body);
  }

  @UseGuards(AuthGuard('uJwt'))
  @Get('student/attempts')
  getStudentAttemptHistory(
    @GetUser() user: User,
    @Query('courseId') courseId: string,
  ) {
    return this.service.getStudentAttemptHistory(user.id, courseId);
  }

  @UseGuards(AuthGuard('uJwt'))
  @Get('student/completion/:courseId')
  getStudentCompletion(@GetUser() user: User, @Param('courseId') courseId: string) {
    return this.service.getStudentCompletion(user.id, courseId);
  }
}
