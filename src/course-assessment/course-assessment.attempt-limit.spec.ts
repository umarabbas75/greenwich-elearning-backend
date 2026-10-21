import { CourseAssessmentService } from './course-assessment.service';

// The private static is the whole rule; exercised directly.
const effectiveMaxAttempts = (
  CourseAssessmentService as unknown as {
    effectiveMaxAttempts: (
      current: number | null,
      granted: Array<number | null>,
    ) => number | null;
  }
).effectiveMaxAttempts;

describe('CourseAssessmentService.effectiveMaxAttempts', () => {
  it('uses the current limit for a learner who has not started', () => {
    expect(effectiveMaxAttempts(2, [])).toBe(2);
  });

  it('keeps the limit a learner started under when it is lowered later', () => {
    expect(effectiveMaxAttempts(1, [3, 3])).toBe(3);
  });

  it('gives everyone a raised limit', () => {
    expect(effectiveMaxAttempts(5, [3])).toBe(5);
  });

  it('keeps unlimited attempts for a learner who started while unlimited', () => {
    expect(effectiveMaxAttempts(2, [null])).toBeNull();
  });

  it('is unlimited when the assessment is unlimited', () => {
    expect(effectiveMaxAttempts(null, [3])).toBeNull();
  });
});
