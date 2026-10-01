/// <reference types="node" />
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
export declare class ScormCloudHttpError extends HttpException {
    readonly cloudStatus: number;
    readonly cloudBody: string;
    constructor(status: number, body: string);
}
export declare class ScormCloudTimeoutError extends HttpException {
    readonly timeoutMs: number;
    constructor(what: string, timeoutMs: number);
}
export declare class ScormCloudNetworkError extends HttpException {
    constructor();
}
export declare const SCORM_CLOUD_TIMEOUT_MS = 10000;
export declare const SCORM_CLOUD_ASSET_TIMEOUT_MS = 25000;
export declare const SCORM_CLOUD_UPLOAD_TIMEOUT_MS = 35000;
export type ScormCloudImportJobStatus = {
    status: string;
    message?: string;
};
export type ScormCloudRegistrationProgress = {
    id?: string;
    registrationCompletion?: string;
    registrationSuccess?: string;
    score?: {
        scaled?: number;
    };
    totalSecondsTracked?: number;
    [key: string]: unknown;
};
export type ScormCloudConfigurationSetting = {
    settingId: string;
    value: string;
    explicit?: boolean;
};
export declare const SCORM_EMBEDDED_LAUNCH_SETTINGS: ScormCloudConfigurationSetting[];
export type CreateRegistrationInput = {
    courseId: string;
    registrationId: string;
    learner: {
        id: string;
        firstName: string;
        lastName: string;
    };
    postBack: {
        url: string;
        authType: 'HTTPBASIC';
        userName: string;
        password: string;
        resultsFormat: 'COURSE';
    };
};
export declare class ScormCloudClient {
    private readonly config;
    private readonly logger;
    constructor(config: ConfigService);
    createFetchAndImportCourseJob(args: {
        courseId: string;
        url: string;
    }): Promise<string>;
    createUploadAndImportCourseJob(args: {
        courseId: string;
        file: Buffer;
        filename?: string;
    }): Promise<string>;
    private parseImportJobId;
    setCourseConfiguration(courseId: string, settings: ScormCloudConfigurationSetting[]): Promise<void>;
    getImportJobStatus(jobId: string): Promise<ScormCloudImportJobStatus>;
    getCourseAsset(scormCloudCourseId: string, relativePath: string): Promise<string>;
    createRegistration(input: CreateRegistrationInput): Promise<void>;
    buildRegistrationLaunchLink(args: {
        registrationId: string;
        redirectOnExitUrl: string;
        expiry?: number;
    }): Promise<string>;
    getRegistrationProgress(registrationId: string, detail?: 'course' | 'activity' | 'full'): Promise<ScormCloudRegistrationProgress>;
    deleteRegistration(registrationId: string): Promise<void>;
    deleteCourse(scormCloudCourseId: string, options?: {
        timeoutMs?: number;
    }): Promise<void>;
    deleteAllLearnerData(learnerId: string): Promise<void>;
    private timeoutMs;
    private apiBase;
    private authHeader;
    private request;
    private requestText;
}
