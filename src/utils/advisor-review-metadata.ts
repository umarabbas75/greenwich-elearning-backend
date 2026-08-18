import { BadRequestException } from '@nestjs/common';

/** Universal learner registration form (v2). Advisor review is v2-only. */
export const COURSE_BOOKING_DOC_REF_V2 = 'GWTC/IQA-R0014 · 15/08/2026';

export const ADVISOR_YES_NO_KEYS = [
  'learnerEligibilityConfirmed',
  'identityDocsVerified',
  'entryRequirementsMet',
  'englishRequirementMet',
  'needsAssessmentCompleted',
  'reasonableAdjustmentsRequired',
  'specialConsiderationRequired',
] as const;

export const ADVISOR_REGISTRATION_STATUSES = [
  'Approved',
  'Pending',
  'Rejected',
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function reject(detail: string): never {
  throw new BadRequestException({ detail });
}

/**
 * Validates the advisor-review portion of a v2 registration-form metadata bag.
 * Throws `BadRequestException({ detail })` on the first failure.
 */
export type AdvisorRegistrationStatus = (typeof ADVISOR_REGISTRATION_STATUSES)[number];

export function isV2BookingMetadata(metadata: unknown): boolean {
  const bag = asRecord(metadata);
  return bag?.bookingFormVersion === COURSE_BOOKING_DOC_REF_V2;
}

export function getAdvisorRegistrationStatus(
  metadata: unknown,
): AdvisorRegistrationStatus | null {
  if (!isV2BookingMetadata(metadata)) {
    return null;
  }
  const advisor = asRecord(asRecord(metadata)?.advisor);
  const status = advisor?.registrationStatus;
  if (
    status === 'Approved' ||
    status === 'Pending' ||
    status === 'Rejected'
  ) {
    return status;
  }
  return 'Pending';
}

export function getAdvisorComments(metadata: unknown): string | null {
  const advisor = asRecord(asRecord(metadata)?.advisor);
  if (typeof advisor?.comments !== 'string') {
    return null;
  }
  const trimmed = advisor.comments.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type RegistrationAccessGate =
  | { blocked: false; registrationStatus: AdvisorRegistrationStatus | null; comments: string | null }
  | {
      blocked: true;
      reason: 'REGISTRATION_PENDING' | 'REGISTRATION_REJECTED';
      registrationStatus: AdvisorRegistrationStatus;
      comments: string | null;
      message: string;
    };

/**
 * v2 registration forms block course content until advisor status is Approved.
 * Legacy v1 (or no registration form) does not use this gate.
 */
export function evaluateRegistrationAccess(forms: Array<{
  formId: string;
  isRequired?: boolean;
  metadata?: unknown;
}>): RegistrationAccessGate {
  const registration = forms.find((f) => f.formId === 'registration-form');
  if (!registration) {
    return { blocked: false, registrationStatus: null, comments: null };
  }
  const status = getAdvisorRegistrationStatus(registration.metadata);
  const comments = getAdvisorComments(registration.metadata);
  if (status == null) {
    return { blocked: false, registrationStatus: null, comments };
  }
  if (status === 'Approved') {
    return { blocked: false, registrationStatus: status, comments };
  }
  if (status === 'Rejected') {
    return {
      blocked: true,
      reason: 'REGISTRATION_REJECTED',
      registrationStatus: status,
      comments,
      message:
        'Your registration was not approved. Please review the advisor comments.',
    };
  }
  return {
    blocked: true,
    reason: 'REGISTRATION_PENDING',
    registrationStatus: 'Pending',
    comments,
    message: 'Your registration is waiting for advisor approval.',
  };
}

export function assertValidAdvisorReviewMetadata(metaData: unknown): void {
  const bag = asRecord(metaData);
  if (!bag) {
    reject('metaData must be an object');
  }

  if (bag.bookingFormVersion !== COURSE_BOOKING_DOC_REF_V2) {
    reject(
      'Advisor review is only allowed for v2 registration forms (GWTC/IQA-R0014 · 15/08/2026)',
    );
  }

  const advisor = asRecord(bag.advisor);
  if (!advisor) {
    reject('metaData.advisor must be an object');
  }

  for (const key of ADVISOR_YES_NO_KEYS) {
    const value = advisor[key];
    if (value !== 'yes' && value !== 'no') {
      reject(`metaData.advisor.${key} must be "yes" or "no"`);
    }
  }

  if (
    !ADVISOR_REGISTRATION_STATUSES.includes(
      advisor.registrationStatus as (typeof ADVISOR_REGISTRATION_STATUSES)[number],
    )
  ) {
    reject(
      'metaData.advisor.registrationStatus must be Approved, Pending, or Rejected',
    );
  }

  if (
    advisor.comments != null &&
    typeof advisor.comments !== 'string'
  ) {
    reject('metaData.advisor.comments must be a string');
  }

  const signature = bag.advisorSignature;
  if (typeof signature !== 'string' || signature.trim().length < 2) {
    reject('advisorSignature must be a non-empty string of at least 2 characters');
  }

  const advisorDate = bag.advisorDate;
  if (typeof advisorDate !== 'string' || !ISO_DATE.test(advisorDate)) {
    reject('advisorDate must be a valid ISO date (YYYY-MM-DD)');
  }
  const parsed = new Date(`${advisorDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== advisorDate) {
    reject('advisorDate must be a valid ISO date (YYYY-MM-DD)');
  }
}
