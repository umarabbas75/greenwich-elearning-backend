import { BadRequestException } from '@nestjs/common';
import {
  COURSE_BOOKING_DOC_REF_V2,
  assertValidAdvisorReviewMetadata,
  appendReviewHistory,
  evaluateRegistrationAccess,
  getResubmissionRound,
  learnerPartOfMetadata,
  sendBackMetadata,
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

describe('registration sent back for changes', () => {
  const sentBack = sendBackMetadata(
    {
      bookingFormVersion: COURSE_BOOKING_DOC_REF_V2,
      fullName: 'Jane',
      advisor: { registrationStatus: 'Approved', comments: 'ok' },
    },
    {
      at: new Date('2026-10-31T09:00:00.000Z'),
      byId: 'admin-1',
      byName: 'Muhammad Waqas',
      comments: 'Upload your passport photo',
      submissionCompletedAt: new Date('2026-10-28T10:00:00.000Z'),
    },
  );

  it('blocks content and says why, with the request as the comments', () => {
    expect(
      evaluateRegistrationAccess([
        { formId: 'registration-form', metadata: sentBack },
      ]),
    ).toEqual({
      blocked: true,
      reason: 'REGISTRATION_CHANGES_REQUESTED',
      registrationStatus: 'Pending',
      comments: 'Upload your passport photo',
      message:
        'Your learning advisor asked you to update your registration form.',
      changesRequestedAt: '2026-10-31T09:00:00.000Z',
    });
  });

  it('records what the review was before it was sent back', () => {
    expect(sentBack.changesRequested).toMatchObject({
      previousStatus: 'Approved',
      previousCompletedAt: '2026-10-28T10:00:00.000Z',
    });
    expect(sentBack.reviewHistory).toEqual([
      expect.objectContaining({
        action: 'CHANGES_REQUESTED',
        statusBefore: 'Approved',
        review: {
          advisor: { registrationStatus: 'Approved', comments: 'ok' },
          advisorSignature: null,
          advisorDate: null,
        },
      }),
    ]);
  });

  it('leaves only the learner answers once advisor keys are removed', () => {
    expect(learnerPartOfMetadata(sentBack)).toEqual({
      bookingFormVersion: COURSE_BOOKING_DOC_REF_V2,
      fullName: 'Jane',
    });
  });

  it('keeps full copies of replaced answers only for the latest resubmissions', () => {
    let metadata: Record<string, unknown> = {};
    for (let round = 1; round <= 5; round++) {
      metadata = {
        reviewHistory: appendReviewHistory(metadata, {
          action: 'RESUBMITTED',
          at: `2026-10-0${round}T00:00:00.000Z`,
          round,
          replaced: { completedAt: 'x', metadata: { fullName: `v${round}` } },
        }),
      };
    }
    const kept = (metadata.reviewHistory as any[]).map(
      (e) => e.replaced.metadata?.fullName ?? null,
    );
    expect(kept).toEqual([null, null, 'v3', 'v4', 'v5']);
    expect(getResubmissionRound(metadata)).toBe(5);
  });

  it('never lowers the resubmission round when old history is dropped', () => {
    expect(
      getResubmissionRound({
        reviewHistory: [
          { action: 'RESUBMITTED', round: 3 },
          { action: 'CHANGES_REQUESTED' },
        ],
      }),
    ).toBe(3);
    expect(getResubmissionRound({})).toBe(0);
  });

  it('reports no change request on an ordinary pending registration', () => {
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
    ).toMatchObject({
      reason: 'REGISTRATION_PENDING',
      changesRequestedAt: null,
    });
  });
});
