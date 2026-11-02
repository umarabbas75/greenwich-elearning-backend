"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertValidAdvisorReviewMetadata = exports.evaluateRegistrationAccess = exports.sendBackMetadata = exports.getResubmissionRound = exports.appendReviewHistory = exports.getReviewHistory = exports.getChangesRequest = exports.learnerPartOfMetadata = exports.getAdvisorComments = exports.getAdvisorRegistrationStatus = exports.isV2BookingMetadata = exports.ADVISOR_OWNED_METADATA_KEYS = exports.ADVISOR_REGISTRATION_STATUSES = exports.ADVISOR_YES_NO_KEYS = exports.COURSE_BOOKING_DOC_REF_V2 = void 0;
const common_1 = require("@nestjs/common");
exports.COURSE_BOOKING_DOC_REF_V2 = 'GWTC/IQA-R0014 · 15/08/2026';
exports.ADVISOR_YES_NO_KEYS = [
    'learnerEligibilityConfirmed',
    'identityDocsVerified',
    'entryRequirementsMet',
    'englishRequirementMet',
    'needsAssessmentCompleted',
    'reasonableAdjustmentsRequired',
    'specialConsiderationRequired',
];
exports.ADVISOR_REGISTRATION_STATUSES = [
    'Approved',
    'Pending',
    'Rejected',
];
exports.ADVISOR_OWNED_METADATA_KEYS = [
    'advisor',
    'advisorSignature',
    'advisorDate',
    'changesRequested',
    'reviewHistory',
];
const REVIEW_HISTORY_LIMIT = 50;
const REPLACED_SNAPSHOT_LIMIT = 3;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function asRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value;
}
function reject(detail) {
    throw new common_1.BadRequestException({ detail });
}
function isV2BookingMetadata(metadata) {
    const bag = asRecord(metadata);
    return bag?.bookingFormVersion === exports.COURSE_BOOKING_DOC_REF_V2;
}
exports.isV2BookingMetadata = isV2BookingMetadata;
function getAdvisorRegistrationStatus(metadata) {
    if (!isV2BookingMetadata(metadata)) {
        return null;
    }
    const advisor = asRecord(asRecord(metadata)?.advisor);
    const status = advisor?.registrationStatus;
    if (status === 'Approved' ||
        status === 'Pending' ||
        status === 'Rejected') {
        return status;
    }
    return 'Pending';
}
exports.getAdvisorRegistrationStatus = getAdvisorRegistrationStatus;
function getAdvisorComments(metadata) {
    const advisor = asRecord(asRecord(metadata)?.advisor);
    if (typeof advisor?.comments !== 'string') {
        return null;
    }
    const trimmed = advisor.comments.trim();
    return trimmed.length > 0 ? trimmed : null;
}
exports.getAdvisorComments = getAdvisorComments;
function learnerPartOfMetadata(metadata) {
    const owned = exports.ADVISOR_OWNED_METADATA_KEYS;
    return Object.fromEntries(Object.entries(asRecord(metadata) ?? {}).filter(([key]) => !owned.includes(key)));
}
exports.learnerPartOfMetadata = learnerPartOfMetadata;
function getChangesRequest(metadata) {
    const request = asRecord(asRecord(metadata)?.changesRequested);
    if (!request || typeof request.requestedAt !== 'string') {
        return null;
    }
    return {
        requestedAt: request.requestedAt,
        requestedById: typeof request.requestedById === 'string' ? request.requestedById : '',
        requestedByName: typeof request.requestedByName === 'string'
            ? request.requestedByName
            : null,
        comments: typeof request.comments === 'string' ? request.comments : '',
        previousCompletedAt: typeof request.previousCompletedAt === 'string'
            ? request.previousCompletedAt
            : null,
        previousStatus: exports.ADVISOR_REGISTRATION_STATUSES.includes(request.previousStatus)
            ? request.previousStatus
            : null,
    };
}
exports.getChangesRequest = getChangesRequest;
function getReviewHistory(metadata) {
    const history = asRecord(metadata)?.reviewHistory;
    if (!Array.isArray(history)) {
        return [];
    }
    return history.filter((entry) => typeof asRecord(entry)?.action === 'string');
}
exports.getReviewHistory = getReviewHistory;
function appendReviewHistory(metadata, entry) {
    const history = [...getReviewHistory(metadata), entry].slice(-REVIEW_HISTORY_LIMIT);
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
exports.appendReviewHistory = appendReviewHistory;
function getResubmissionRound(metadata) {
    return getReviewHistory(metadata).reduce((max, entry) => {
        const round = entry.action === 'RESUBMITTED' ? Number(entry.round) : 0;
        return Number.isInteger(round) && round > max ? round : max;
    }, 0);
}
exports.getResubmissionRound = getResubmissionRound;
function sendBackMetadata(metadata, request) {
    const current = asRecord(metadata) ?? {};
    const prior = getChangesRequest(metadata);
    const statusBefore = getAdvisorRegistrationStatus(metadata);
    const requestedAt = request.at.toISOString();
    const changesRequested = {
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
exports.sendBackMetadata = sendBackMetadata;
function evaluateRegistrationAccess(forms) {
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
            message: 'Your learning advisor asked you to update your registration form.',
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
            message: 'Your registration was not approved. Please review the advisor comments.',
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
exports.evaluateRegistrationAccess = evaluateRegistrationAccess;
function assertValidAdvisorReviewMetadata(metaData) {
    const bag = asRecord(metaData);
    if (!bag) {
        reject('metaData must be an object');
    }
    if (bag.bookingFormVersion !== exports.COURSE_BOOKING_DOC_REF_V2) {
        reject('Advisor review is only allowed for v2 registration forms (GWTC/IQA-R0014 · 15/08/2026)');
    }
    const advisor = asRecord(bag.advisor);
    if (!advisor) {
        reject('metaData.advisor must be an object');
    }
    for (const key of exports.ADVISOR_YES_NO_KEYS) {
        const value = advisor[key];
        if (value !== 'yes' && value !== 'no') {
            reject(`metaData.advisor.${key} must be "yes" or "no"`);
        }
    }
    if (!exports.ADVISOR_REGISTRATION_STATUSES.includes(advisor.registrationStatus)) {
        reject('metaData.advisor.registrationStatus must be Approved, Pending, or Rejected');
    }
    if (advisor.comments != null &&
        typeof advisor.comments !== 'string') {
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
exports.assertValidAdvisorReviewMetadata = assertValidAdvisorReviewMetadata;
//# sourceMappingURL=advisor-review-metadata.js.map