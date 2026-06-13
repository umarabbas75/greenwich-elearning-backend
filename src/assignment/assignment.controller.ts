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
import { AssignmentService } from './assignment.service';
import { FeedbackService } from '../feedback/feedback.service';
import { GetUser } from '../decorator';
import { ResponseDto } from '../dto';
import {
  AssignmentFileType,
  AssignmentSubmissionStatus,
  User,
} from '@prisma/client';

@Controller('assignments')
export class AssignmentController {
  constructor(
    private readonly assignmentService: AssignmentService,
    private readonly feedbackService: FeedbackService,
  ) {}

  // Student: submit to a specific admin-created assignment
  @UseGuards(AuthGuard('cJwt'))
  @Post('submit')
  async submit(
    @GetUser() user: User,
    @Body()
    body: {
      assignmentId: string;
      courseId?: string;
      assignedToAdminId?: string;
      submissionAttachments?: Array<{
        fileUrl: string;
        fileName?: string;
        fileType: AssignmentFileType;
      }>;
      submissionFiles?: Array<{
        fileUrl: string;
        fileName?: string;
        fileType: AssignmentFileType;
      }>;
      fileUrl?: string;
      fileName?: string;
      fileType?: AssignmentFileType; // 'pdf' | 'docx'
    },
  ): Promise<ResponseDto> {
    return this.assignmentService.createSubmission(user.id, body);
  }

  // Student: list own submissions
  @UseGuards(AuthGuard('cJwt'))
  @Get('my')
  async mySubmissions(@GetUser() user: User): Promise<ResponseDto> {
    return this.assignmentService.getMySubmissions(user.id);
  }

  // Admin: list submissions assigned to them (optional filter by status)
  @UseGuards(AuthGuard('cJwt'))
  @Get('assigned')
  async assignedToMe(
    @GetUser() user: User,
    @Query('status') status?: AssignmentSubmissionStatus,
  ): Promise<ResponseDto> {
    return this.assignmentService.listAssignedToAdmin(user.id, status);
  }

  // Admin: review a submission (update status/feedback/score)
  @UseGuards(AuthGuard('cJwt'))
  @Post('review')
  async review(
    @GetUser() user: User,
    @Body()
    body: {
      submissionId: string;
      status?: AssignmentSubmissionStatus;
      feedback?: string;
      score?: number;
    },
  ): Promise<ResponseDto> {
    return this.assignmentService.reviewSubmission(user.id, body);
  }

  // Admin: create a new assignment for a course
  @UseGuards(AuthGuard('cJwt'))
  @Post('create')
  async createAssignment(
    @GetUser() user: User,
    @Body()
    body: {
      title: string;
      description?: string;
      instructions?: string;
      courseId: string;
      assignedToAdminId: string; // Admin who will review submissions
      dueAt?: string; // ISO date string
      maxPoints?: number;
      allowResubmissions?: boolean;
      maxAttempts?: number;
      assignmentFiles?: Array<{
        fileUrl: string;
        fileName?: string;
        fileType: AssignmentFileType;
      }>;
      assignmentFileUrl?: string;
      assignmentFileName?: string;
      assignmentFileType?: AssignmentFileType;
    },
  ): Promise<ResponseDto> {
    return this.assignmentService.createAssignment(user.id, body);
  }

  // Admin: list all assignments they created
  @UseGuards(AuthGuard('cJwt'))
  @Get('admin/created')
  async adminCreatedAssignments(@GetUser() user: User): Promise<ResponseDto> {
    return this.assignmentService.getAdminCreatedAssignments(user.id);
  }

