import { ConfigService } from '@nestjs/config';
import { ScormPackageStatus, ScormRegistration, User } from '@prisma/client';
import { CourseCompletionService } from '../course-completion/course-completion.service';
import { CourseVersionService } from '../course-version/course-version.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScormCloudClient, ScormCloudRegistrationProgress } from '../scorm-cloud/scorm-cloud.client';
import { LaunchScormDto } from './dto';
export type ApplySnapshotTiming = {
    snapshotAt?: Date;
    postbackReceivedAt?: Date;
    fullPull?: boolean;
};
export declare class ScormRuntimeService {
    private readonly prisma;
    private readonly config;
    private readonly cloud;
    private readonly courseVersionService;
    private readonly courseCompletion;
    private readonly logger;
    private readonly undecodableSeen;
    constructor(prisma: PrismaService, config: ConfigService, cloud: ScormCloudClient, courseVersionService: CourseVersionService, courseCompletion: CourseCompletionService);
    launch(user: User, body: LaunchScormDto): Promise<{
        launchLink: string;
    }>;
    handlePostback(payload: unknown): Promise<void>;
    private pullRuntimeDetail;
    private isTerminalPostback;
    private markRuntimeGoneIf404;
    private runtimePullFloorMs;
    private claimRuntimePull;
    refreshIfDirty(row: Pick<ScormRegistration, 'id' | 'scormCloudRegistrationId' | 'lastPostbackAt' | 'packageId'> & {
        lastRuntimeAppliedAt: Date | null;
        packageStatus?: ScormPackageStatus | null;
    }): Promise<boolean>;
    reconcileCron(invocationDeadline?: number): Promise<{
        candidates: number;
        updated: number;
        deferred: number;
    }>;
    pruneSupersededPackagesCron(deadline?: number): Promise<{
        candidates: number;
        pruned: number;
        deferred: number;
    }>;
    getLearnerProgress(userId: string, courseId: string): Promise<{
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
    applyProgressAndMaybeCertify(current: ScormRegistration, payload: ScormCloudRegistrationProgress, options: {
        throwIfCertifyIncomplete: boolean;
    } & ApplySnapshotTiming): Promise<void>;
    private writeScalars;
    private isStillCertified;
    private applyLessonProgress;
    private maybeSeedPackageCpv;
    private warnUndecodableSuspendData;
    private stampChapterCompletion;
    private lastSeenPointerIsStale;
    private updateLastSeenLesson;
    private canRecordProgress;
    private applyLessonIndices;
    private runCompletionBridge;
    private stampCompletionDenominator;
    private resolveCertifySection;
    private canPruneSupersededPackage;
    private ensureCloudRegistration;
    private upsertLastSeen;
    private resolvePinnedScormTarget;
    private parseProgressPayload;
}
