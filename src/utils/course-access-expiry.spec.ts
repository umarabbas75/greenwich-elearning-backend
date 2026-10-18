import { courseAccessExpiresAt } from './course-access-expiry';

describe('courseAccessExpiresAt', () => {
  const completedAt = new Date('2026-04-23T10:00:00.000Z');

  it('keeps the window granted at completion when the course is shortened later', () => {
    expect(courseAccessExpiresAt(completedAt, 365, 90)).toEqual(
      new Date('2027-04-23T10:00:00.000Z'),
    );
  });

  it('extends access when the course window is raised', () => {
    expect(courseAccessExpiresAt(completedAt, 90, 365)).toEqual(
      new Date('2027-04-23T10:00:00.000Z'),
    );
  });

  it('uses the current value for completions recorded before the window was stored', () => {
    expect(courseAccessExpiresAt(completedAt, null, 30)).toEqual(
      new Date('2026-05-23T10:00:00.000Z'),
    );
  });

  it('defaults to 365 days when the course has no value', () => {
    expect(courseAccessExpiresAt(completedAt, null, null)).toEqual(
      new Date('2027-04-23T10:00:00.000Z'),
    );
  });
});
