import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AssignmentSubmissionStatus } from '@prisma/client';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { makeAbortAwareTransactionMock } from '../test-utils/prisma-transaction-mock';
import { AssignmentService } from './assignment.service';

describe('AssignmentService.createSubmission — returned resubmit', () => {
  let service: AssignmentService;
  let prisma: Record<string, any>;
  let notifications: {
    createNotification: jest.Mock;
    createNotificationForMany: jest.Mock;
  };

  const assignment = {
    id: 'asg-1',
    title: 'GIC1 Mock',
    courseId: 'course-1',
    assignedToAdminId: 'admin-1',
    isActive: true,
    allowResubmissions: true,
    course: { id: 'course-1', title: 'NEBOSH IGC' },
  };

  const files = [
    {
      fileUrl: 'https://cdn.example/FAKHAR-HANNAN-GIC1-MOCK.pdf',
      fileName: 'FAKHAR-HANNAN-GIC1-MOCK.pdf',
      fileType: 'pdf' as const,
    },
  ];

  beforeEach(async () => {
    prisma = {
      assignment: { findUnique: jest.fn().mockResolvedValue(assignment) },
      userCourse: {
        findFirst: jest.fn().mockResolvedValue({ id: 'enroll-1' }),
      },
      assignmentSubmission: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      assignmentSubmissionAttachment: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          firstName: 'Fakhar',
          lastName: 'Hannan',
        }),
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

  it('updates the existing row when status is returned', async () => {
    const resubmittedAt = new Date('2026-08-18T09:00:00.000Z');
    prisma.assignmentSubmission.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'sub-1',
        status: AssignmentSubmissionStatus.returned,
      });
    prisma.assignmentSubmission.update.mockResolvedValue({
      id: 'sub-1',
      assignmentId: 'asg-1',
      studentId: 'student-1',
      status: AssignmentSubmissionStatus.submitted,
      submittedAt: resubmittedAt,
      attachments: [
        {
          fileUrl: files[0].fileUrl,
          fileName: files[0].fileName,
          fileType: files[0].fileType,
          sortOrder: 0,
        },
      ],
    });

    const result = await service.createSubmission('student-1', {
      assignmentId: 'asg-1',
      submissionAttachments: files,
    });

    expect(prisma.assignmentSubmission.create).not.toHaveBeenCalled();
    expect(prisma.assignmentSubmissionAttachment.deleteMany).toHaveBeenCalledWith({
      where: { submissionId: 'sub-1' },
    });
    expect(prisma.assignmentSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sub-1' },
        data: expect.objectContaining({
          status: AssignmentSubmissionStatus.submitted,
          score: null,
          gradedAt: null,
          reviewedByAdminId: null,
        }),
      }),
    );
    expect(result.statusCode).toBe(200);
    expect(result.message).toBe('Assignment resubmitted successfully');

    // Reviewer notification MUST fire on resubmit (regression guard for the
    // dedupeKey bug where every resubmit collapsed onto the original bell row).
    expect(notifications.createNotification).toHaveBeenCalledTimes(1);
    const notifyCall = notifications.createNotification.mock.calls[0][0];
    expect(notifyCall).toMatchObject({
      userId: 'admin-1',
      type: 'ASSIGNMENT_SUBMITTED',
      referenceId: 'sub-1',
      commenterId: 'student-1',
      groupKey: 'assignment-submitted:asg-1',
      dedupeKey: `assignment-submitted:sub-1:${resubmittedAt.getTime()}`,
    });
    expect(notifyCall.payload).toMatchObject({
      assignmentId: 'asg-1',
      submissionId: 'sub-1',
      studentId: 'student-1',
      studentName: 'Fakhar Hannan',
    });
  });

  it('notifies the reviewer on the original submit with a submittedAt-scoped dedupeKey', async () => {
    const submittedAt = new Date('2026-08-18T08:00:00.000Z');
    prisma.assignmentSubmission.findFirst
      .mockResolvedValueOnce(null) // uniqueness check
      .mockResolvedValueOnce(null); // "existing submission" check
    prisma.assignmentSubmission.create.mockResolvedValue({
      id: 'sub-new',
      assignmentId: 'asg-1',
      studentId: 'student-1',
      status: AssignmentSubmissionStatus.submitted,
      submittedAt,
      attachments: [
        {
          fileUrl: files[0].fileUrl,
          fileName: files[0].fileName,
          fileType: files[0].fileType,
          sortOrder: 0,
        },
      ],
    });

    const result = await service.createSubmission('student-1', {
      assignmentId: 'asg-1',
      submissionAttachments: files,
    });

    expect(prisma.assignmentSubmission.update).not.toHaveBeenCalled();
    expect(result.message).toBe('Assignment submitted successfully');
    expect(notifications.createNotification).toHaveBeenCalledTimes(1);
    expect(notifications.createNotification.mock.calls[0][0]).toMatchObject({
      userId: 'admin-1',
      type: 'ASSIGNMENT_SUBMITTED',
      referenceId: 'sub-new',
      dedupeKey: `assignment-submitted:sub-new:${submittedAt.getTime()}`,
    });
  });

  it('a returned submit followed by a real resubmit produces two distinct dedupeKeys', async () => {
    // Original submit.
    const firstSubmittedAt = new Date('2026-08-18T08:00:00.000Z');
    prisma.assignmentSubmission.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.assignmentSubmission.create.mockResolvedValueOnce({
      id: 'sub-1',
      assignmentId: 'asg-1',
      studentId: 'student-1',
      status: AssignmentSubmissionStatus.submitted,
      submittedAt: firstSubmittedAt,
      attachments: [],
    });

    await service.createSubmission('student-1', {
      assignmentId: 'asg-1',
      submissionAttachments: files,
    });

    // Tutor returned the DOCX; student resubmits a PDF.
    const secondSubmittedAt = new Date('2026-08-18T09:00:00.000Z');
    prisma.assignmentSubmission.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'sub-1',
        status: AssignmentSubmissionStatus.returned,
      });
    prisma.assignmentSubmission.update.mockResolvedValueOnce({
      id: 'sub-1',
      assignmentId: 'asg-1',
      studentId: 'student-1',
      status: AssignmentSubmissionStatus.submitted,
      submittedAt: secondSubmittedAt,
      attachments: [],
    });

    await service.createSubmission('student-1', {
      assignmentId: 'asg-1',
      submissionAttachments: files,
    });

    expect(notifications.createNotification).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = notifications.createNotification.mock.calls;
    expect(firstCall[0].dedupeKey).toBe(
      `assignment-submitted:sub-1:${firstSubmittedAt.getTime()}`,
    );
    expect(secondCall[0].dedupeKey).toBe(
      `assignment-submitted:sub-1:${secondSubmittedAt.getTime()}`,
    );
    // Same submission row, but different keys → the partial unique on
    // (userId, dedupeKey) won't collapse the second insert.
    expect(firstCall[0].dedupeKey).not.toBe(secondCall[0].dedupeKey);
  });

  it('still rejects a second submit when status is submitted', async () => {
    prisma.assignmentSubmission.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'sub-1',
        status: AssignmentSubmissionStatus.submitted,
      });

    await expect(
      service.createSubmission('student-1', {
        assignmentId: 'asg-1',
        submissionAttachments: files,
      }),
    ).rejects.toBeInstanceOf(HttpException);

    expect(prisma.assignmentSubmission.update).not.toHaveBeenCalled();
    expect(prisma.assignmentSubmission.create).not.toHaveBeenCalled();
  });
});
