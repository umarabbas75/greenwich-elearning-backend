import { BadRequestException } from '@nestjs/common';
import {
  COURSE_BOOKING_DOC_REF_V2,
  assertValidAdvisorReviewMetadata,
  evaluateRegistrationAccess,
} from './advisor-review-metadata';

function validAdvisorBag(overrides: Record<string, unknown> = {}) {
  return {
    bookingFormVersion: COURSE_BOOKING_DOC_REF_V2,
    advisor: {
      learnerEligibilityConfirmed: 'yes',
      identityDocsVerified: 'yes',
      entryRequirementsMet: 'yes',
      englishRequirementMet: 'yes',
      needsAssessmentCompleted: 'yes',
      reasonableAdjustmentsRequired: 'no',
      specialConsiderationRequired: 'no',
      registrationStatus: 'Approved',
      comments: '',
    },
    advisorSignature: 'Muhammad Waqas',
    advisorDate: '2026-08-16',
    ...overrides,
  };
}

describe('assertValidAdvisorReviewMetadata', () => {
  it('accepts a complete v2 advisor review bag', () => {
    expect(() =>
      assertValidAdvisorReviewMetadata(validAdvisorBag()),
    ).not.toThrow();
  });

  it('rejects missing/legacy bookingFormVersion', () => {
    expect(() =>
      assertValidAdvisorReviewMetadata(
        validAdvisorBag({ bookingFormVersion: 'GWTC/IQA-R0013 · 05/05/2026' }),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      assertValidAdvisorReviewMetadata(
        validAdvisorBag({ bookingFormVersion: undefined }),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects invalid yes/no and status values', () => {
    expect(() =>
      assertValidAdvisorReviewMetadata(
        validAdvisorBag({
          advisor: {
            ...validAdvisorBag().advisor,
            identityDocsVerified: true,
          },
        }),
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      assertValidAdvisorReviewMetadata(
        validAdvisorBag({
          advisor: {
            ...validAdvisorBag().advisor,
            registrationStatus: 'Maybe',
          },
        }),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects short signature and invalid date', () => {
    expect(() =>
      assertValidAdvisorReviewMetadata(
        validAdvisorBag({ advisorSignature: 'M' }),
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      assertValidAdvisorReviewMetadata(
        validAdvisorBag({ advisorDate: '16/08/2026' }),
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      assertValidAdvisorReviewMetadata(
        validAdvisorBag({ advisorDate: '2026-13-40' }),
      ),
    ).toThrow(BadRequestException);
  });
});

describe('evaluateRegistrationAccess', () => {
  it('does not block legacy v1 submissions', () => {
    const gate = evaluateRegistrationAccess([
      {
        formId: 'registration-form',
        metadata: { bookingFormVersion: 'GWTC/IQA-R0013 · 05/05/2026' },
      },
    ]);
    expect(gate.blocked).toBe(false);
  });

  it('blocks v2 pending and rejected, allows approved', () => {
    expect(
      evaluateRegistrationAccess([
        {
          formId: 'registration-form',
          metadata: {
            bookingFormVersion: COURSE_BOOKING_DOC_REF_V2,
            advisor: { registrationStatus: 'Pending' },
          },
        },
      ]),
    ).toMatchObject({ blocked: true, reason: 'REGISTRATION_PENDING' });

    expect(
      evaluateRegistrationAccess([
        {
          formId: 'registration-form',
          metadata: {
            bookingFormVersion: COURSE_BOOKING_DOC_REF_V2,
            advisor: { registrationStatus: 'Rejected', comments: 'Missing ID' },
          },
        },
      ]),
    ).toMatchObject({
      blocked: true,
      reason: 'REGISTRATION_REJECTED',
      comments: 'Missing ID',
    });

    expect(
      evaluateRegistrationAccess([
        {
          formId: 'registration-form',
          metadata: {
            bookingFormVersion: COURSE_BOOKING_DOC_REF_V2,
            advisor: { registrationStatus: 'Approved' },
          },
        },
      ]),
    ).toMatchObject({ blocked: false, registrationStatus: 'Approved' });
  });
});
