import { HttpException } from '@nestjs/common';
import { User } from '@prisma/client';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

/**
 * These routes are addressed by a `:userId` in the path but guarded only by
 * `cJwt`, which admits any authenticated user. Without an ownership check a
 * student could read another student's login history — including their IP
 * addresses. These tests pin that check.
 */
describe('TrackingController — cross-user access', () => {
  let controller: TrackingController;
  let tracking: { getLoginHistory: jest.Mock; getUserCourseTimeSpent: jest.Mock };

  const asUser = (id: string, role: string) => ({ id, role }) as unknown as User;

  beforeEach(() => {
    tracking = {
      getLoginHistory: jest.fn().mockResolvedValue({ data: [] }),
      getUserCourseTimeSpent: jest.fn().mockResolvedValue({ data: {} }),
    };
    controller = new TrackingController(tracking as unknown as TrackingService);
  });

  describe('login-history/:userId', () => {
    it('lets a student read their own history', async () => {
      await controller.getLoginHistory(asUser('user-1', 'user'), 'user-1');
      expect(tracking.getLoginHistory).toHaveBeenCalledWith('user-1', undefined);
    });

    it("refuses a student reading someone else's history", () => {
      expect(() =>
        controller.getLoginHistory(asUser('user-1', 'user'), 'user-2'),
      ).toThrow(HttpException);
      expect(tracking.getLoginHistory).not.toHaveBeenCalled();
    });

    it('lets an admin read any history', async () => {
      await controller.getLoginHistory(asUser('admin-1', 'admin'), 'user-2');
      expect(tracking.getLoginHistory).toHaveBeenCalledWith('user-2', undefined);
    });
  });

  describe('time-spent/:userId/:courseId', () => {
    it('lets a student read their own time', async () => {
      await controller.getUserCourseTimeSpent(
        asUser('user-1', 'user'),
        'user-1',
        'course-1',
      );
      expect(tracking.getUserCourseTimeSpent).toHaveBeenCalledWith(
        'user-1',
        'course-1',
      );
    });

    it("refuses a student reading someone else's time", () => {
      expect(() =>
        controller.getUserCourseTimeSpent(
          asUser('user-1', 'user'),
          'user-2',
          'course-1',
        ),
      ).toThrow(HttpException);
      expect(tracking.getUserCourseTimeSpent).not.toHaveBeenCalled();
    });

    it('lets an admin read any user', async () => {
      await controller.getUserCourseTimeSpent(
        asUser('admin-1', 'admin'),
        'user-2',
        'course-1',
      );
      expect(tracking.getUserCourseTimeSpent).toHaveBeenCalled();
    });
  });
});
