import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { CourseVersionService } from '../course-version/course-version.service';
import { CourseAssessmentService } from './course-assessment.service';

/**
 * Regression coverage for the version-aware assessment content gate (#4).
 *
 * Before the fix, _isCourseContentCompleted counted every live section in the
 * course. A learner pinned to an older version who had completed all of THEIR
 * frozen sections could be blocked from the assessment as soon as an admin
 * added new sections. The gate now resolves the denominator through
 * CourseVersionService.countCompletionDenominator (frozen per enrollment).
 */
describe('CourseAssessmentService — version-aware content gate', () => {
  let service: CourseAssessmentService;
  let prisma: Record<string, any>;
  let courseVersionService: { countCompletionDenominator: jest.Mock };

  beforeEach(async () => {
    prisma = {
      section: { count: jest.fn(), findMany: jest.fn() },
      userCourseProgress: { count: jest.fn(), findMany: jest.fn() },
      userCourse: { findFirst: jest.fn() },
      course: { findUnique: jest.fn() },
      courseCompletion: { findUnique: jest.fn() },
      assessment: { findMany: jest.fn() },
      assessmentAttempt: { findMany: jest.fn() },
    };

    courseVersionService = {
      countCompletionDenominator: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CourseAssessmentService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: {} },
        { provide: CourseVersionService, useValue: courseVersionService },
      ],
    }).compile();

    service = moduleRef.get(CourseAssessmentService);
    jest.clearAllMocks();
  });

  const callGate = (userId: string, courseId: string): Promise<boolean> =>
    (service as any)._isCourseContentCompleted(userId, courseId);

  it('uses the frozen version denominator, NOT the live section count', async () => {
    // Frozen version has 3 sections; learner completed all 3. Live tree now has
    // 5 sections (admin added 2 after enrollment). Pre-fix this returned false.
    courseVersionService.countCompletionDenominator.mockResolvedValue({
      total: 3,
      liveSectionIds: ['s1', 's2', 's3'],
    });
    prisma.userCourseProgress.findMany.mockResolvedValue([
      { sectionId: 's1' },
      { sectionId: 's2' },
      { sectionId: 's3' },
    ]);

    await expect(callGate('user-1', 'course-1')).resolves.toBe(true);

    // The gate must not fall back to a raw live section count.
    expect(prisma.section.count).not.toHaveBeenCalled();
    expect(
      courseVersionService.countCompletionDenominator,
    ).toHaveBeenCalledWith('user-1', 'course-1');
    // Numerator query is scoped to the frozen section ids only.
    expect(prisma.userCourseProgress.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        courseId: 'course-1',
        sectionId: { in: ['s1', 's2', 's3'] },
      },
      select: { sectionId: true },
      distinct: ['sectionId'],
    });
  });

  it('returns false when the learner has not finished all frozen sections', async () => {
    courseVersionService.countCompletionDenominator.mockResolvedValue({
      total: 3,
      liveSectionIds: ['s1', 's2', 's3'],
    });
    prisma.userCourseProgress.findMany.mockResolvedValue([
      { sectionId: 's1' },
      { sectionId: 's2' },
    ]);

    await expect(callGate('user-1', 'course-1')).resolves.toBe(false);
  });

  it('treats a content-free course as complete', async () => {
    courseVersionService.countCompletionDenominator.mockResolvedValue({
      total: 0,
      liveSectionIds: [],
    });

    await expect(callGate('user-1', 'course-1')).resolves.toBe(true);
    expect(prisma.userCourseProgress.findMany).not.toHaveBeenCalled();
  });

  it('ignores stale progress rows outside the frozen section set', async () => {
    // Learner has 3 progress rows but one (s-old) is a section removed from the
    // version. Only frozen ids count, so 2/3 → not complete.
    courseVersionService.countCompletionDenominator.mockResolvedValue({
      total: 3,
      liveSectionIds: ['s1', 's2', 's3'],
    });
    prisma.userCourseProgress.findMany.mockResolvedValue([
      { sectionId: 's1' },
      { sectionId: 's2' },
    ]);

    await expect(callGate('user-1', 'course-1')).resolves.toBe(false);
  });

  describe('getActiveAssessmentForStudent (public path)', () => {
    it('marks the learner eligible using the frozen denominator', async () => {
      prisma.userCourse.findFirst.mockResolvedValue({
        id: 'uc-1',
        userId: 'user-1',
        courseId: 'course-1',
        isActive: true,
      });
      prisma.courseCompletion.findUnique.mockResolvedValue(null);
      prisma.course.findUnique.mockResolvedValue({ validityDays: 365 });
      prisma.assessment.findMany.mockResolvedValue([
        {
          id: 'assess-1',
          title: 'Final',
          description: null,
          mode: 'AUTO',
          passingPercentage: 70,
          timeLimitMinutes: 60,
          maxAttempts: 3,
        },
      ]);
      prisma.assessmentAttempt.findMany.mockResolvedValue([]);

      // Frozen: 2 sections, both done — even though live tree may have grown.
      courseVersionService.countCompletionDenominator.mockResolvedValue({
        total: 2,
        liveSectionIds: ['s1', 's2'],
      });
      prisma.userCourseProgress.findMany.mockResolvedValue([
        { sectionId: 's1' },
        { sectionId: 's2' },
      ]);

      const res = await service.getActiveAssessmentForStudent(
        'user-1',
        'course-1',
      );

      expect(res.statusCode).toBe(200);
      expect(res.data[0].isEligible).toBe(true);
      expect(res.data[0].canStart).toBe(true);
    });
  });
});
