import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { CourseVersionService } from '../course-version/course-version.service';
import { CertificateService } from '../certificate/certificate.service';
import { CourseAssessmentService } from './course-assessment.service';

/**
 * The student nav asks once which enrolled courses have an assessment, rather
 * than calling the availability endpoint per course. It must apply the same
 * gates that endpoint does: active enrolment and unexpired access.
 */
describe('CourseAssessmentService.getStudentAssessmentCourseIds', () => {
  let service: CourseAssessmentService;
  let prisma: Record<string, any>;

  const DAY = 24 * 60 * 60 * 1000;

  beforeEach(async () => {
    prisma = {
      userCourse: { findMany: jest.fn() },
      courseCompletion: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CourseAssessmentService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: {} },
        { provide: CourseVersionService, useValue: {} },
        { provide: CertificateService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(CourseAssessmentService);
  });

  it('asks only for active enrolments in courses with an active assessment', async () => {
    prisma.userCourse.findMany.mockResolvedValue([]);

    const res = await service.getStudentAssessmentCourseIds('user-1');

    expect(prisma.userCourse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          isActive: true,
          course: { courseAssessments: { some: { isActive: true } } },
        },
      }),
    );
    expect(prisma.courseCompletion.findMany).not.toHaveBeenCalled();
    expect(res!.data.courseIds).toEqual([]);
  });

  it('drops courses whose post-completion access has expired', async () => {
    prisma.userCourse.findMany.mockResolvedValue([
      { courseId: 'not-done', course: { validityDays: 30 } },
      { courseId: 'done-recently', course: { validityDays: 30 } },
      { courseId: 'done-long-ago', course: { validityDays: 30 } },
    ]);
    prisma.courseCompletion.findMany.mockResolvedValue([
      {
        courseId: 'done-recently',
        courseCompletedAt: new Date(Date.now() - 5 * DAY),
        validityDaysAtCompletion: 30,
      },
      {
        courseId: 'done-long-ago',
        courseCompletedAt: new Date(Date.now() - 60 * DAY),
        validityDaysAtCompletion: 30,
      },
    ]);

    const res = await service.getStudentAssessmentCourseIds('user-1');

    expect(res!.data.courseIds).toEqual(['not-done', 'done-recently']);
  });
});
