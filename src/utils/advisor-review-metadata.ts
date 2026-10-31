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

/**
 * Metadata keys written only by the advisor flow. A learner submission never
 * carries them: otherwise a learner could post `advisor.registrationStatus:
 * "Approved"` and unlock the course, or resubmit with the old review attached.
 */
export const ADVISOR_OWNED_METADATA_KEYS = [
  'advisor',
  'advisorSignature',
  'advisorDate',
  'changesRequested',
  'reviewHistory',
] as const;

/** Oldest entries are dropped past this, so the bag cannot grow without bound. */
const REVIEW_HISTORY_LIMIT = 50;

/**
 * Resubmissions that keep a full copy of the answers they replaced. Older ones
 * keep only when it was submitted: this bag is sent with every course list.
 */
const REPLACED_SNAPSHOT_LIMIT = 3;

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

/**
 * Set while the advisor has sent the registration back for the learner to
 * update. The completion is incomplete for exactly as long as this is present.
 */
export type ChangesRequest = {
  requestedAt: string;
  requestedById: string;
  requestedByName: string | null;
  comments: string;
  /** When the submission that was sent back had been made. */
  previousCompletedAt: string | null;
  previousStatus: AdvisorRegistrationStatus | null;
};

export type ReviewHistoryEntry = Record<string, unknown> & {
  action: 'CHANGES_REQUESTED' | 'REQUEST_WITHDRAWN' | 'RESUBMITTED';
  at: string;
};

/** The learner's own answers: the metadata bag without any advisor-owned key. */
export function learnerPartOfMetadata(
  metadata: unknown,
): Record<string, unknown> {
  const owned: readonly string[] = ADVISOR_OWNED_METADATA_KEYS;
  return Object.fromEntries(
    Object.entries(asRecord(metadata) ?? {}).filter(
      ([key]) => !owned.includes(key),
    ),
  );
}

export function getChangesRequest(metadata: unknown): ChangesRequest | null {
  const request = asRecord(asRecord(metadata)?.changesRequested);
  if (!request || typeof request.requestedAt !== 'string') {
    return null;
  }
  return {
    requestedAt: request.requestedAt,
    requestedById:
      typeof request.requestedById === 'string' ? request.requestedById : '',
    requestedByName:
      typeof request.requestedByName === 'string'
        ? request.requestedByName
        : null,
    comments: typeof request.comments === 'string' ? request.comments : '',
    previousCompletedAt:
      typeof request.previousCompletedAt === 'string'
        ? request.previousCompletedAt
        : null,
    previousStatus: ADVISOR_REGISTRATION_STATUSES.includes(
      request.previousStatus as AdvisorRegistrationStatus,
    )
      ? (request.previousStatus as AdvisorRegistrationStatus)
      : null,
  };
}

export function getReviewHistory(metadata: unknown): ReviewHistoryEntry[] {
  const history = asRecord(metadata)?.reviewHistory;
  if (!Array.isArray(history)) {
    return [];
  }
  return history.filter(
    (entry): entry is ReviewHistoryEntry =>
      typeof asRecord(entry)?.action === 'string',
  );
}

export function appendReviewHistory(
  metadata: unknown,
  entry: ReviewHistoryEntry,
): ReviewHistoryEntry[] {
  const history = [...getReviewHistory(metadata), entry].slice(
    -REVIEW_HISTORY_LIMIT,
  );
  let snapshotsKept = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const replaced = asRecord(history[i].replaced);
    if (history[i].action !== 'RESUBMITTED' || !replaced?.metadata) {
      continue;
    }
    snapshotsKept++;
    if (snapshotsKept > REPLACED_SNAPSHOT_LIMIT) {
      history[i] = {
        ...history[i],
        replaced: { completedAt: replaced.completedAt ?? null },
      };
    }
  }
  return history;
}

/**
 * How many times the learner has resubmitted after being sent back; 0 for a
 * first submission. Read from the highest recorded round, so it never goes
 * down when old history entries are dropped.
 */
