import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
export declare class ScormCloudHttpError extends HttpException {
    readonly cloudStatus: number;
    readonly cloudBody: string;
    constructor(status: number, body: string);
}
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
    setCourseConfiguration(courseId: string, settings: ScormCloudConfigurationSetting[]): Promise<void>;
    getImportJobStatus(jobId: string): Promise<ScormCloudImportJobStatus>;
    getCourseAsset(scormCloudCourseId: string, relativePath: string): Promise<string>;
    createRegistration(input: CreateRegistrationInput): Promise<void>;
    buildRegistrationLaunchLink(args: {
        registrationId: string;
        redirectOnExitUrl: string;
        expiry?: number;
    }): Promise<string>;
    getRegistrationProgress(registrationId: string): Promise<ScormCloudRegistrationProgress>;
    deleteRegistration(registrationId: string): Promise<void>;
    deleteCourse(scormCloudCourseId: string): Promise<void>;
    deleteAllLearnerData(learnerId: string): Promise<void>;
    private apiBase;
    private authHeader;
    private request;
    private requestText;
}
