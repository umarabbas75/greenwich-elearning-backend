import { ForumCourseScope, ForumNotifyOnCreate, ForumStudentCreatePolicy, ForumTagPolicy, Role } from '@prisma/client';
export type ForumCategoryPolicy = {
    id: string;
    isActive: boolean;
    courseScope: ForumCourseScope;
    studentCreatePolicy: ForumStudentCreatePolicy;
    notifyOnCreate: ForumNotifyOnCreate;
    allowAcceptedAnswer?: boolean;
    allowVotes?: boolean;
    allowMentions?: boolean;
    allowAttachments?: boolean;
    tagPolicy?: ForumTagPolicy;
};
export declare function isAdminRole(role: Role | string | undefined): boolean;
export declare function slugifyCategoryName(name: string): string;
export declare function assertCourseScope(category: ForumCategoryPolicy, courseId: string | null | undefined): void;
export declare function assertStudentMayCreate(category: ForumCategoryPolicy, role: Role | string): void;
export declare function resolveNewThreadStatus(args: {
    role: Role | string;
    category: ForumCategoryPolicy;
    requestedStatus?: string;
}): string;
export declare function shouldBroadcastNewThread(args: {
    role: Role | string;
    category: ForumCategoryPolicy;
    status: string;
}): boolean;
type ForumEngagementFlags = {
    allowAcceptedAnswer?: boolean;
    allowVotes?: boolean;
    allowMentions?: boolean;
    allowAttachments?: boolean;
};
export declare function categoryAllows(category: ForumCategoryPolicy | ForumEngagementFlags | null | undefined, flag: keyof ForumEngagementFlags): boolean;
export {};
