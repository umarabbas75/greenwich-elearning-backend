import { User } from '@prisma/client';
import { CreateScormPackageDto } from './dto';
import { ScormService } from './scorm.service';
export declare class ScormController {
    private readonly scorm;
    constructor(scorm: ScormService);
    createPackage(admin: User, body: CreateScormPackageDto): Promise<{
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
            riseProbeJson: import(".prisma/client").Prisma.JsonValue;
            completeOn: string;
            passingScore: number;
            status: import(".prisma/client").$Enums.ScormPackageStatus;
            failureReason: string;
            importWarning: string;
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
            riseProbeJson: import(".prisma/client").Prisma.JsonValue;
            completeOn: string;
            passingScore: number;
            status: import(".prisma/client").$Enums.ScormPackageStatus;
            failureReason: string;
            importWarning: string;
            createdAt: Date;
        };
    }>;
    getImportStatus(admin: User, id: string): Promise<{
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
            riseProbeJson: import(".prisma/client").Prisma.JsonValue;
            completeOn: string;
            passingScore: number;
            status: import(".prisma/client").$Enums.ScormPackageStatus;
            failureReason: string;
            importWarning: string;
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
            riseProbeJson: import(".prisma/client").Prisma.JsonValue;
            completeOn: string;
            passingScore: number;
            status: import(".prisma/client").$Enums.ScormPackageStatus;
            failureReason: string;
            importWarning: string;
            createdAt: Date;
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
}