export function getResubmissionRound(metadata: unknown): number {
  return getReviewHistory(metadata).reduce((max, entry) => {
    const round = entry.action === 'RESUBMITTED' ? Number(entry.round) : 0;
    return Number.isInteger(round) && round > max ? round : max;
  }, 0);
}

/**
 * The metadata bag of a registration the advisor sends back to the learner.
 * The learner's answers stay so the form reopens filled in; the advisor's
 * request is recorded as the current review, and the review it replaces goes
 * to the history. Sending back again while waiting only updates the request.
 */
export function sendBackMetadata(
  metadata: unknown,
  request: {
    at: Date;
    byId: string;
    byName: string | null;
    comments: string;
    submissionCompletedAt: Date | null;
  },
): Record<string, unknown> {
  const current = asRecord(metadata) ?? {};
  const prior = getChangesRequest(metadata);
  const statusBefore = getAdvisorRegistrationStatus(metadata);
  const requestedAt = request.at.toISOString();

  const changesRequested: ChangesRequest = {
    requestedAt,
    requestedById: request.byId,
    requestedByName: request.byName,
    comments: request.comments,
    previousCompletedAt: prior
      ? prior.previousCompletedAt
      : request.submissionCompletedAt?.toISOString() ?? null,
    previousStatus: prior ? prior.previousStatus : statusBefore,
  };

  return {
    ...current,
    advisor: {
      ...(asRecord(current.advisor) ?? {}),
      registrationStatus: 'Pending',
      comments: request.comments,
    },
    changesRequested,
    reviewHistory: appendReviewHistory(metadata, {
      action: 'CHANGES_REQUESTED',
      at: requestedAt,
      byId: request.byId,
      byName: request.byName,
      comments: request.comments,
      statusBefore,
      review: {
        advisor: current.advisor ?? null,
        advisorSignature: current.advisorSignature ?? null,
        advisorDate: current.advisorDate ?? null,
      },
    }),
  };
}

export type RegistrationAccessGate =
  | {
      blocked: false;
      registrationStatus: AdvisorRegistrationStatus | null;
      comments: string | null;
      changesRequestedAt: null;
    }
  | {
      blocked: true;
      reason:
        | 'REGISTRATION_PENDING'
        | 'REGISTRATION_REJECTED'
        | 'REGISTRATION_CHANGES_REQUESTED';
      registrationStatus: AdvisorRegistrationStatus;
      comments: string | null;
      message: string;
      /** Set while the form is sent back to the learner for changes. */
      changesRequestedAt: string | null;
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
    return {
      blocked: false,
      registrationStatus: null,
      comments: null,
      changesRequestedAt: null,
    };
  }
  const status = getAdvisorRegistrationStatus(registration.metadata);
  const comments = getAdvisorComments(registration.metadata);
  if (status == null) {
    return {
      blocked: false,
      registrationStatus: null,
      comments,
      changesRequestedAt: null,
    };
  }
  const changesRequest = getChangesRequest(registration.metadata);
  if (changesRequest) {
    return {
      blocked: true,
      reason: 'REGISTRATION_CHANGES_REQUESTED',
      registrationStatus: 'Pending',
      comments: changesRequest.comments.trim() || comments,
      message:
        'Your learning advisor asked you to update your registration form.',
      changesRequestedAt: changesRequest.requestedAt,
    };
  }
  if (status === 'Approved') {
    return {
      blocked: false,
      registrationStatus: status,
      comments,
      changesRequestedAt: null,
    };
  }
  if (status === 'Rejected') {
    return {
      blocked: true,
      reason: 'REGISTRATION_REJECTED',
      registrationStatus: status,
      comments,
      message:
        'Your registration was not approved. Please review the advisor comments.',
      changesRequestedAt: null,
    };
  }
  return {
    blocked: true,
    reason: 'REGISTRATION_PENDING',
    registrationStatus: 'Pending',
    comments,
    message: 'Your registration is waiting for advisor approval.',
    changesRequestedAt: null,
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
