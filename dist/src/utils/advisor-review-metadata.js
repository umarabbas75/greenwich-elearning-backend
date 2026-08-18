"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertValidAdvisorReviewMetadata = exports.evaluateRegistrationAccess = exports.getAdvisorComments = exports.getAdvisorRegistrationStatus = exports.isV2BookingMetadata = exports.ADVISOR_REGISTRATION_STATUSES = exports.ADVISOR_YES_NO_KEYS = exports.COURSE_BOOKING_DOC_REF_V2 = void 0;
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
function evaluateRegistrationAccess(forms) {
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
            message: 'Your registration was not approved. Please review the advisor comments.',
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