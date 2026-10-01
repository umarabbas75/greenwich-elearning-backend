/// <reference types="node" />
import { Prisma } from '@prisma/client';
import { CourseVersionService } from '../course-version/course-version.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScormCloudClient } from '../scorm-cloud/scorm-cloud.client';
import { CreateScormPackageDto } from './dto';
export declare const TREE_LOCK_SEED = 1;
export declare const COURSE_TREE_LOCK_SEED = 2;
export declare const IMPORT_START_LOCK_SEED = 3;
export declare class ScormService {
    private readonly prisma;
    private readonly cloud;
    private readonly courseVersionService;
    private readonly logger;
    constructor(prisma: PrismaService, cloud: ScormCloudClient, courseVersionService: CourseVersionService);
    createPackage(adminId: string, body: CreateScormPackageDto): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            courseId: string;
            versionNumber: number;
            sectionId: string;
            title: string;
            scormCloudCourseId: string;
            cloudImportJobId: string;
            zipSha256: string;
            riseProbeJson: Prisma.JsonValue;
            completeOn: string;
            passingScore: number;
            status: import(".prisma/client").$Enums.ScormPackageStatus;
            failureReason: string;
            importWarning: string;
            lessons: Prisma.JsonValue;
            lessonCount: number;
            chapterId: string;
            riseCpv: string;
            createdAt: Date;
        };
    }>;
    createPackageFromUpload(adminId: string, file: Buffer, body: Omit<CreateScormPackageDto, 'contentUrl'> & {
        filename?: string;
    }): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            courseId: string;
            versionNumber: number;
            sectionId: string;
            title: string;
            scormCloudCourseId: string;
            cloudImportJobId: string;
            zipSha256: string;
            riseProbeJson: Prisma.JsonValue;
            completeOn: string;
            passingScore: number;
            status: import(".prisma/client").$Enums.ScormPackageStatus;
            failureReason: string;
            importWarning: string;
            lessons: Prisma.JsonValue;
            lessonCount: number;
            chapterId: string;
            riseCpv: string;
            createdAt: Date;
        };
    }>;
    private startPackageImport;
    private pollStaleInFlightImport;
    private deleteCloudCourseAfterTimeout;
    private failIfStale;
    private failIfPastHardCap;
    private failIfStaleAfterPoll;
    private failIfUnbuilt;
    private reread;
    getPackage(id: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            courseId: string;
            versionNumber: number;
            sectionId: string;
            title: string;
            scormCloudCourseId: string;
            cloudImportJobId: string;
            zipSha256: string;
            riseProbeJson: Prisma.JsonValue;
            completeOn: string;
            passingScore: number;
            status: import(".prisma/client").$Enums.ScormPackageStatus;
            failureReason: string;
            importWarning: string;
            lessons: Prisma.JsonValue;
            lessonCount: number;
            chapterId: string;
            riseCpv: string;
            createdAt: Date;
        };
    }>;
    listPackages(courseId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            courseId: string;
            versionNumber: number;
            sectionId: string;
            title: string;
            scormCloudCourseId: string;
            cloudImportJobId: string;
            zipSha256: string;
            riseProbeJson: Prisma.JsonValue;
            completeOn: string;
            passingScore: number;
            status: import(".prisma/client").$Enums.ScormPackageStatus;
            failureReason: string;
            importWarning: string;
            lessons: Prisma.JsonValue;
            lessonCount: number;
            chapterId: string;
            riseCpv: string;
            createdAt: Date;
        }[];
    }>;
    getImportStatus(id: string, adminId?: string | null): Promise<{
        message: string;
        statusCode: number;
        data: {
            id: string;
            courseId: string;
            versionNumber: number;
            sectionId: string;
            title: string;
            scormCloudCourseId: string;
            cloudImportJobId: string;
            zipSha256: string;
            riseProbeJson: Prisma.JsonValue;
            completeOn: string;
            passingScore: number;
            status: import(".prisma/client").$Enums.ScormPackageStatus;
            failureReason: string;
            importWarning: string;
            lessons: Prisma.JsonValue;
            lessonCount: number;
            chapterId: string;
            riseCpv: string;
            createdAt: Date;
        };
    }>;
    processImportJobsCron(deadline?: number): Promise<{
        processed: number;
        deferred: number;
        results: {
            id: string;
            status: string;
        }[];
    }>;
    replacePreview(courseId: string): Promise<{
        message: string;
        statusCode: number;
        data: {
            completedOnOldPackage: number;
            pinnedEnrollments: number;
            floatingEnrollments: number;
            packageId: any;
            versionNumber?: undefined;
        };
    } | {
        message: string;
        statusCode: number;
        data: {
            packageId: string;
            versionNumber: number;
            completedOnOldPackage: number;
            pinnedEnrollments: number;
            floatingEnrollments: number;
        };
    }>;
    completeImportIfReady(packageId: string, adminId: string | null): Promise<{
        id: string;
        courseId: string;
        versionNumber: number;
        sectionId: string;
        title: string;
        scormCloudCourseId: string;
        cloudImportJobId: string;
        zipSha256: string;
        riseProbeJson: Prisma.JsonValue;
        completeOn: string;
        passingScore: number;
        status: import(".prisma/client").$Enums.ScormPackageStatus;
        failureReason: string;
        importWarning: string;
        lessons: Prisma.JsonValue;
        lessonCount: number;
        chapterId: string;
        riseCpv: string;
        createdAt: Date;
    }>;
    private importWarningFor;
    private finishPublishAndReady;
    private policyGate;
    private buildOrReplaceTree;
    private findScormTreeAnchor;
    private prepareExistingCourse;
    private createImportedCourse;
}
export declare function riseIndexSpaceWarning(risk: string | null): string | null;
