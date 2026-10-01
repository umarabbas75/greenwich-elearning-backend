import { User } from '@prisma/client';
import { Request } from 'express';
import { LaunchScormDto } from './dto';
import { ScormRuntimeService } from './scorm-runtime.service';
export declare class ScormLaunchController {
    private readonly runtime;
    constructor(runtime: ScormRuntimeService);
    launch(user: User, body: LaunchScormDto): Promise<{
        launchLink: string;
    }>;
    postback(req: Request): Promise<{
        ok: boolean;
    }>;
    getProgress(user: User, courseId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            lessonsCompleted: number;
            lessonsCompletedDecoded: number;
            lessonsTotal: number;
            id?: string;
            attempts?: number;
            completedAt?: Date;
            packageId: string;
            scormCloudRegistrationId?: string;
            completionStatus?: string;
            successStatus?: string;
            scoreScaled?: number;
            totalTimeSeconds?: number;
            firstLaunchAt?: Date;
            lastPostbackAt?: Date;
            progressSource?: string;
            lastRuntimeAppliedAt?: Date;
            lessonsCompletedAtCertify?: number;
            suspended?: boolean;
            lessonId?: string;
            lessonIndex?: number;
            lessonTitle?: string;
            firstAccessAt?: Date;
            lastAccessAt?: Date;
        };
    }>;
}
