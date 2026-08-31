export declare class CreateScormPackageDto {
    courseId?: string;
    contentUrl: string;
    zipSha256?: string;
    completeOn: 'completed' | 'passed';
    passingScore?: number;
    title?: string;
    description?: string;
    image?: string;
    overview?: string;
    duration?: string;
    assessment?: string;
    syllabusOverview?: string;
    resourcesOverview?: string;
}
export declare class LaunchScormDto {
    courseId: string;
    packageId?: string;
}