  // Admin: update assignment details
  @UseGuards(AuthGuard('cJwt'))
  @Post('admin/update')
  async updateAssignment(
    @GetUser() user: User,
    @Body()
    body: {
      assignmentId: string;
      title?: string;
      description?: string;
      instructions?: string;
      dueAt?: string;
      maxPoints?: number;
      allowResubmissions?: boolean;
      maxAttempts?: number;
      assignmentFiles?: Array<{
        fileUrl: string;
        fileName?: string;
        fileType: AssignmentFileType;
      }>;
      assignmentFileUrl?: string;
      assignmentFileName?: string;
      assignmentFileType?: AssignmentFileType;
      isActive?: boolean;
    },
  ): Promise<ResponseDto> {
    return this.assignmentService.updateAssignment(user.id, body);
  }

  // ── Course feedback (contract §2–§4) — static paths before :id ───────────

  @UseGuards(AuthGuard('cJwt'))
  @Get('feedback/pending/me')
  async getPendingFeedback(@GetUser() user: User): Promise<ResponseDto> {
    return this.feedbackService.getPendingFeedbackForUser(user.id);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('feedback/admin/aggregate')
  async getFeedbackAggregate(
    @GetUser() user: User,
    @Query('courseId') courseId?: string,
  ): Promise<ResponseDto> {
    return this.feedbackService.getAdminAggregate(user.id, courseId);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('feedback/admin')
  async listFeedbackSubmissions(
    @GetUser() user: User,
    @Query('courseId') courseId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<ResponseDto> {
    return this.feedbackService.listAdminSubmissions(user.id, {
      courseId,
      from,
      to,
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('feedback/admin/:submissionId')
  async getFeedbackSubmissionDetail(
    @GetUser() user: User,
    @Param('submissionId') submissionId: string,
  ): Promise<ResponseDto> {
    return this.feedbackService.getAdminSubmissionDetail(user.id, submissionId);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Post('course/:courseId/feedback')
  async submitCourseFeedback(
    @GetUser() user: User,
    @Param('courseId') courseId: string,
    @Body()
    body: {
      formVersion?: string;
      formData: unknown;
    },
  ): Promise<ResponseDto> {
    return this.feedbackService.submitCourseFeedback(user.id, courseId, body);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('course/:courseId/feedback-status')
  async getCourseFeedbackStatus(
    @GetUser() user: User,
    @Param('courseId') courseId: string,
  ): Promise<ResponseDto> {
    return this.feedbackService.getCourseFeedbackStatus(user.id, courseId);
  }

  @UseGuards(AuthGuard('cJwt'))
  @Get('course/:courseId/feedback-submissions')
  async getCourseFeedbackSubmissions(
    @GetUser() user: User,
    @Param('courseId') courseId: string,
  ): Promise<ResponseDto> {
    return this.feedbackService.getCourseFeedbackSubmissions(
      courseId,
      user.id,
    );
  }

  // Students: get assignments for courses they're enrolled in
  @UseGuards(AuthGuard('cJwt'))
  @Get('available')
  async getAvailableAssignments(@GetUser() user: User): Promise<ResponseDto> {
    return this.assignmentService.getAvailableAssignments(user.id);
  }

  // Get assignment details by ID
  @UseGuards(AuthGuard('cJwt'))
  @Get(':id')
  async getAssignment(@Param('id') id: string): Promise<ResponseDto> {
    return this.assignmentService.getAssignmentById(id);
  }

  // Get assignment status for current student
  @UseGuards(AuthGuard('cJwt'))
  @Get(':id/status')
  async getAssignmentStatus(
    @GetUser() user: User,
    @Param('id') id: string,
  ): Promise<ResponseDto> {
    return this.assignmentService.getAssignmentStatusForStudent(user.id, id);
  }

  // Admin: get all submissions for a specific assignment
  @UseGuards(AuthGuard('cJwt'))
  @Get(':id/submissions')
  async getAssignmentSubmissions(
    @GetUser() user: User,
    @Param('id') id: string,
    @Query('status') status?: AssignmentSubmissionStatus,
  ): Promise<ResponseDto> {
    return this.assignmentService.getAssignmentSubmissions(id, user.id, status);
  }
}
