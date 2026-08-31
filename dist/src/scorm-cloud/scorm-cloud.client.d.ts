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
    ping(): Promise<unknown>;
    createFetchAndImportCourseJob(args: {
        courseId: string;
        url: string;
    }): Promise<string>;
    getImportJobStatus(jobId: string): Promise<ScormCloudImportJobStatus>;
    getCourseAsset(scormCloudCourseId: string, relativePath: string): Promise<string>;
    createRegistration(input: CreateRegistrationInput): Promise<void>;
    buildRegistrationLaunchLink(args: {
        registrationId: string;
        redirectOnExitUrl: string;
        expiry?: number;
    }): Promise<string>;
    getRegistrationProgress(registrationId: string): Promise<ScormCloudRegistrationProgress>;
    testRegistrationPostback(postBack: CreateRegistrationInput['postBack']): Promise<unknown>;
    deleteRegistration(registrationId: string): Promise<void>;
    deleteAllLearnerData(learnerId: string): Promise<void>;
    private apiBase;
    private authHeader;
    private request;
    private requestText;
}
