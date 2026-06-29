import { HttpException } from '@nestjs/common';
import { SectionType } from '@prisma/client';
import { TrackingService } from './tracking.service';

describe('TrackingService.recordSectionAttempt', () => {
  let service: TrackingService;
  let prisma: {
    section: { findUnique: jest.Mock };
    userCourse: { findFirst: jest.Mock };
    sectionTimeSpent: { upsert: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      section: { findUnique: jest.fn() },
      userCourse: { findFirst: jest.fn() },
      sectionTimeSpent: { upsert: jest.fn() },
    };
    service = new TrackingService(prisma as any);
  });

  it('increments totalAttempts for interactive sections', async () => {
    prisma.section.findUnique.mockResolvedValue({
      id: 'sec-1',
      type: SectionType.ORDERING,
      chapterId: 'ch-1',
      moduleId: 'mod-1',
      chapter: { moduleId: 'mod-1', module: { courseId: 'course-1' } },
    });
    prisma.userCourse.findFirst.mockResolvedValue({ id: 'enroll-1' });
    prisma.sectionTimeSpent.upsert.mockResolvedValue({
      totalAttempts: 1,
      lastAttemptAt: new Date('2026-06-29T18:57:00.000Z'),
    });

    const result = await service.recordSectionAttempt(
      'user-1',
      'sec-1',
      false,
    );

    expect(result.data.totalAttempts).toBe(1);
    expect(prisma.sectionTimeSpent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ totalAttempts: 1 }),
      }),
    );
  });

  it('increments on subsequent attempts', async () => {
    prisma.section.findUnique.mockResolvedValue({
      id: 'sec-1',
      type: SectionType.ORDERING,
      chapterId: 'ch-1',
      moduleId: 'mod-1',
      chapter: { moduleId: 'mod-1', module: { courseId: 'course-1' } },
    });
    prisma.userCourse.findFirst.mockResolvedValue({ id: 'enroll-1' });
    prisma.sectionTimeSpent.upsert.mockResolvedValue({
      totalAttempts: 2,
      lastAttemptAt: new Date('2026-06-29T19:00:00.000Z'),
    });

    const result = await service.recordSectionAttempt(
      'user-1',
      'sec-1',
      true,
    );

    expect(result.data.totalAttempts).toBe(2);
    expect(prisma.sectionTimeSpent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          totalAttempts: { increment: 1 },
        }),
      }),
    );
  });

  it('returns 400 for DEFAULT sections', async () => {
    prisma.section.findUnique.mockResolvedValue({
      id: 'sec-1',
      type: SectionType.DEFAULT,
      chapterId: 'ch-1',
      moduleId: 'mod-1',
      chapter: { moduleId: 'mod-1', module: { courseId: 'course-1' } },
    });

    await expect(
      service.recordSectionAttempt('user-1', 'sec-1', true),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('returns 403 when user is not enrolled', async () => {
    prisma.section.findUnique.mockResolvedValue({
      id: 'sec-1',
      type: SectionType.MATCHING,
      chapterId: 'ch-1',
      moduleId: 'mod-1',
      chapter: { moduleId: 'mod-1', module: { courseId: 'course-1' } },
    });
    prisma.userCourse.findFirst.mockResolvedValue(null);

    await expect(
      service.recordSectionAttempt('user-1', 'sec-1', false),
    ).rejects.toMatchObject({ getStatus: expect.any(Function) });
  });
});
