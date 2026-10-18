import { feedbackAppliesToCompletion } from './feedback-applicability';

describe('feedbackAppliesToCompletion', () => {
  const requiredSince = new Date('2026-10-17T07:21:51.013Z');

  it('exempts learners who completed before feedback became required', () => {
    expect(
      feedbackAppliesToCompletion(
        requiredSince,
        new Date('2026-06-08T10:00:00Z'),
      ),
    ).toBe(false);
  });

  it('applies to learners who completed afterwards', () => {
    expect(
      feedbackAppliesToCompletion(
        requiredSince,
        new Date('2026-10-18T10:00:00Z'),
      ),
    ).toBe(true);
  });

  it('applies to learners who have not completed yet', () => {
    expect(feedbackAppliesToCompletion(requiredSince, null)).toBe(true);
  });
});
