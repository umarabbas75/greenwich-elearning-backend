export declare function formAppliesToEnrollment(formCreatedAt: Date, enrolledAt: Date | null | undefined): boolean;
type CourseFormAnchors = {
    createdAt: Date;
    requiredSince: Date;
    detachedWindows: unknown;
};
export declare function courseFormAttachedForEnrollment(form: Omit<CourseFormAnchors, 'requiredSince'>, enrolledAt: Date | null | undefined): boolean;
export declare function reattachData(current: {
    detachedAt: Date;
    detachedWindows: unknown;
}, now: Date): {
    detachedAt: null;
    detachedWindows: Array<{
        from: string;
        until: string;
    }>;
};
export declare function policyAppliesToEnrollment(policy: {
    createdAt: Date;
    detachedWindows?: unknown;
}, enrolledAt: Date | null | undefined): boolean;
export declare function policyItemAppliesToEnrollment(item: {
    requiredSince: Date;
    detachedWindows?: unknown;
}, enrolledAt: Date | null | undefined): boolean;
export declare function courseFormAppliesToEnrollment(form: CourseFormAnchors, enrolledAt: Date | null | undefined): boolean;
export {};
