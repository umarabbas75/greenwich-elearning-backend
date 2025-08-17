import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  Prisma,
  AssignmentSubmissionStatus,
  AssignmentFileType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ResponseDto } from '../dto';

interface CreateSubmissionInput {
  assignmentId: string;
  fileUrl: string;
  fileName?: string;
  fileType: AssignmentFileType;
}

interface ReviewSubmissionInput {
  submissionId: string;
  status?: AssignmentSubmissionStatus;
  feedback?: string;
  score?: number;
}

@Injectable()
export class AssignmentService {
  constructor(private prisma: PrismaService) {}

  async createSubmission(
    studentId: string,
    input: CreateSubmissionInput,
  ): Promise<ResponseDto> {
    try {
      // Validate assignment exists and is active
      const assignment = await this.prisma.assignment.findUnique({
        where: { id: input.assignmentId },
        include: { course: true },
      });

      if (!assignment) {
        throw new Error('Assignment not found');
      }

      if (!assignment.isActive) {
        throw new Error('Assignment is not active');
      }

      // Check if student is enrolled in the course
      const enrollment = await this.prisma.userCourse.findFirst({
        where: {
          userId: studentId,
          courseId: assignment.courseId,
          isActive: true,
        },
      });

      if (!enrollment) {
        throw new Error('You are not enrolled in this course');
      }

      // Check if student already submitted to this assignment
      const existingSubmission =
        await this.prisma.assignmentSubmission.findFirst({
          where: {
            assignmentId: input.assignmentId,
            studentId: studentId,
          },
        });

      if (existingSubmission) {
        throw new Error('You have already submitted to this assignment');
      }

      const created = await this.prisma.assignmentSubmission.create({
        data: {
          assignmentId: input.assignmentId,
          studentId,
          assignedToAdminId: assignment.assignedToAdminId,
          fileUrl: input.fileUrl,
          fileName: input.fileName || null,
          fileType: input.fileType,
          status: AssignmentSubmissionStatus.submitted,
        },
      });

      return {
        message: 'Assignment submitted successfully',
        statusCode: 200,
        data: created,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to create submission',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async getMySubmissions(studentId: string): Promise<ResponseDto> {
    try {
      const submissions = await this.prisma.assignmentSubmission.findMany({
        where: { studentId },
        orderBy: { createdAt: 'desc' },
      });
      return {
        message: 'Fetched submissions',
        statusCode: 200,
        data: submissions,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to fetch submissions',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async listAssignedToAdmin(
    adminId: string,
    status?: AssignmentSubmissionStatus,
  ): Promise<ResponseDto> {
    try {
      const where: Prisma.AssignmentSubmissionWhereInput = {
        assignedToAdminId: adminId,
      };
      if (status) where.status = status;
      const submissions = await this.prisma.assignmentSubmission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
      return {
        message: 'Fetched assigned submissions',
        statusCode: 200,
        data: submissions,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to fetch assigned submissions',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async reviewSubmission(
    reviewerAdminId: string,
    body: ReviewSubmissionInput,
  ): Promise<ResponseDto> {
    try {
      const submission = await this.prisma.assignmentSubmission.findUnique({
        where: { id: body.submissionId },
      });
      if (!submission) throw new Error('Submission not found');

      const updated = await this.prisma.assignmentSubmission.update({
        where: { id: body.submissionId },
        data: {
          reviewedByAdminId: reviewerAdminId,
          status: body.status ?? AssignmentSubmissionStatus.in_review,
          feedback: body.feedback ?? submission.feedback,
          score: typeof body.score === 'number' ? body.score : submission.score,
          gradedAt:
            body.status && ['approved', 'rejected'].includes(body.status)
              ? new Date()
              : submission.gradedAt,
        },
      });

      return { message: 'Submission updated', statusCode: 200, data: updated };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to update submission',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  // Admin: create a new assignment for a course
  async createAssignment(
    adminId: string,
    body: {
      title: string;
      description?: string;
      instructions?: string;
      courseId: string;
      assignedToAdminId: string; // Admin who will review submissions
      dueAt?: string;
      maxPoints?: number;
      allowResubmissions?: boolean;
      maxAttempts?: number;
      assignmentFileUrl?: string;
      assignmentFileName?: string;
      assignmentFileType?: AssignmentFileType;
    },
  ): Promise<ResponseDto> {
    try {
      // Verify admin role
      const admin = await this.prisma.user.findUnique({
        where: { id: adminId },
      });
      if (!admin || admin.role !== 'admin') {
        throw new Error('Only admins can create assignments');
      }

      // Verify course exists
      const course = await this.prisma.course.findUnique({
        where: { id: body.courseId },
      });
      if (!course) {
        throw new Error('Course not found');
      }

      const assignment = await this.prisma.assignment.create({
        data: {
          title: body.title,
          description: body.description,
          instructions: body.instructions,
          courseId: body.courseId,
          assignedToAdminId: body.assignedToAdminId,
          dueAt: body.dueAt ? new Date(body.dueAt) : null,
          maxPoints: body.maxPoints,
          allowResubmissions: body.allowResubmissions ?? true,
          maxAttempts: body.maxAttempts,
          createdByAdminId: adminId,
          assignmentFileUrl: body.assignmentFileUrl,
          assignmentFileName: body.assignmentFileName,
          assignmentFileType: body.assignmentFileType,
          isActive: true,
        },
      });

      return {
        message: 'Assignment created successfully',
        statusCode: 200,
        data: assignment,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to create assignment',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  // Admin: get assignments they created
  async getAdminCreatedAssignments(adminId: string): Promise<ResponseDto> {
    try {
      const assignments = await this.prisma.assignment.findMany({
        where: { createdByAdminId: adminId },
        orderBy: { createdAt: 'desc' },
        include: {
          course: { select: { title: true } },
        },
      });

      return {
        message: 'Fetched admin assignments',
        statusCode: 200,
        data: assignments,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to fetch assignments',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  // Admin: update assignment
  async updateAssignment(
    adminId: string,
    body: {
      assignmentId: string;
      title?: string;
      description?: string;
      instructions?: string;
      dueAt?: string;
      maxPoints?: number;
      allowResubmissions?: boolean;
      maxAttempts?: number;
      assignmentFileUrl?: string;
      assignmentFileName?: string;
      assignmentFileType?: AssignmentFileType;
      isActive?: boolean;
    },
  ): Promise<ResponseDto> {
    try {
      // Verify admin owns the assignment
      const assignment = await this.prisma.assignment.findUnique({
        where: { id: body.assignmentId },
      });
      if (!assignment) {
        throw new Error('Assignment not found');
      }
      if (assignment.createdByAdminId !== adminId) {
        throw new Error('You can only update your own assignments');
      }

      const updated = await this.prisma.assignment.update({
        where: { id: body.assignmentId },
        data: {
          title: body.title,
          description: body.description,
          instructions: body.instructions,
          dueAt: body.dueAt ? new Date(body.dueAt) : body.dueAt,
          maxPoints: body.maxPoints,
          allowResubmissions: body.allowResubmissions,
          maxAttempts: body.maxAttempts,
          assignmentFileUrl: body.assignmentFileUrl,
          assignmentFileName: body.assignmentFileName,
          assignmentFileType: body.assignmentFileType,
          isActive: body.isActive,
        },
      });

      return {
        message: 'Assignment updated successfully',
        statusCode: 200,
        data: updated,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to update assignment',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  // Students: get assignments for courses they're enrolled in
  async getAvailableAssignments(studentId: string): Promise<ResponseDto> {
    try {
      // Get courses the student is enrolled in
      const enrolledCourses = await this.prisma.userCourse.findMany({
        where: { userId: studentId, isActive: true },
        select: { courseId: true },
      });

      const courseIds = enrolledCourses.map((ec) => ec.courseId);

      if (courseIds.length === 0) {
        return {
          message: 'No enrolled courses found',
          statusCode: 200,
          data: [],
        };
      }

      // Get active assignments for enrolled courses
      const assignments = await this.prisma.assignment.findMany({
        where: {
          courseId: { in: courseIds },
          isActive: true,
        },
        orderBy: { createdAt: 'desc' },
        include: {
          course: { select: { title: true } },
        },
      });

      return {
        message: 'Fetched available assignments',
        statusCode: 200,
        data: assignments,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to fetch assignments',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  // Get assignment by ID
  async getAssignmentById(assignmentId: string): Promise<ResponseDto> {
    try {
      const assignment = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
        include: {
          course: { select: { title: true } },
        },
      });

      if (!assignment) {
        throw new Error('Assignment not found');
      }

      return {
        message: 'Assignment fetched successfully',
        statusCode: 200,
        data: assignment,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to fetch assignment',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  // Get assignment status for a specific student
  async getAssignmentStatusForStudent(
    studentId: string,
    assignmentId: string,
  ): Promise<ResponseDto> {
    try {
      const submission = await this.prisma.assignmentSubmission.findFirst({
        where: {
          studentId,
          assignmentId,
        },
        orderBy: { createdAt: 'desc' },
      });

      const assignment = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
        include: {
          course: { select: { title: true } },
        },
      });

      if (!assignment) {
        throw new Error('Assignment not found');
      }

      const status = {
        assignment,
        submission: submission || null,
        isSubmitted: !!submission,
        status: submission?.status || null,
        isOverdue: assignment.dueAt ? new Date() > assignment.dueAt : false,
      };

      return {
        message: 'Assignment status fetched successfully',
        statusCode: 200,
        data: status,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to fetch assignment status',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  // Admin: get all submissions for a specific assignment
  async getAssignmentSubmissions(
    assignmentId: string,
    adminId: string,
    status?: AssignmentSubmissionStatus,
  ): Promise<ResponseDto> {
    try {
      // Verify admin has access to this assignment
      const assignment = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
        include: {
          course: { select: { title: true } },
        },
      });

      if (!assignment) {
        throw new Error('Assignment not found');
      }

      // Check if admin is the creator or assigned reviewer
      if (
        assignment.createdByAdminId !== adminId &&
        assignment.assignedToAdminId !== adminId
      ) {
        throw new Error(
          'You do not have access to view submissions for this assignment',
        );
      }

      // Build where clause for submissions
      const where: Prisma.AssignmentSubmissionWhereInput = {
        assignmentId: assignmentId,
      };

      // Add status filter if provided
      if (status) {
        where.status = status;
      }

      // Get all submissions for this assignment
      const submissions = await this.prisma.assignmentSubmission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      // Calculate submission statistics
      const totalSubmissions = submissions.length;
      const submittedCount = submissions.filter(
        (s) => s.status === AssignmentSubmissionStatus.submitted,
      ).length;
      const inReviewCount = submissions.filter(
        (s) => s.status === AssignmentSubmissionStatus.in_review,
      ).length;
      const approvedCount = submissions.filter(
        (s) => s.status === AssignmentSubmissionStatus.approved,
      ).length;
      const rejectedCount = submissions.filter(
        (s) => s.status === AssignmentSubmissionStatus.rejected,
      ).length;
      const returnedCount = submissions.filter(
        (s) => s.status === AssignmentSubmissionStatus.returned,
      ).length;

      const stats = {
        total: totalSubmissions,
        submitted: submittedCount,
        inReview: inReviewCount,
        approved: approvedCount,
        rejected: rejectedCount,
        returned: returnedCount,
      };

      return {
        message: 'Assignment submissions fetched successfully',
        statusCode: 200,
        data: {
          assignment,
          submissions,
          statistics: stats,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to fetch assignment submissions',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  // Student: submit course completion feedback
  async submitCourseFeedback(
    studentId: string,
    courseId: string,
    formData: any,
  ): Promise<ResponseDto> {
    try {
      // Verify course exists
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!course) {
        throw new Error('Course not found');
      }

      // Find the feedback form for this course
      const feedbackForm = await this.prisma.courseFeedbackForm.findFirst({
        where: {
          courseId: courseId,
        },
      });

      if (!feedbackForm) {
        throw new Error('No feedback form found for this course');
      }

      // Check if student is enrolled in the course
      const enrollment = await this.prisma.userCourse.findFirst({
        where: {
          userId: studentId,
          courseId: courseId,
          isActive: true,
        },
      });

      if (!enrollment) {
        throw new Error('You are not enrolled in this course');
      }

      // Check if already completed
      const existingCompletion =
        await this.prisma.courseFeedbackSubmission.findFirst({
          where: {
            userId: studentId,
            courseId: courseId,
          },
        });

      if (existingCompletion) {
        throw new Error(
          'You have already completed the feedback form for this course',
        );
      }

      // Create feedback submission record
      const completion = await this.prisma.courseFeedbackSubmission.create({
        data: {
          userId: studentId,
          courseId: courseId,
          feedbackFormId: feedbackForm.id,
          responses: formData, // Store user's responses
        },
      });

      return {
        message: 'Course feedback submitted successfully',
        statusCode: 200,
        data: completion,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to submit feedback',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  // Student: check course feedback completion status
  async getCourseFeedbackStatus(
    studentId: string,
    courseId: string,
  ): Promise<ResponseDto> {
    try {
      // Find the feedback form for this course
      const feedbackForm = await this.prisma.courseFeedbackForm.findFirst({
        where: {
          courseId: courseId,
        },
      });

      if (!feedbackForm) {
        return {
          message: 'No feedback form found for this course',
          statusCode: 200,
          data: {
            hasFeedbackForm: false,
            isCompleted: false,
            feedbackForm: null,
          },
        };
      }

      // Check if user has completed the feedback
      const completion = await this.prisma.courseFeedbackSubmission.findFirst({
        where: {
          userId: studentId,
          courseId: courseId,
        },
      });

      return {
        message: 'Course feedback status fetched successfully',
        statusCode: 200,
        data: {
          hasFeedbackForm: true,
          isCompleted: !!completion,
          feedbackForm: {
            formName: feedbackForm.formName,
            isRequired: feedbackForm.isRequired,
            submittedAt: completion?.submittedAt || null,
          },
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to fetch feedback status',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  // Admin: get all feedback submissions for a course
  async getCourseFeedbackSubmissions(
    courseId: string,
    adminId: string,
  ): Promise<ResponseDto> {
    try {
      // Verify admin role
      const admin = await this.prisma.user.findUnique({
        where: { id: adminId },
      });
      if (!admin || admin.role !== 'admin') {
        throw new Error('Only admins can view feedback submissions');
      }

      // Get all feedback submissions for the course
      const completions = await this.prisma.courseFeedbackSubmission.findMany({
        where: {
          courseId: courseId,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: { submittedAt: 'desc' },
      });

      return {
        message: 'Course feedback submissions fetched successfully',
        statusCode: 200,
        data: {
          courseId,
          submissions: completions.map((completion) => ({
            user: completion.user,
            submittedAt: completion.submittedAt,
            responses: completion.responses,
          })),
          totalSubmissions: completions.length,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.FORBIDDEN,
          error: error?.message || 'Failed to fetch feedback submissions',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
