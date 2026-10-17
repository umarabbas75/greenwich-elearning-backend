import { formAppliesToEnrollment } from './course-form-applicability';

describe('formAppliesToEnrollment', () => {
  const attachedAt = new Date('2026-10-17T07:21:50.052Z');

  it('exempts learners enrolled before the form was attached', () => {
    expect(
      formAppliesToEnrollment(attachedAt, new Date('2026-10-16T06:54:00.385Z')),
    ).toBe(false);
  });

  it('applies to learners enrolled after the form was attached', () => {
    expect(
      formAppliesToEnrollment(attachedAt, new Date('2026-10-17T08:58:13.171Z')),
    ).toBe(true);
  });

  it('applies when the enrolment time is unknown', () => {
    expect(formAppliesToEnrollment(attachedAt, null)).toBe(true);
    expect(formAppliesToEnrollment(attachedAt, undefined)).toBe(true);
  });

  it('treats an enrolment created at the same instant as the form as in-scope', () => {
    expect(formAppliesToEnrollment(attachedAt, new Date(attachedAt))).toBe(true);
  });
});
