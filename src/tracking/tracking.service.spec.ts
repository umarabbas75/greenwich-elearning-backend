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

    const result = await service.recordSectionAttempt('user-1', 'sec-1', false);

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

    const result = await service.recordSectionAttempt('user-1', 'sec-1', true);

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

  it('returns 400 for FLASHCARDS sections', async () => {
    prisma.section.findUnique.mockResolvedValue({
      id: 'sec-1',
      type: SectionType.FLASHCARDS,
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

/**
 * Coverage for `heartbeat()` — previously untested despite carrying the clamp
 * that is the service's only defence against a client over-claiming time, and
 * the compare-and-set that stops two tabs crediting the same window twice.
 */
describe('TrackingService.heartbeat', () => {
  let service: TrackingService;
  let prisma: {
    section: { findUnique: jest.Mock };
    sectionTimeSpent: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      updateMany: jest.Mock;
    };
    sectionTimeSpentDaily: { upsert: jest.Mock };
    courseCompletion: { findUnique: jest.Mock };
  };

  const NOW = new Date('2026-09-12T12:00:00.000Z');
  /** `lastHeartbeatAt` this many seconds before NOW. */
  const agoSeconds = (s: number) => new Date(NOW.getTime() - s * 1000);

  const existingRow = (over: Partial<Record<string, unknown>> = {}) => ({
    userId: 'user-1',
    sectionId: 'sec-1',
    totalSeconds: 100,
    lastHeartbeatAt: agoSeconds(5),
    ...over,
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    prisma = {
      section: { findUnique: jest.fn() },
      sectionTimeSpent: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
      sectionTimeSpentDaily: { upsert: jest.fn() },
      courseCompletion: { findUnique: jest.fn() },
    };
    // Default: course not completed, so time accrues normally.
    prisma.courseCompletion.findUnique.mockResolvedValue(null);
    prisma.section.findUnique.mockResolvedValue({
      id: 'sec-1',
      chapterId: 'ch-1',
      moduleId: 'mod-1',
      chapter: { moduleId: 'mod-1', module: { courseId: 'course-1' } },
    });
    prisma.sectionTimeSpent.updateMany.mockResolvedValue({ count: 1 });
    prisma.sectionTimeSpentDaily.upsert.mockResolvedValue({});
    service = new TrackingService(prisma as any);
  });

  afterEach(() => jest.useRealTimers());

  it('credits nothing on the first ping and opens the row', async () => {
    prisma.sectionTimeSpent.findUnique.mockResolvedValue(null);
    prisma.sectionTimeSpent.upsert.mockResolvedValue({ totalSeconds: 0 });

    const res = await service.heartbeat('user-1', 'sec-1', 30, 30);

    expect(res.data).toEqual({
      totalSeconds: 0,
      creditedSeconds: 0,
      frozen: false,
    });
    expect(prisma.sectionTimeSpent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ totalSeconds: 0 }),
      }),
    );
    // No credit means no daily roll-up row.
    expect(prisma.sectionTimeSpentDaily.upsert).not.toHaveBeenCalled();
  });

  it('clamps the claim to real elapsed server time', async () => {
    // Client claims 100s but only 3s of wall-clock has passed since the last ping.
    prisma.sectionTimeSpent.findUnique.mockResolvedValue(
      existingRow({ lastHeartbeatAt: agoSeconds(3) }),
    );

    const res = await service.heartbeat('user-1', 'sec-1', 100, 5);

    expect(res.data.creditedSeconds).toBe(3);
    expect(res.data.totalSeconds).toBe(103);
    expect(prisma.sectionTimeSpentDaily.upsert).toHaveBeenCalled();
  });

  it('clamps a single ping to perPingCap (interval x 3)', async () => {
    // A 10-minute gap with a matching claim: capped at 5 * 3 = 15s.
    prisma.sectionTimeSpent.findUnique.mockResolvedValue(
      existingRow({ lastHeartbeatAt: agoSeconds(600) }),
    );

    const res = await service.heartbeat('user-1', 'sec-1', 600, 5);

    expect(res.data.creditedSeconds).toBe(15);
  });

  it('raises the cap with the cadence (30s interval -> 90s cap)', async () => {
    prisma.sectionTimeSpent.findUnique.mockResolvedValue(
      existingRow({ lastHeartbeatAt: agoSeconds(600) }),
    );

    const res = await service.heartbeat('user-1', 'sec-1', 600, 30);

    expect(res.data.creditedSeconds).toBe(90);
  });

  it('credits ~0 for an away gap the client reports as inactive', async () => {
    // The whole point of client-measured active time: a 10-minute idle gap
    // credits nothing, because the client claims nothing.
    prisma.sectionTimeSpent.findUnique.mockResolvedValue(
      existingRow({ lastHeartbeatAt: agoSeconds(600) }),
    );

    const res = await service.heartbeat('user-1', 'sec-1', 0, 30);

    expect(res.data.creditedSeconds).toBe(0);
  });

  it('advances lastHeartbeatAt even when credit is 0', async () => {
    prisma.sectionTimeSpent.findUnique.mockResolvedValue(
      existingRow({ lastHeartbeatAt: agoSeconds(600) }),
    );

    await service.heartbeat('user-1', 'sec-1', 0, 30);

    expect(prisma.sectionTimeSpent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastHeartbeatAt: NOW }),
      }),
    );
  });

  it('uses the conservative fallback for old clients sending no activeSeconds', async () => {
    prisma.sectionTimeSpent.findUnique.mockResolvedValue(
      existingRow({ lastHeartbeatAt: agoSeconds(600) }),
    );

    const res = await service.heartbeat('user-1', 'sec-1', undefined, 5);

    // min(gap, interval * GRACE_FACTOR) = min(600, 7.5) -> rounds to 8.
    expect(res.data.creditedSeconds).toBe(8);
  });

  it('credits nothing when a concurrent ping already advanced the row', async () => {
    // The compare-and-set guard: two tabs read the same lastHeartbeatAt and
    // derive the same serverGap. The loser must not apply it a second time.
    prisma.sectionTimeSpent.findUnique
      .mockResolvedValueOnce(existingRow({ lastHeartbeatAt: agoSeconds(30) }))
      .mockResolvedValueOnce({ totalSeconds: 130 });
    prisma.sectionTimeSpent.updateMany.mockResolvedValue({ count: 0 });

    const res = await service.heartbeat('user-1', 'sec-1', 30, 30);

    expect(res.data.creditedSeconds).toBe(0);
    expect(res.data.totalSeconds).toBe(130);
    expect(prisma.sectionTimeSpentDaily.upsert).not.toHaveBeenCalled();
  });

  it('guards the update on the exact lastHeartbeatAt it read', async () => {
    const read = agoSeconds(30);
    prisma.sectionTimeSpent.findUnique.mockResolvedValue(
      existingRow({ lastHeartbeatAt: read }),
    );

    await service.heartbeat('user-1', 'sec-1', 30, 30);

    expect(prisma.sectionTimeSpent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ lastHeartbeatAt: read }),
      }),
    );
  });

  it('credits nothing once the course is completed', async () => {
    // A completed learner revisiting a lesson must not move the number that
    // backs their certificate.
    prisma.courseCompletion.findUnique.mockResolvedValue({
      courseCompletedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    prisma.sectionTimeSpent.findUnique.mockResolvedValue({ totalSeconds: 742 });

    const res = await service.heartbeat('user-1', 'sec-1', 30, 30);

    expect(res.data).toEqual({
      totalSeconds: 742,
      creditedSeconds: 0,
      frozen: true,
    });
    // Nothing is written at all.
    expect(prisma.sectionTimeSpent.updateMany).not.toHaveBeenCalled();
    expect(prisma.sectionTimeSpent.upsert).not.toHaveBeenCalled();
    expect(prisma.sectionTimeSpentDaily.upsert).not.toHaveBeenCalled();
  });

  it('still accrues when a completion row exists but is not complete', async () => {
    // Enrolled + assessment row present, but courseCompletedAt not yet set.
    prisma.courseCompletion.findUnique.mockResolvedValue({
      courseCompletedAt: null,
    });
    prisma.sectionTimeSpent.findUnique.mockResolvedValue(
      existingRow({ lastHeartbeatAt: agoSeconds(30) }),
    );

    const res = await service.heartbeat('user-1', 'sec-1', 30, 30);

    expect(res.data.frozen).toBe(false);
    expect(res.data.creditedSeconds).toBe(30);
  });

  it('rejects an unknown section', async () => {
    prisma.section.findUnique.mockResolvedValue(null);
    await expect(service.heartbeat('user-1', 'nope', 5, 30)).rejects.toThrow(
      HttpException,
    );
  });

  it('rejects a section with no resolvable course', async () => {
    prisma.section.findUnique.mockResolvedValue({
      id: 'sec-1',
      chapterId: 'ch-1',
      moduleId: null,
      chapter: { moduleId: null, module: null },
    });
    await expect(service.heartbeat('user-1', 'sec-1', 5, 30)).rejects.toThrow(
      HttpException,
    );
  });

  it('reuses the section lookup across pings for the same section', async () => {
    prisma.sectionTimeSpent.findUnique.mockResolvedValue(
      existingRow({ lastHeartbeatAt: agoSeconds(5) }),
    );

    await service.heartbeat('user-1', 'sec-1', 5, 5);
    await service.heartbeat('user-1', 'sec-1', 5, 5);

    expect(prisma.section.findUnique).toHaveBeenCalledTimes(1);
  });

  it('skips the completion lookup on the next ping within the not-frozen TTL', async () => {
    prisma.sectionTimeSpent.findUnique.mockResolvedValue(
      existingRow({ lastHeartbeatAt: agoSeconds(5) }),
    );

    await service.heartbeat('user-1', 'sec-1', 5, 5);
    await service.heartbeat('user-1', 'sec-1', 5, 5);

    expect(prisma.courseCompletion.findUnique).toHaveBeenCalledTimes(1);
  });

  it('does not re-query completion or time on subsequent pings once frozen', async () => {
    prisma.courseCompletion.findUnique.mockResolvedValue({
      courseCompletedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    prisma.sectionTimeSpent.findUnique.mockResolvedValue({ totalSeconds: 742 });

    const first = await service.heartbeat('user-1', 'sec-1', 30, 30);
    const second = await service.heartbeat('user-1', 'sec-1', 30, 30);

    expect(first.data).toEqual(second.data);
    expect(prisma.courseCompletion.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.sectionTimeSpent.findUnique).toHaveBeenCalledTimes(1);
  });
});
