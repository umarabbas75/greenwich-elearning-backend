export declare const COURSE_BOOKING_DOC_REF_V2 = "GWTC/IQA-R0014 \u00B7 15/08/2026";
export declare const ADVISOR_YES_NO_KEYS: readonly ["learnerEligibilityConfirmed", "identityDocsVerified", "entryRequirementsMet", "englishRequirementMet", "needsAssessmentCompleted", "reasonableAdjustmentsRequired", "specialConsiderationRequired"];
export declare const ADVISOR_REGISTRATION_STATUSES: readonly ["Approved", "Pending", "Rejected"];
export declare const ADVISOR_OWNED_METADATA_KEYS: readonly ["advisor", "advisorSignature", "advisorDate", "changesRequested", "reviewHistory"];
export type AdvisorRegistrationStatus = (typeof ADVISOR_REGISTRATION_STATUSES)[number];
export declare function isV2BookingMetadata(metadata: unknown): boolean;
export declare function getAdvisorRegistrationStatus(metadata: unknown): AdvisorRegistrationStatus | null;
export declare function getAdvisorComments(metadata: unknown): string | null;
export type ChangesRequest = {
    requestedAt: string;
    requestedById: string;
    requestedByName: string | null;
    comments: string;
    previousCompletedAt: string | null;
    previousStatus: AdvisorRegistrationStatus | null;
};
export type ReviewHistoryEntry = Record<string, unknown> & {
    action: 'CHANGES_REQUESTED' | 'REQUEST_WITHDRAWN' | 'RESUBMITTED';
    at: string;
};
export declare function learnerPartOfMetadata(metadata: unknown): Record<string, unknown>;
export declare function getChangesRequest(metadata: unknown): ChangesRequest | null;
export declare function getReviewHistory(metadata: unknown): ReviewHistoryEntry[];
export declare function appendReviewHistory(metadata: unknown, entry: ReviewHistoryEntry): ReviewHistoryEntry[];
export declare function getResubmissionRound(metadata: unknown): number;
export declare function sendBackMetadata(metadata: unknown, request: {
    at: Date;
    byId: string;
    byName: string | null;
    comments: string;
    submissionCompletedAt: Date | null;
}): Record<string, unknown>;
export type RegistrationAccessGate = {
    blocked: false;
    registrationStatus: AdvisorRegistrationStatus | null;
    comments: string | null;
    changesRequestedAt: null;
} | {
    blocked: true;
    reason: 'REGISTRATION_PENDING' | 'REGISTRATION_REJECTED' | 'REGISTRATION_CHANGES_REQUESTED';
    registrationStatus: AdvisorRegistrationStatus;
    comments: string | null;
    message: string;
    changesRequestedAt: string | null;
};
export declare function evaluateRegistrationAccess(forms: Array<{
    formId: string;
    isRequired?: boolean;
    metadata?: unknown;
}>): RegistrationAccessGate;
export declare function assertValidAdvisorReviewMetadata(metaData: unknown): void;
