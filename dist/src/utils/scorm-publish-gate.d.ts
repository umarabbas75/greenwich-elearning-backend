import { Prisma } from '@prisma/client';
export declare function scormPackageSectionIds(pkg: {
    sectionId: string | null;
    lessons: unknown;
} | null | undefined): Set<string>;
export declare function scormGateCandidateSectionsWhere(courseId: string): Prisma.SectionWhereInput;
export type ScormPublishGateResult = {
    missing: string[];
    deactivated: string[];
    gone: number;
    extra: string[];
    problems: string[];
};
export declare function evaluateScormPublishGate(expected: Set<string>, candidates: Array<{
    id: string;
    isActive: boolean;
}>): ScormPublishGateResult;
