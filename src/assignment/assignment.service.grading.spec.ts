import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AssignmentGradingMode, AssignmentSubmissionStatus } from '@prisma/client';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { makeAbortAwareTransactionMock } from '../test-utils/prisma-transaction-mock';
import { AssignmentService } from './assignment.service';

describe('AssignmentService gradingMode', () => {
  let service: AssignmentService;
  let prisma: Record<string, any>;
  let notifications: {
    createNotification: jest.Mock;
    createNotificationForMany: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'admin-1', role: 'admin' }),
      },
      course: {
        findUnique: jest.fn().mockResolvedValue({ id: 'course-1', title: 'NEBOSH IGC' }),
      },
      userCourse: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      assignment: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      assignmentAttachment: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      assignmentSubmission: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    prisma.$transaction = makeAbortAwareTransactionMock(prisma);

    notifications = {
      createNotification: jest.fn().mockResolvedValue(undefined),
      createNotificationForMany: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notifications },
      ],
    }).compile();

    service = module.get(AssignmentService);
  });

  describe('createAssignment', () => {
    it('defaults to numeric with maxPoints 100', async () => {
      prisma.assignment.create.mockResolvedValue({
        id: 'asg-1',
        title: 'Mock',
        courseId: 'course-1',
        gradingMode: AssignmentGradingMode.numeric,
        maxPoints: 100,
        dueAt: null,
        attachments: [],
      });

      await service.createAssignment('admin-1', {
        title: 'Mock',
        courseId: 'course-1',
        assignedToAdminId: 'admin-1',
      });

      expect(prisma.assignment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            gradingMode: AssignmentGradingMode.numeric,
            maxPoints: 100,
          }),
        }),
      );
    });

    it('forces maxPoints null for pass_fail', async () => {
      prisma.assignment.create.mockResolvedValue({
        id: 'asg-1',
        title: 'Practical',
        courseId: 'course-1',
        gradingMode: AssignmentGradingMode.pass_fail,
        maxPoints: null,
        dueAt: null,
        attachments: [],
      });

      await service.createAssignment('admin-1', {
        title: 'Practical',
        courseId: 'course-1',
        assignedToAdminId: 'admin-1',
        gradingMode: 'pass_fail',
        maxPoints: 100,
      });

      expect(prisma.assignment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            gradingMode: AssignmentGradingMode.pass_fail,
            maxPoints: null,
          }),
        }),
      );
    });
  });

  describe('reviewSubmission', () => {
    const numericSubmission = {
      id: 'sub-1',
      studentId: 'student-1',
      assignmentId: 'asg-1',
      score: null,
      feedback: null,
      gradedAt: null,
      assignment: {
        gradingMode: AssignmentGradingMode.numeric,
        maxPoints: 100,
      },
    };

    const passFailSubmission = {
      ...numericSubmission,
      assignment: {
        gradingMode: AssignmentGradingMode.pass_fail,
        maxPoints: null,
      },
    };

    it('requires score when approving a numeric assignment', async () => {
      prisma.assignmentSubmission.findUnique.mockResolvedValue(numericSubmission);

      await expect(
        service.reviewSubmission('admin-1', {
          submissionId: 'sub-1',
          status: AssignmentSubmissionStatus.approved,
        }),
      ).rejects.toBeInstanceOf(HttpException);

      expect(prisma.assignmentSubmission.update).not.toHaveBeenCalled();
    });

    it('rejects score on pass_fail review', async () => {
      prisma.assignmentSubmission.findUnique.mockResolvedValue(passFailSubmission);

      await expect(
        service.reviewSubmission('admin-1', {
          submissionId: 'sub-1',
          status: AssignmentSubmissionStatus.approved,
          score: 87,
        }),
      ).rejects.toBeInstanceOf(HttpException);

      expect(prisma.assignmentSubmission.update).not.toHaveBeenCalled();
    });

    it('approves pass_fail without score and stores score null', async () => {
      prisma.assignmentSubmission.findUnique.mockResolvedValue(passFailSubmission);
      prisma.assignmentSubmission.update.mockResolvedValue({
        ...passFailSubmission,
        status: AssignmentSubmissionStatus.approved,
        score: null,
        attachments: [],
        assignment: {
          id: 'asg-1',
          title: 'Practical',
          gradingMode: AssignmentGradingMode.pass_fail,
          maxPoints: null,
        },
      });
      prisma.assignment.findUnique.mockResolvedValue({
        title: 'Practical',
        maxPoints: null,
        gradingMode: AssignmentGradingMode.pass_fail,
      });

      await service.reviewSubmission('admin-1', {
        submissionId: 'sub-1',
        status: AssignmentSubmissionStatus.approved,
      });

      expect(prisma.assignmentSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AssignmentSubmissionStatus.approved,
            score: null,
          }),
        }),
      );
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            gradingMode: AssignmentGradingMode.pass_fail,
            score: null,
          }),
        }),
      );
    });
  });
});
