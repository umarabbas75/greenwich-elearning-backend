import { Prisma } from '@prisma/client';
import { CourseVersionService } from '../course-version/course-version.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScormCloudClient } from '../scorm-cloud/scorm-cloud.client';
import { CreateScormPackageDto } from './dto';
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
            createdAt: Date;
        };
    }>;
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
            createdAt: Date;
        };
    }>;
    processImportJobsCron(): Promise<{
        processed: number;
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
        createdAt: Date;
    }>;
    private finishPublishAndReady;
    private policyGate;
    private buildOrReplaceTree;
    private prepareExistingCourse;
    private createImportedCourse;
}
