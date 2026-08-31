"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isImportJobRunning = exports.isImportJobError = exports.isImportJobComplete = exports.parseScormSectionConfig = exports.pickMonotonic = exports.completeOnSatisfied = exports.mapRegistrationSuccess = exports.mapRegistrationCompletion = exports.SUCCESS_RANK = exports.COMPLETION_RANK = void 0;
exports.COMPLETION_RANK = {
    unknown: 0,
    incomplete: 1,
    completed: 2,
};
exports.SUCCESS_RANK = {
    unknown: 0,
    failed: 1,
    passed: 2,
};
function mapRegistrationCompletion(raw) {
    const s = String(raw ?? 'UNKNOWN').toUpperCase();
    if (s === 'COMPLETED')
        return 'completed';
    if (s === 'INCOMPLETE')
        return 'incomplete';
    return 'unknown';
}
exports.mapRegistrationCompletion = mapRegistrationCompletion;
function mapRegistrationSuccess(raw) {
    const s = String(raw ?? 'UNKNOWN').toUpperCase();
    if (s === 'PASSED')
        return 'passed';
    if (s === 'FAILED')
        return 'failed';
    return 'unknown';
}
exports.mapRegistrationSuccess = mapRegistrationSuccess;
function completeOnSatisfied(completeOn, completionStatus, successStatus) {
    if (completeOn === 'passed')
        return successStatus === 'passed';
    return completionStatus === 'completed';
}
exports.completeOnSatisfied = completeOnSatisfied;
function pickMonotonic(stored, incoming, ranks) {
    const a = ranks[stored] ?? 0;
    const b = ranks[incoming] ?? 0;
    return b > a ? incoming : stored;
}
exports.pickMonotonic = pickMonotonic;
function parseScormSectionConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return null;
    }
    const row = config;
    if (typeof row.packageId !== 'string' || !row.packageId)
        return null;
    if (row.completeOn !== 'completed' && row.completeOn !== 'passed') {
        return null;
    }
    const parsed = {
        packageId: row.packageId,
        completeOn: row.completeOn,
    };
    if (typeof row.passingScore === 'number') {
        parsed.passingScore = row.passingScore;
    }
    return parsed;
}
exports.parseScormSectionConfig = parseScormSectionConfig;
function isImportJobComplete(status) {
    const s = status.toUpperCase();
    return s === 'COMPLETE' || s === 'COMPLETED';
}
exports.isImportJobComplete = isImportJobComplete;
function isImportJobError(status) {
    return status.toUpperCase() === 'ERROR';
}
exports.isImportJobError = isImportJobError;
function isImportJobRunning(status) {
    return status.toUpperCase() === 'RUNNING';
}
exports.isImportJobRunning = isImportJobRunning;
//# sourceMappingURL=scorm-status.js.map