import {
  courseFormAppliesToEnrollment,
  courseFormAttachedForEnrollment,
  formAppliesToEnrollment,
  policyAppliesToEnrollment,
  policyItemAppliesToEnrollment,
  reattachData,
} from './course-form-applicability';

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
    expect(formAppliesToEnrollment(attachedAt, new Date(attachedAt))).toBe(
      true,
    );
  });
});

describe('course form rules', () => {
  const form = {
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    // Optional until 1 Jun, then required.
    requiredSince: new Date('2026-06-01T09:26:00.000Z'),
    // Removed for all of August, re-added, then removed again in October.
    detachedWindows: [
      { from: '2026-08-01T00:00:00.000Z', until: '2026-09-01T00:00:00.000Z' },
      { from: '2026-10-01T00:00:00.000Z', until: '2026-10-15T00:00:00.000Z' },
    ],
  };
  const at = (iso: string) => new Date(iso);

  describe('courseFormAppliesToEnrollment (is it required of them?)', () => {
    it('applies to learners enrolled while the form was attached and required', () => {
      expect(
        courseFormAppliesToEnrollment(form, at('2026-07-01T00:00:00Z')),
      ).toBe(true);
      expect(
        courseFormAppliesToEnrollment(form, at('2026-09-15T00:00:00Z')),
      ).toBe(true);
    });

    it('exempts learners who enrolled in any period the form was removed', () => {
      expect(
        courseFormAppliesToEnrollment(form, at('2026-08-15T00:00:00Z')),
      ).toBe(false);
      expect(
        courseFormAppliesToEnrollment(form, at('2026-10-05T00:00:00Z')),
      ).toBe(false);
    });

    it('still applies to learners who enrolled between two removals', () => {
      expect(
        courseFormAppliesToEnrollment(form, at('2026-09-10T00:00:00Z')),
      ).toBe(true);
    });

    it('exempts learners who enrolled before it became required', () => {
      expect(
        courseFormAppliesToEnrollment(form, at('2026-05-01T00:00:00Z')),
      ).toBe(false);
    });

    it('ignores a malformed window list', () => {
      expect(
        courseFormAppliesToEnrollment(
          { ...form, detachedWindows: { not: 'a list' } },
          at('2026-08-15T00:00:00Z'),
        ),
      ).toBe(true);
    });
  });

  describe('courseFormAttachedForEnrollment (do they see it at all?)', () => {
    it('includes learners who enrolled while it was optional', () => {
      expect(
        courseFormAttachedForEnrollment(form, at('2026-05-01T00:00:00Z')),
      ).toBe(true);
    });

    it('excludes learners who enrolled before it was attached', () => {
      expect(
        courseFormAttachedForEnrollment(form, at('2026-02-01T00:00:00Z')),
      ).toBe(false);
    });

    it('excludes learners who enrolled while it was removed', () => {
      expect(
        courseFormAttachedForEnrollment(form, at('2026-08-15T00:00:00Z')),
      ).toBe(false);
    });
  });
});

describe('policy rules', () => {
  const at = (iso: string) => new Date(iso);
  // Removed for all of August, then added back.
  const detachedWindows = [
    { from: '2026-08-01T00:00:00.000Z', until: '2026-09-01T00:00:00.000Z' },
  ];

  it('applies a policy to learners enrolled while it was on the course', () => {
    const policy = { createdAt: at('2026-03-01T00:00:00Z'), detachedWindows };
    expect(policyAppliesToEnrollment(policy, at('2026-07-01T00:00:00Z'))).toBe(
      true,
    );
    expect(policyAppliesToEnrollment(policy, at('2026-09-15T00:00:00Z'))).toBe(
      true,
    );
  });

  it('exempts learners who enrolled before the policy or while it was removed', () => {
    const policy = { createdAt: at('2026-03-01T00:00:00Z'), detachedWindows };
    expect(policyAppliesToEnrollment(policy, at('2026-02-01T00:00:00Z'))).toBe(
      false,
    );
    expect(policyAppliesToEnrollment(policy, at('2026-08-15T00:00:00Z'))).toBe(
      false,
    );
  });

  it('exempts learners from an item required after they enrolled or removed when they enrolled', () => {
    const item = { requiredSince: at('2026-06-01T00:00:00Z'), detachedWindows };
    expect(
      policyItemAppliesToEnrollment(item, at('2026-05-01T00:00:00Z')),
    ).toBe(false);
    expect(
      policyItemAppliesToEnrollment(item, at('2026-08-15T00:00:00Z')),
    ).toBe(false);
    expect(
      policyItemAppliesToEnrollment(item, at('2026-07-01T00:00:00Z')),
    ).toBe(true);
    expect(policyItemAppliesToEnrollment(item, null)).toBe(true);
  });

  it('records the removal period when something is added back', () => {
    const now = at('2026-10-18T12:00:00Z');
    expect(
      reattachData(
        { detachedAt: at('2026-10-17T10:00:00Z'), detachedWindows },
        now,
      ),
    ).toEqual({
      detachedAt: null,
      detachedWindows: [
        ...detachedWindows,
        { from: '2026-10-17T10:00:00.000Z', until: '2026-10-18T12:00:00.000Z' },
      ],
    });
  });
});
