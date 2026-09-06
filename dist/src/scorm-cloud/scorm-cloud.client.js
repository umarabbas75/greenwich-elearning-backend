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
exports.ScormCloudClient = exports.SCORM_EMBEDDED_LAUNCH_SETTINGS = exports.ScormCloudHttpError = void 0;
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
        return this.requestText('GET', `/courses/${encodeURIComponent(scormCloudCourseId)}/asset?${qs.toString()}`);
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
    async getRegistrationProgress(registrationId) {
        return this.request('GET', `/registrations/${encodeURIComponent(registrationId)}`);
    }
    async deleteRegistration(registrationId) {
        await this.request('DELETE', `/registrations/${encodeURIComponent(registrationId)}`, undefined, { acceptEmpty: true });
    }
    async deleteCourse(scormCloudCourseId) {
        await this.request('DELETE', `/courses/${encodeURIComponent(scormCloudCourseId)}`, undefined, { acceptEmpty: true });
    }
    async deleteAllLearnerData(learnerId) {
        const ownerEmail = this.config.get('SCORM_CLOUD_OWNER_EMAIL');
        if (!ownerEmail) {
            throw new Error('SCORM_CLOUD_OWNER_EMAIL is not configured');
        }
        const qs = new URLSearchParams({ userEmail: ownerEmail });
        await this.request('DELETE', `/learner/${encodeURIComponent(learnerId)}/delete-information?${qs.toString()}`, undefined, { acceptEmpty: true });
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
        const headers = {
            Authorization: this.authHeader(),
            Accept: 'application/json, text/plain, */*',
        };
        const init = { method, headers };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        let response;
        try {
            response = await fetch(url, init);
        }
        catch (err) {
            this.logger.error(`SCORM Cloud ${method} ${path} network error: ${(0, error_message_1.errorMessage)(err)}`);
            throw new common_1.HttpException('SCORM Cloud is unreachable', common_1.HttpStatus.BAD_GATEWAY);
        }
        const text = await response.text();
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