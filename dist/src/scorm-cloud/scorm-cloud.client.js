"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ScormCloudClient_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScormCloudClient = exports.SCORM_EMBEDDED_LAUNCH_SETTINGS = exports.SCORM_CLOUD_UPLOAD_TIMEOUT_MS = exports.SCORM_CLOUD_ASSET_TIMEOUT_MS = exports.SCORM_CLOUD_TIMEOUT_MS = exports.ScormCloudNetworkError = exports.ScormCloudTimeoutError = exports.ScormCloudHttpError = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const error_message_1 = require("../utils/error-message");
const strip_trailing_slash_1 = require("../utils/strip-trailing-slash");
class ScormCloudHttpError extends common_1.HttpException {
    constructor(status, body) {
        super({
            status,
            error: `SCORM Cloud request failed (${status})`,
            detail: body.slice(0, 500),
        }, status >= 400 && status < 600 ? status : common_1.HttpStatus.BAD_GATEWAY);
        this.cloudStatus = status;
        this.cloudBody = body;
    }
}
exports.ScormCloudHttpError = ScormCloudHttpError;
class ScormCloudTimeoutError extends common_1.HttpException {
    constructor(what, timeoutMs) {
        super(`SCORM Cloud did not respond within ${Math.round(timeoutMs / 1000)}s (${what})`, common_1.HttpStatus.GATEWAY_TIMEOUT);
        this.timeoutMs = timeoutMs;
    }
}
exports.ScormCloudTimeoutError = ScormCloudTimeoutError;
class ScormCloudNetworkError extends common_1.HttpException {
    constructor() {
        super('SCORM Cloud is unreachable', common_1.HttpStatus.BAD_GATEWAY);
    }
}
exports.ScormCloudNetworkError = ScormCloudNetworkError;
exports.SCORM_CLOUD_TIMEOUT_MS = 10000;
exports.SCORM_CLOUD_ASSET_TIMEOUT_MS = 25000;
exports.SCORM_CLOUD_UPLOAD_TIMEOUT_MS = 35000;
function isAbortTimeout(err) {
    const name = err?.name;
    return name === 'TimeoutError' || name === 'AbortError';
}
exports.SCORM_EMBEDDED_LAUNCH_SETTINGS = [
    { settingId: 'PlayerLaunchType', value: 'FRAMESET', explicit: true },
    { settingId: 'PlayerScoLaunchType', value: 'FRAMESET', explicit: true },
];
let ScormCloudClient = ScormCloudClient_1 = class ScormCloudClient {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(ScormCloudClient_1.name);
    }
    async createFetchAndImportCourseJob(args) {
        const qs = new URLSearchParams({
            courseId: args.courseId,
            mayCreateNewVersion: 'false',
        });
        const json = await this.request('POST', `/courses/importJobs?${qs.toString()}`, { url: args.url });
        return this.parseImportJobId(json);
    }
    async createUploadAndImportCourseJob(args) {
        const qs = new URLSearchParams({
            courseId: args.courseId,
            mayCreateNewVersion: 'false',
        });
        const form = new FormData();
        const name = args.filename?.trim() || 'package.zip';
        form.append('file', new Blob([args.file], { type: 'application/zip' }), name);
        const url = `${this.apiBase()}/courses/importJobs/upload?${qs.toString()}`;
        const headers = {
            Authorization: this.authHeader(),
            Accept: 'application/json, text/plain, */*',
        };
        const uploadTimeoutMs = this.timeoutMs('SCORM_CLOUD_UPLOAD_TIMEOUT_MS', exports.SCORM_CLOUD_UPLOAD_TIMEOUT_MS);
        const signal = AbortSignal.timeout(uploadTimeoutMs);
        let response;
        let text;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers,
                body: form,
                signal,
            });
            text = await response.text();
        }
        catch (err) {
            if (isAbortTimeout(err)) {
                this.logger.error(`SCORM Cloud upload import timed out after ${uploadTimeoutMs}ms`);
                throw new ScormCloudTimeoutError('upload import', uploadTimeoutMs);
            }
            this.logger.error(`SCORM Cloud upload import network error: ${(0, error_message_1.errorMessage)(err)}`);
            throw new ScormCloudNetworkError();
        }
        if (!response.ok) {
            throw new ScormCloudHttpError(response.status, text);
        }
        let json;
        try {
            json = text ? JSON.parse(text) : {};
        }
        catch {
            throw new common_1.HttpException('SCORM Cloud upload import returned non-JSON', common_1.HttpStatus.BAD_GATEWAY);
        }
        return this.parseImportJobId(json);
    }
    parseImportJobId(json) {
        const jobId = json && typeof json === 'object' ? json.result : undefined;
        if (!jobId || typeof jobId !== 'string') {
            throw new common_1.HttpException('SCORM Cloud import job did not return a result id', common_1.HttpStatus.BAD_GATEWAY);
        }
        return jobId;
    }
    async setCourseConfiguration(courseId, settings) {
        await this.request('POST', `/courses/${encodeURIComponent(courseId)}/configuration`, { settings }, { acceptEmpty: true });
    }
    async getImportJobStatus(jobId) {
        const json = await this.request('GET', `/courses/importJobs/${encodeURIComponent(jobId)}`);
        return {
            status: String(json?.status ?? ''),
            message: typeof json?.message === 'string' ? json.message : undefined,
        };
    }
    async getCourseAsset(scormCloudCourseId, relativePath) {
        const qs = new URLSearchParams({ relativePath });
        return this.requestText('GET', `/courses/${encodeURIComponent(scormCloudCourseId)}/asset?${qs.toString()}`, undefined, {
            timeoutMs: Math.max(exports.SCORM_CLOUD_ASSET_TIMEOUT_MS, this.timeoutMs('SCORM_CLOUD_TIMEOUT_MS', exports.SCORM_CLOUD_TIMEOUT_MS)),
        });
    }
    async createRegistration(input) {
        await this.request('POST', '/registrations', {
            courseId: input.courseId,
            registrationId: input.registrationId,
            learner: input.learner,
            postBack: input.postBack,
        }, { acceptEmpty: true });
    }
    async buildRegistrationLaunchLink(args) {
        const expiry = clampExpiry(args.expiry ?? 120);
        const json = await this.request('POST', `/registrations/${encodeURIComponent(args.registrationId)}/launchLink`, {
            redirectOnExitUrl: args.redirectOnExitUrl,
            expiry,
        });
        const link = json?.launchLink || json?.result;
        if (!link || typeof link !== 'string') {
            throw new common_1.HttpException('SCORM Cloud launch link was empty', common_1.HttpStatus.BAD_GATEWAY);
        }
        return link;
    }
    async getRegistrationProgress(registrationId, detail = 'course') {
        const qs = new URLSearchParams();
        if (detail === 'activity' || detail === 'full') {
            qs.set('includeChildResults', 'true');
        }
        if (detail === 'full') {
            qs.set('includeRuntime', 'true');
        }
        const suffix = qs.toString() ? `?${qs.toString()}` : '';
        return this.request('GET', `/registrations/${encodeURIComponent(registrationId)}${suffix}`);
    }
    async deleteRegistration(registrationId) {
        await this.request('DELETE', `/registrations/${encodeURIComponent(registrationId)}`, undefined, { acceptEmpty: true });
    }
    async deleteCourse(scormCloudCourseId, options) {
        await this.request('DELETE', `/courses/${encodeURIComponent(scormCloudCourseId)}`, undefined, { acceptEmpty: true, timeoutMs: options?.timeoutMs });
    }
    async deleteAllLearnerData(learnerId) {
        const ownerEmail = this.config.get('SCORM_CLOUD_OWNER_EMAIL');
        if (!ownerEmail) {
            throw new Error('SCORM_CLOUD_OWNER_EMAIL is not configured');
        }
        const qs = new URLSearchParams({ userEmail: ownerEmail });
        await this.request('DELETE', `/learner/${encodeURIComponent(learnerId)}/delete-information?${qs.toString()}`, undefined, { acceptEmpty: true });
    }
    timeoutMs(key, fallback) {
        const raw = this.config.get(key);
        if (raw === undefined || raw === null || raw === '')
            return fallback;
        const ms = Number(raw);
        if (!Number.isFinite(ms) || ms <= 0) {
            this.logger.warn(`Ignoring invalid ${key}="${raw}"; using ${fallback}ms`);
            return fallback;
        }
        return ms;
    }
    apiBase() {
        const base = this.config.get('SCORM_CLOUD_API_BASE') ||
            'https://cloud.scorm.com/api/v2';
        return (0, strip_trailing_slash_1.stripTrailingSlash)(base);
    }
    authHeader() {
        const appId = this.config.get('SCORM_CLOUD_APP_ID');
        const secret = this.config.get('SCORM_CLOUD_SECRET_KEY');
        if (!appId || !secret) {
            throw new common_1.HttpException('SCORM Cloud credentials are not configured', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
        return `Basic ${Buffer.from(`${appId}:${secret}`).toString('base64')}`;
    }
    async request(method, path, body, options) {
        const text = await this.requestText(method, path, body, options);
        if (!text) {
            return undefined;
        }
        try {
            return JSON.parse(text);
        }
        catch {
            if (options?.acceptEmpty)
                return undefined;
            this.logger.warn(`SCORM Cloud ${method} ${path} returned non-JSON`);
            throw new common_1.HttpException('SCORM Cloud returned a non-JSON response', common_1.HttpStatus.BAD_GATEWAY);
        }
    }
    async requestText(method, path, body, options) {
        const url = `${this.apiBase()}${path.startsWith('/') ? path : `/${path}`}`;
        const timeoutMs = options?.timeoutMs ??
            this.timeoutMs('SCORM_CLOUD_TIMEOUT_MS', exports.SCORM_CLOUD_TIMEOUT_MS);
        const headers = {
            Authorization: this.authHeader(),
            Accept: 'application/json, text/plain, */*',
        };
        const init = {
            method,
            headers,
            signal: AbortSignal.timeout(timeoutMs),
        };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        let response;
        let text;
        try {
            response = await fetch(url, init);
            text = await response.text();
        }
        catch (err) {
            if (isAbortTimeout(err)) {
                this.logger.error(`SCORM Cloud ${method} ${path} timed out after ${timeoutMs}ms`);
                throw new ScormCloudTimeoutError(`${method} ${path.split('?')[0]}`, timeoutMs);
            }
            this.logger.error(`SCORM Cloud ${method} ${path} network error: ${(0, error_message_1.errorMessage)(err)}`);
            throw new ScormCloudNetworkError();
        }
        if (response.status === 204 || (options?.acceptEmpty && !text)) {
            if (!response.ok && response.status !== 204) {
                throw new ScormCloudHttpError(response.status, text);
            }
            return '';
        }
        if (!response.ok) {
            throw new ScormCloudHttpError(response.status, text);
        }
        return text;
    }
};
exports.ScormCloudClient = ScormCloudClient;
exports.ScormCloudClient = ScormCloudClient = ScormCloudClient_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], ScormCloudClient);
function clampExpiry(expiry) {
    if (!Number.isFinite(expiry))
        return 120;
    return Math.min(300, Math.max(10, Math.round(expiry)));
}
//# sourceMappingURL=scorm-cloud.client.js.map