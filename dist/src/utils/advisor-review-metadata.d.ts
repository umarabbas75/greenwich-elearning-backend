export declare const COURSE_BOOKING_DOC_REF_V2 = "GWTC/IQA-R0014 \u00B7 15/08/2026";
export declare const ADVISOR_YES_NO_KEYS: readonly ["learnerEligibilityConfirmed", "identityDocsVerified", "entryRequirementsMet", "englishRequirementMet", "needsAssessmentCompleted", "reasonableAdjustmentsRequired", "specialConsiderationRequired"];
export declare const ADVISOR_REGISTRATION_STATUSES: readonly ["Approved", "Pending", "Rejected"];
export type AdvisorRegistrationStatus = (typeof ADVISOR_REGISTRATION_STATUSES)[number];
export declare function isV2BookingMetadata(metadata: unknown): boolean;
export declare function getAdvisorRegistrationStatus(metadata: unknown): AdvisorRegistrationStatus | null;
export declare function getAdvisorComments(metadata: unknown): string | null;
export type RegistrationAccessGate = {
    blocked: false;
    registrationStatus: AdvisorRegistrationStatus | null;
    comments: string | null;
} | {
    blocked: true;
    reason: 'REGISTRATION_PENDING' | 'REGISTRATION_REJECTED';
    registrationStatus: AdvisorRegistrationStatus;
    comments: string | null;
    message: string;
};
export declare function evaluateRegistrationAccess(forms: Array<{
    formId: string;
    isRequired?: boolean;
    metadata?: unknown;
}>): RegistrationAccessGate;
export declare function assertValidAdvisorReviewMetadata(metaData: unknown): void;
