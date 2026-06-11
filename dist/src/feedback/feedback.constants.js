"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateFeedbackFormData = exports.computeMeanLikertRating = exports.feedbackReminderBucket = exports.feedbackDedupeKey = exports.feedbackGroupKey = exports.FEEDBACK_REMINDER_LIFETIME_CAP = exports.FEEDBACK_REMINDER_COOLDOWN_DAYS = exports.FEEDBACK_REMINDER_AFTER_DAYS = exports.FEEDBACK_OVERALL_RATINGS = exports.FEEDBACK_LIKERT_KEYS = exports.FEEDBACK_FORM_VERSION = void 0;
exports.FEEDBACK_FORM_VERSION = 'lms-elearning-v1-2026-06';
exports.FEEDBACK_LIKERT_KEYS = [
    'objectivesClear',
    'contentRelevant',
    'lmsEasyToUse',
    'materialsAccurate',
    'videosEffective',
    'structureLogical',
    'paceAppropriate',
    'assessmentsReflectContent',
    'instructionsClear',
    'tutorSupportProfessional',
    'tutorFeedbackTimely',
    'technicalSupportAvailable',
    'engagingInteractive',
    'knowledgeImproved',
    'confidentInApplication',
    'metExpectations',
    'overallSatisfied',
    'wouldRecommend',
];
exports.FEEDBACK_OVERALL_RATINGS = [
    'excellent',
    'very_good',
    'good',
    'fair',
    'poor',
];
exports.FEEDBACK_REMINDER_AFTER_DAYS = 2;
exports.FEEDBACK_REMINDER_COOLDOWN_DAYS = 3;
exports.FEEDBACK_REMINDER_LIFETIME_CAP = 4;
function feedbackGroupKey(courseId) {
    return `feedback:${courseId}`;
}
exports.feedbackGroupKey = feedbackGroupKey;
function feedbackDedupeKey(courseId, userId, bucket) {
    return `feedback:${courseId}:${userId}:${bucket}`;
}
exports.feedbackDedupeKey = feedbackDedupeKey;
function feedbackReminderBucket(now, cooldownDays) {
    const msPerDay = 86400000;
    const epochDays = Math.floor(now.getTime() / msPerDay);
    return Math.floor(epochDays / Math.max(1, cooldownDays));
}
exports.feedbackReminderBucket = feedbackReminderBucket;
function computeMeanLikertRating(formData) {
    const values = exports.FEEDBACK_LIKERT_KEYS.map((key) => {
        const raw = formData[key];
        if (typeof raw !== 'string' || !/^[1-5]$/.test(raw))
            return null;
        return Number(raw);
    }).filter((v) => v !== null);
    if (values.length !== exports.FEEDBACK_LIKERT_KEYS.length) {
        throw new Error('Invalid Likert responses');
    }
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    return Math.round(mean * 100) / 100;
}
exports.computeMeanLikertRating = computeMeanLikertRating;
function validateFeedbackFormData(formData) {
    if (!formData || typeof formData !== 'object' || Array.isArray(formData)) {
        throw new Error('formData must be an object');
    }
    const data = formData;
    for (const key of exports.FEEDBACK_LIKERT_KEYS) {
        const value = data[key];
        if (typeof value !== 'string' || !/^[1-5]$/.test(value)) {
            throw new Error(`Invalid or missing Likert response: ${key}`);
        }
    }
    const overall = data.overallRating;
    if (typeof overall !== 'string' ||
        !exports.FEEDBACK_OVERALL_RATINGS.includes(overall)) {
        throw new Error('Invalid or missing overallRating');
    }
    return data;
}
exports.validateFeedbackFormData = validateFeedbackFormData;
//# sourceMappingURL=feedback.constants.js.map