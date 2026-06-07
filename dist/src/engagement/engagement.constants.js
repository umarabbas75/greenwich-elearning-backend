"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.engagementGroupKey = exports.engagementDedupeKey = exports.cooldownBucket = exports.ENGAGEMENT_DEFAULTS = exports.ENGAGEMENT_ENV = void 0;
exports.ENGAGEMENT_ENV = {
    neverStartedDays: 'ENGAGEMENT_NEVER_STARTED_DAYS',
    stalledDays: 'ENGAGEMENT_STALLED_DAYS',
    neverStartedCooldownDays: 'ENGAGEMENT_NEVER_STARTED_COOLDOWN_DAYS',
    stalledCooldownDays: 'ENGAGEMENT_STALLED_COOLDOWN_DAYS',
    batchLimit: 'ENGAGEMENT_BATCH_LIMIT',
    emailConcurrency: 'ENGAGEMENT_EMAIL_CONCURRENCY',
    appBaseUrl: 'APP_BASE_URL',
};
exports.ENGAGEMENT_DEFAULTS = {
    neverStartedDays: 3,
    stalledDays: 7,
    neverStartedCooldownDays: 3,
    stalledCooldownDays: 7,
    batchLimit: 50,
    emailConcurrency: 5,
    appBaseUrl: 'https://www.greenwichtc-elearning.com',
};
const MS_PER_DAY = 86400000;
function cooldownBucket(now, cooldownDays) {
    const epochDays = Math.floor(now.getTime() / MS_PER_DAY);
    return Math.floor(epochDays / Math.max(1, cooldownDays));
}
exports.cooldownBucket = cooldownBucket;
function engagementDedupeKey(args) {
    return `engagement:${args.reminderType}:${args.courseId}:${args.userId}:${args.bucket}`;
}
exports.engagementDedupeKey = engagementDedupeKey;
function engagementGroupKey(reminderType, courseId) {
    return `engagement:${reminderType}:${courseId}`;
}
exports.engagementGroupKey = engagementGroupKey;
//# sourceMappingURL=engagement.constants.js.map