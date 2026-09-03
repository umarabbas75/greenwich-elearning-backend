import { ConfigService } from '@nestjs/config';
import { ScormRegistration, User } from '@prisma/client';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { CourseVersionService } from '../course-version/course-version.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScormCloudClient, ScormCloudRegistrationProgress } from '../scorm-cloud/scorm-cloud.client';
import { LaunchScormDto } from './dto';
export declare class ScormRuntimeService {
    private readonly prisma;
    private readonly config;
    private readonly cloud;
    private readonly courseVersionService;
    private readonly courseCompletion;
    private readonly logger;
    constructor(prisma: PrismaService, config: ConfigService, cloud: ScormCloudClient, courseVersionService: CourseVersionService, courseCompletion: CourseCompletionService);
    launch(user: User, body: LaunchScormDto): Promise<{
        launchLink: string;
    }>;
    handlePostback(payload: unknown): Promise<void>;
    reconcileCron(): Promise<{
        candidates: number;
        updated: number;
    }>;
    pruneSupersededPackagesCron(): Promise<{
        candidates: number;
        pruned: number;
    }>;
    getLearnerProgress(userId: string, courseId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            completedAt: Date;
            packageId: string;
            completionStatus: string;
            successStatus: string;
            scoreScaled: number;
            totalTimeSeconds: number;
            firstLaunchAt: Date;
            lastPostbackAt: Date;
        };
    }>;
    applyProgressAndMaybeCertify(current: ScormRegistration, payload: ScormCloudRegistrationProgress, options: {
        throwIfCertifyIncomplete: boolean;
    }): Promise<void>;
    private runCompletionBridge;
    private resolveCertifySection;
    private canPruneSupersededPackage;
    private ensureCloudRegistration;
    private upsertLastSeen;
    private resolvePinnedScormTarget;
    private parseProgressPayload;
}
